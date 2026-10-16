/**
 * 简历数据的归一化与版本迁移。
 *
 * 纯函数，不依赖 Vue 与浏览器环境：
 * 集中处理「历史数据缺字段」「字段改名」「默认值补全」，
 * store 只负责持有状态与暴露动作。
 */
import { DEFAULT_SECTION_LAYOUT, DEFAULT_THEME, createResume } from '@/data/defaultResume'
import {
  CUSTOM_HEADERS,
  CUSTOM_MODES,
  CUSTOM_RATIOS,
  DEFAULT_CUSTOM_LAYOUT,
  FONTS,
  FONT_KEY_MIGRATION,
} from '@/data/presets'
import type { Basics, CustomLayout, Resume, Section, Theme } from '@/types/resume'
import { uid } from '@/utils/helpers'

/** 未归一化的原始数据：字段与类型都不可信，逐段收窄 */
type RawRecord = Record<string, any>

/** 当前数据结构版本 */
export const RESUME_VERSION = 2

/** 为导入的数据补齐缺失的 id，避免渲染时 key 重复 */
function ensureId<T extends RawRecord>(item: T, prefix: string): T {
  if (item && typeof item === 'object' && !(item as { id?: string }).id) {
    ;(item as { id?: string }).id = uid(prefix)
  }
  return item
}

/** 键值网格模块 */
function normalizeGridSection(section: RawRecord): void {
  section.items = Array.isArray(section.items) ? section.items : []
  section.items.forEach((item: RawRecord, index: number) => {
    ensureId(item, `g${index}`)
    item.icon = item.icon || 'none'
    item.label = item.label ?? ''
    item.value = item.value ?? ''
  })
}

/** 条目列表模块（教育、工作、项目经历） */
function normalizeEntriesSection(section: RawRecord): void {
  section.items = Array.isArray(section.items) ? section.items : []
  // 机构图标默认关闭，避免非顶尖院校的校徽反成减分项
  section.showLogo = section.showLogo === true

  section.items.forEach((entry: RawRecord, index: number) => {
    ensureId(entry, `e${index}`)
    entry.logo = entry.logo || ''

    entry.meta = Array.isArray(entry.meta) ? entry.meta : []
    entry.meta.forEach((meta: RawRecord, metaIndex: number) => {
      ensureId(meta, `m${index}${metaIndex}`)
      meta.label = meta.label ?? ''
      meta.value = meta.value ?? ''
    })

    entry.bullets = Array.isArray(entry.bullets) ? entry.bullets : []
    entry.bullets.forEach((bullet: RawRecord, bulletIndex: number) => {
      ensureId(bullet, `b${index}${bulletIndex}`)
      bullet.text = bullet.text ?? ''
    })
  })
}

/** 技能特长模块 */
function normalizeSkillsSection(section: RawRecord): void {
  section.fields = Array.isArray(section.fields) ? section.fields : []
  section.items = Array.isArray(section.items) ? section.items : []
  // 进度条默认隐藏，仅在明确开启时渲染
  section.showBars = section.showBars === true

  section.fields.forEach((field: RawRecord, index: number) => ensureId(field, `sf${index}`))
  section.items.forEach((skill: RawRecord, index: number) => {
    ensureId(skill, `sk${index}`)
    skill.level = Number.isFinite(Number(skill.level)) ? Number(skill.level) : 80
  })
}

function normalizeSections(sections: RawRecord[]): Section[] {
  sections.forEach((section: RawRecord, index: number) => {
    ensureId(section, `sec${index}`)
    section.visible = section.visible !== false
    section.title = section.title || '未命名模块'
    section.layout = { ...DEFAULT_SECTION_LAYOUT, ...(section.layout || {}) }

    if (section.type === 'grid') {
      normalizeGridSection(section)
    } else if (section.type === 'entries') {
      normalizeEntriesSection(section)
    } else if (section.type === 'skills') {
      normalizeSkillsSection(section)
    } else {
      section.content = section.content ?? ''
    }
  })
  return sections as Section[]
}

/** 迁移主题：旧字体键映射到新字族，并保证字族可取 */
function normalizeTheme(rawTheme?: RawRecord): Theme {
  const theme = { ...DEFAULT_THEME, ...(rawTheme || {}) }
  theme.fontKey = FONT_KEY_MIGRATION[theme.fontKey] || theme.fontKey
  if (!FONTS[theme.fontKey]) theme.fontKey = DEFAULT_THEME.fontKey
  theme.customLayout = normalizeCustomLayout(rawTheme?.customLayout)
  return theme
}

/**
 * 迁移自由定制模板的布局参数：
 * 缺省字段补默认值，枚举字段遇到非法值时回退，避免手改数据把布局打挂。
 */
function normalizeCustomLayout(raw?: RawRecord): CustomLayout {
  const layout = { ...DEFAULT_CUSTOM_LAYOUT, ...(raw || {}) }
  const pick = (options: { value: string }[], value: unknown, fallback: string): string =>
    options.some((option) => option.value === value) ? String(value) : fallback
  layout.mode = pick(CUSTOM_MODES, layout.mode, DEFAULT_CUSTOM_LAYOUT.mode)
  layout.ratio = pick(CUSTOM_RATIOS, layout.ratio, DEFAULT_CUSTOM_LAYOUT.ratio)
  layout.header = pick(CUSTOM_HEADERS, layout.header, DEFAULT_CUSTOM_LAYOUT.header)
  // 与 showLogo / showBars 同一约定：仅在明确为 true 时开启
  layout.cards = layout.cards === true
  layout.divider = layout.divider !== false
  return layout
}

/** 迁移基本信息，头像位置需要独立对象，避免与示例简历共用引用 */
function normalizeBasics(rawBasics: RawRecord | undefined, base: Resume): Basics {
  return {
    ...base.basics,
    ...(rawBasics || {}),
    fields: Array.isArray(rawBasics?.fields) ? rawBasics.fields : base.basics.fields,
    avatarPos: {
      dx: Number(rawBasics?.avatarPos?.dx) || 0,
      dy: Number(rawBasics?.avatarPos?.dy) || 0,
    },
  }
}

/**
 * 把任意来源的数据整理成当前版本可用的简历对象。
 * 传入非对象时回退到示例简历。
 * @param {unknown} raw 原始数据
 * @returns {object} 规范化后的简历
 */
export function normalizeResume(raw: unknown): Resume {
  const base = createResume()
  if (!raw || typeof raw !== 'object') return base

  const r = raw as RawRecord
  const version = Number(r.version) || 1
  const basics = normalizeBasics(r.basics, base)

  // v1 的头像是等边方形，圆形是合理默认；
  // v2 起默认按 1 寸证件照的竖版比例，圆形会被拉成椭圆，因此迁移为直角
  if (version < 2 && basics.avatarShape === 'circle') {
    basics.avatarShape = 'square'
  }

  return {
    version: RESUME_VERSION,
    template: (r.template as string) || base.template,
    theme: normalizeTheme(r.theme),
    basics,
    sections: normalizeSections(
      Array.isArray(r.sections) && r.sections.length ? r.sections : base.sections,
    ),
  }
}
