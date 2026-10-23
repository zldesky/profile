/**
 * 入参校验与清洗。
 *
 * 服务端拿到的是完全不可信的 JSON，而且它会被注入到渲染页面里。
 * 前端用的是 Vue 插值（默认转义，本身不执行 HTML），但这里仍按
 * 「永不信任输入」处理：主动剥离标签、限定枚举、裁剪数值、限制数量与长度，
 * 既防注入，也防超大数据把渲染拖垮。
 *
 * 枚举值从 src/data/presets.ts 读取（Node 22.18+ 默认类型剥离，可跨端引用 .ts），保证与服务端白名单永不脱节。
 */
import {
  AVATAR_SHAPES,
  FONTS,
  ICON_OPTIONS,
  SECTION_ALIGN_OPTIONS,
  SECTION_COLUMN_OPTIONS,
  TEMPLATES,
  TITLE_BOTTOM_ALIGNS,
  TITLE_BOTTOM_STYLES,
  TITLE_MARKERS,
  TITLE_STYLES,
} from '../src/data/presets.ts'
import type { SectionType } from '../src/types/resume.ts'

/** 模块类型白名单，需与 src/data/defaultResume.ts 的 SECTION_TYPES 保持一致 */
const SECTION_TYPES: readonly SectionType[] = ['grid', 'entries', 'skills', 'text']

/** 清洗结果：ok 时带出白名单结构，不 ok 时给出可读原因 */
export type SanitizeResult = { ok: true; value: SanitizedResume } | { ok: false; error: string }

/** 清洗后的简历：字段集合由本文件的白名单唯一定义 */
export interface SanitizedResume {
  version: 2
  template: string
  theme: Record<string, unknown>
  basics: Record<string, unknown>
  sections: Array<Record<string, unknown>>
}

/** 单个字段的清洗函数：任意输入 → 该字段的合法取值 */
type FieldSanitizer = (value: unknown) => unknown

/** 一组字段的规格：键集合就是保留白名单，未列出的键一律丢弃 */
type FieldSpec = Record<string, FieldSanitizer>

/**
 * 取枚举清单里的合法取值。
 * 导出是给 index.ts 用的：风格配置端点要校验同样的枚举，
 * 各自手抄一份字面量就会漂移（那里原先就是手抄的）。
 */
export const valuesOf = (list: Array<{ value: string }>): string[] => list.map((item) => item.value)
const idsOf = (list: Array<{ id: string }>): string[] => list.map((item) => item.id)

const ALLOW = {
  template: idsOf(TEMPLATES),
  fontKey: Object.keys(FONTS),
  titleStyle: valuesOf(TITLE_STYLES),
  titleMarker: valuesOf(TITLE_MARKERS),
  titleBottom: valuesOf(TITLE_BOTTOM_STYLES),
  titleBottomAlign: valuesOf(TITLE_BOTTOM_ALIGNS),
  avatarShape: valuesOf(AVATAR_SHAPES),
  sectionAlign: valuesOf(SECTION_ALIGN_OPTIONS),
  sectionColumns: valuesOf(SECTION_COLUMN_OPTIONS),
  icon: valuesOf(ICON_OPTIONS),
}

/** 各层级数量与长度上限 */
const LIMITS = {
  sections: 40,
  itemsPerSection: 60,
  entriesPerSection: 60,
  bulletsPerEntry: 60,
  metaPerEntry: 20,
  fieldsPerSection: 20,
  basicsFields: 30,
  /** 段落与要点：一条要点通常一两百字，留足余量 */
  longText: 2000,
  /** 补充字段、技能描述的取值：主修课程这类内容可能较长 */
  mediumText: 500,
  text: 300,
  shortText: 60,
  name: 40,
  image: 3 * 1024 * 1024,
}

/** 模块位置微调的范围，与设计面板滑杆范围保持一致并留少量余量 */
const LAYOUT_RANGE = {
  indent: { min: -40, max: 80 },
  extraGap: { min: -40, max: 80 },
  indentRight: { min: -40, max: 80 },
  extraGapBottom: { min: -40, max: 80 },
}

/**
 * 字段级间距的轴范围。
 *
 * 取前端 rangeForField 各字段范围并集的上界（正文要点可到 ±96、短标签到 ±48），
 * 服务端只需一个「不超出人类可理解范围」的兜底 —— 精确的每字段范围在前端 clamp，
 * 这里放宽到并集即可，避免出现「前端能存到 96、服务端却裁成 80」的静默不一致。
 */
const FIELD_LAYOUT_RANGE = {
  indent: { min: -48, max: 96 },
  indentRight: { min: -48, max: 96 },
  extraGap: { min: -16, max: 48 },
  extraGapBottom: { min: -16, max: 48 },
}
/** 单个模块最多保留多少个字段的间距设置，防止塞入超大对象拖垮渲染 */
const MAX_FIELD_LAYOUTS = 200

/** 只接受内联图片，避免引入外部资源或非图片内容 */
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * 清洗文本：先去掉完整标签，再清掉落单的尖括号与控制字符。
 * 简历文本不需要任何 HTML，因此这里的处理是「删除」而非「转义」。
 */
function cleanText(value: unknown, maxLength: number = LIMITS.text): string {
  if (value === null || value === undefined) return ''
  return (
    String(value)
      .replace(/<[^>]*>/g, '')
      .replace(/[<>]/g, '')
      // 保留换行、制表与回车，其余控制字符一律去掉
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .slice(0, maxLength)
  )
}

/** 枚举白名单，未命中时回退 */
function pickEnum(value: unknown, allowed: readonly unknown[], fallback: string): string {
  return allowed.includes(value) ? (value as string) : fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function cleanImage(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > LIMITS.image) return ''
  return DATA_IMAGE.test(value) ? value : ''
}

function cleanColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback
}

/** 只保留白名单内的键，结构由服务端定义而不是照搬客户端 */
function pickFields(source: unknown, spec: FieldSpec): Record<string, unknown> {
  const target: Record<string, unknown> = {}
  // 只遍历 spec 的键：客户端多传的字段在这里被丢掉
  const bag = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
  for (const [key, sanitize] of Object.entries(spec)) {
    target[key] = sanitize(bag[key])
  }
  return target
}

const asText =
  (max: number): FieldSanitizer =>
  (value) =>
    cleanText(value, max)

const GRID_ITEM_SPEC: FieldSpec = {
  icon: (value) => pickEnum(value, ALLOW.icon, 'none'),
  label: asText(LIMITS.shortText),
  value: asText(LIMITS.text),
}

const META_SPEC: FieldSpec = {
  label: asText(LIMITS.shortText),
  value: asText(LIMITS.mediumText),
}

const BULLET_SPEC: FieldSpec = {
  text: asText(LIMITS.longText),
}

const SKILL_SPEC: FieldSpec = {
  name: asText(LIMITS.shortText),
  level: (value) => clampNumber(value, 0, 100, 80),
}

const LAYOUT_SPEC: FieldSpec = {
  align: (value) => pickEnum(value, ALLOW.sectionAlign, 'inherit'),
  indent: (value) => clampNumber(value, LAYOUT_RANGE.indent.min, LAYOUT_RANGE.indent.max, 0),
  extraGap: (value) => clampNumber(value, LAYOUT_RANGE.extraGap.min, LAYOUT_RANGE.extraGap.max, 0),
  indentRight: (value) =>
    clampNumber(value, LAYOUT_RANGE.indentRight.min, LAYOUT_RANGE.indentRight.max, 0),
  extraGapBottom: (value) =>
    clampNumber(value, LAYOUT_RANGE.extraGapBottom.min, LAYOUT_RANGE.extraGapBottom.max, 0),
  columns: (value) => pickEnum(String(value ?? 'auto'), ALLOW.sectionColumns, 'auto'),
}

/**
 * 清洗字段级间距表（section.fieldLayouts）。
 *
 * 键是「字段种类:条目 id」这种稳定串，值只有四个数值轴。这里：
 *  - 键做长度限制、只保留安全字符，防止被用来撑爆或注入；
 *  - 每个轴按 FIELD_LAYOUT_RANGE 钳制；
 *  - 四项全是 0 的条目丢弃，与前端 updateFieldLayout 的「归零即删除」一致。
 */
function sanitizeFieldLayouts(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  let kept = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= MAX_FIELD_LAYOUTS) break
    if (typeof key !== 'string' || key.length > 80 || !/^[\w:-]+$/.test(key)) continue
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const layout = {
      indent: clampNumber(
        v.indent,
        FIELD_LAYOUT_RANGE.indent.min,
        FIELD_LAYOUT_RANGE.indent.max,
        0,
      ),
      indentRight: clampNumber(
        v.indentRight,
        FIELD_LAYOUT_RANGE.indentRight.min,
        FIELD_LAYOUT_RANGE.indentRight.max,
        0,
      ),
      extraGap: clampNumber(
        v.extraGap,
        FIELD_LAYOUT_RANGE.extraGap.min,
        FIELD_LAYOUT_RANGE.extraGap.max,
        0,
      ),
      extraGapBottom: clampNumber(
        v.extraGapBottom,
        FIELD_LAYOUT_RANGE.extraGapBottom.min,
        FIELD_LAYOUT_RANGE.extraGapBottom.max,
        0,
      ),
    }
    if (layout.indent || layout.indentRight || layout.extraGap || layout.extraGapBottom) {
      out[key] = layout
      kept += 1
    }
  }
  return out
}

const take = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : []

function buildSectionBody(section: Record<string, unknown>): Record<string, unknown> {
  if (section.type === 'grid') {
    return {
      items: take(section.items, LIMITS.itemsPerSection).map((item) =>
        pickFields(item, GRID_ITEM_SPEC),
      ),
    }
  }

  if (section.type === 'entries') {
    return {
      showLogo: section.showLogo === true,
      items: take(section.items, LIMITS.entriesPerSection).map((raw) => {
        const entry = raw as Record<string, unknown>
        return {
          time: cleanText(entry.time, LIMITS.shortText),
          org: cleanText(entry.org, LIMITS.shortText),
          role: cleanText(entry.role, LIMITS.shortText),
          logo: cleanImage(entry.logo),
          meta: take(entry.meta, LIMITS.metaPerEntry).map((meta) => pickFields(meta, META_SPEC)),
          bullets: take(entry.bullets, LIMITS.bulletsPerEntry).map((bullet) =>
            pickFields(bullet, BULLET_SPEC),
          ),
        }
      }),
    }
  }

  if (section.type === 'skills') {
    return {
      showBars: section.showBars === true,
      fields: take(section.fields, LIMITS.fieldsPerSection).map((field) =>
        pickFields(field, META_SPEC),
      ),
      items: take(section.items, LIMITS.itemsPerSection).map((skill) =>
        pickFields(skill, SKILL_SPEC),
      ),
    }
  }

  return { content: cleanText(section.content, LIMITS.longText) }
}

function sanitizeSections(rawSections: unknown): Array<Record<string, unknown>> {
  return take(rawSections, LIMITS.sections).map((raw) => {
    const section = raw as Record<string, unknown>
    const type = pickEnum(section?.type, SECTION_TYPES, 'text')
    const fieldLayouts = sanitizeFieldLayouts(section?.fieldLayouts)
    const result: Record<string, unknown> = {
      type,
      title: cleanText(section?.title, LIMITS.shortText),
      visible: section?.visible !== false,
      layout: pickFields(section?.layout, LAYOUT_SPEC),
      ...buildSectionBody({ ...section, type }),
    }
    // 空表不写出，保持「无字段微调」的模块 JSON 最简
    if (Object.keys(fieldLayouts).length) result.fieldLayouts = fieldLayouts
    return result
  })
}

function sanitizeTheme(rawTheme: unknown): Record<string, unknown> {
  const theme = (rawTheme && typeof rawTheme === 'object' ? rawTheme : {}) as Record<
    string,
    unknown
  >
  return {
    accent: cleanColor(theme.accent, '#000000'),
    text: cleanColor(theme.text, '#2b2f36'),
    fontKey: pickEnum(theme.fontKey, ALLOW.fontKey, 'yahei'),
    fs: clampNumber(theme.fs, 0.6, 1.6, 1),
    lh: clampNumber(theme.lh, 1, 3, 1.75),
    gap: clampNumber(theme.gap, 0.3, 3, 1),
    // 页面留白直接决定纸张内容区，放宽会导致版面挤爆
    mv: clampNumber(theme.mv, 5, 40, 12),
    mh: clampNumber(theme.mh, 5, 40, 14),
    titleStyle: pickEnum(theme.titleStyle, ALLOW.titleStyle, 'fill'),
    titleMarker: pickEnum(theme.titleMarker, ALLOW.titleMarker, 'square'),
    titleGap: clampNumber(theme.titleGap, 0, 3, 0.5),
    titleMargin: clampNumber(theme.titleMargin, 0, 3, 0.55),
    titleBottom: pickEnum(theme.titleBottom, ALLOW.titleBottom, 'none'),
    titleBottomWidth: clampNumber(theme.titleBottomWidth, 5, 100, 100),
    titleBottomThickness: clampNumber(theme.titleBottomThickness, 0.5, 12, 2),
    titleBottomGap: clampNumber(theme.titleBottomGap, 0, 40, 4),
    titleBottomAlign: pickEnum(theme.titleBottomAlign, ALLOW.titleBottomAlign, 'left'),
  }
}

function sanitizeBasics(rawBasics: unknown): Record<string, unknown> {
  const basics = (rawBasics && typeof rawBasics === 'object' ? rawBasics : {}) as Record<
    string,
    unknown
  >
  const pos = (
    basics.avatarPos && typeof basics.avatarPos === 'object' ? basics.avatarPos : {}
  ) as Record<string, unknown>
  return {
    name: cleanText(basics.name, LIMITS.name),
    jobTitle: cleanText(basics.jobTitle, LIMITS.shortText),
    avatar: cleanImage(basics.avatar),
    showAvatar: basics.showAvatar !== false,
    avatarShape: pickEnum(basics.avatarShape, ALLOW.avatarShape, 'square'),
    avatarWidth: clampNumber(basics.avatarWidth, 10, 80, 25),
    avatarHeight: clampNumber(basics.avatarHeight, 10, 100, 35),
    avatarPos: {
      dx: clampNumber(pos.dx, -300, 300, 0),
      dy: clampNumber(pos.dy, -100, 200, 0),
    },
    fields: take(basics.fields, LIMITS.basicsFields).map((field) =>
      pickFields(field, GRID_ITEM_SPEC),
    ),
  }
}

/**
 * 清洗客户端提交的简历数据。
 * @param raw 请求体里的 resume（完全不可信）
 */
export function sanitizeResume(raw: unknown): SanitizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '简历数据格式不正确' }
  }
  const source = raw as Record<string, unknown>
  if (!Array.isArray(source.sections)) {
    return { ok: false, error: '缺少 sections 字段' }
  }

  return {
    ok: true,
    value: {
      version: 2,
      template: pickEnum(source.template, ALLOW.template, 'classic'),
      theme: sanitizeTheme(source.theme),
      basics: sanitizeBasics(source.basics),
      // id 一律由渲染端生成，不接受客户端提供，避免重复 key
      sections: sanitizeSections(source.sections),
    },
  }
}

/**
 * 清洗导出文件名。
 *
 * 这里的值会进入 Content-Disposition 响应头，因此必须单独处理：
 * cleanText 为了保留简历正文的换行而放行 \r\n\t，文件名不能沿用这个策略，
 * 否则就留下了响应头注入的口子（虽然下游还有 encodeURIComponent 兜底）。
 */
export function sanitizeFilename(value: unknown): string {
  const cleaned = String(value ?? '')
    // 全部控制字符一律去掉，包括 CR / LF / TAB
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)

  return cleaned || '简历'
}
