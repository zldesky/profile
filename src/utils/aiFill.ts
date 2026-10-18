/**
 * 用 AI 把「已有简历文件 + 提示词」的内容填到指定位置。
 *
 * 与已有的「PDF 简历导入」分工不同，两者都保留：
 *  - PDF 导入（utils/pdfImport.ts）走启发式规则，整份重建，不依赖 AI，离线可用；
 *  - 这里走 AI，按**指定模块 + 提示词**填，用于「我只要把这段实习经历补进去」
 *    或「原件排得乱、规则解析不出来」的情形。
 *
 * 提示词工程上的两个硬约束（都因为「错填比不填更糟」）：
 *  1. 必须只输出 JSON，且字段与目标模块的结构严格对应 —— 否则写回时无从下手；
 *  2. 原文里没有的内容一律留空，**禁止编造**。简历上的假经历是灾难，
 *     所以提示词里反复强调，模型返回后也不再做任何「合理补全」。
 */

import {
  createBullet,
  createEntry,
  createGridItem,
  createMeta,
  createSkill,
} from '@/data/defaultResume'

/** AI 能填的目标：基础信息，或某个已有模块 */
export type FillTargetKind = 'basics' | 'section'

export interface FillTarget {
  kind: FillTargetKind
  /** 目标模块的 id（kind 为 section 时必填） */
  sectionId?: string
  /** 目标模块的类型，用于决定返回结构 */
  sectionType?: 'grid' | 'entries' | 'skills' | 'text'
  /** 目标模块标题，给模型当上下文 */
  sectionTitle?: string
}

/** 每种目标期望的 JSON 结构说明，直接写进提示词 */
const SHAPES: Record<string, string> = {
  basics: '{"name":"姓名","jobTitle":"求职职位","fields":[{"label":"字段名","value":"内容"}]}',
  grid: '{"items":[{"label":"标签","value":"内容"}]}',
  entries:
    '{"items":[{"time":"起止时间","org":"机构或公司","role":"职位或专业","meta":[{"label":"补充标签","value":"内容"}],"bullets":["要点1","要点2"]}]}',
  skills: '{"fields":[{"label":"技能分类","value":"说明"}],"items":[{"name":"技能名","level":80}]}',
  text: '{"content":"段落文本"}',
}

const COMMON_RULES = [
  '只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字。',
  '原文中没有出现的信息一律省略或留空字符串，绝对不要编造经历、数字、时间与头衔。',
  '保留原文的事实与措辞，可以整理格式与顺序，但不要改写事实、不要拔高。',
  '时间统一写成原文的写法；无法确定时留空字符串。',
]

/**
 * 构造「按提示词填充」的请求。
 *
 * @param sourceText 从文件里提取出的文本（已做长度裁剪）
 * @param target 目标位置
 * @param instruction 用户提示词，可为空（空则按「尽量完整填入」处理）
 * @param jobTitle 求职职位，用于帮助模型判断哪些内容相关
 */
export function buildFillMessages(
  sourceText: string,
  target: FillTarget,
  instruction = '',
  jobTitle = '',
): { role: 'system' | 'user'; content: string }[] {
  const shape = SHAPES[target.kind === 'basics' ? 'basics' : (target.sectionType ?? 'text')]
  const where =
    target.kind === 'basics'
      ? '基础信息（姓名、求职职位与联系方式等字段）'
      : `「${target.sectionTitle || '目标模块'}」这个模块`

  const system = [
    '你是简历信息整理助手。用户会给出一份已有简历的文本，以及一个目标位置，你要把相关内容整理进该位置。',
    `本次的目标位置是：${where}。`,
    `必须严格按这个 JSON 结构返回：${shape}`,
    ...COMMON_RULES,
    '若原文里与该目标位置相关的内容为空，返回对应字段为空的结构，不要用别处的内容充数。',
  ].join('\n')

  const job = jobTitle ? `求职职位（仅供判断相关性）：${jobTitle}\n` : ''
  const ask = instruction.trim()
    ? `用户的补充要求：${instruction.trim()}\n`
    : '（用户未给额外要求，请尽量完整地填入。）\n'
  const user = `${job}${ask}\n【简历原文】\n${sourceText}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 文本预算：与 aiGuard 的单条消息上限留出余量 */
export const SOURCE_BUDGET = 6000

/**
 * 裁剪来源文本：优先保留开头（简历的姓名与最近经历通常在前），
 * 超长时截断并明确标注，让模型知道自己看到的是节选。
 */
export function clipSource(text: string, budget = SOURCE_BUDGET): string {
  const clean = String(text || '')
    // 折叠多余空行：PDF 提取常见一页里几十个空行，白占预算
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (clean.length <= budget) return clean
  return `${clean.slice(0, budget)}\n（原文过长，此处为节选）`
}

/** 从模型回复里抠出 JSON —— 容忍代码块与前后缀文字 */
export function parseJsonReply(text: string): Record<string, unknown> {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('AI 没有返回可用的结果，请重试或换个说法')
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('AI 返回的 JSON 格式有误，请重试')
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * 从上传的文件里取出纯文本，作为 AI 的输入。
 *
 * 支持 PDF（复用已有的 pdf.js 提取，与「PDF 简历导入」同一套实现）、
 * 以及纯文本 / Markdown。不做 Word / 图片 OCR —— 前者浏览器里要额外解析库、
 * 后者要 OCR 服务，都超出「自带 Key 的本地工具」这个范围，宁可明确告知不支持。
 *
 * @throws 文件类型不支持，或 PDF 没有文字层（扫描件）
 */
export async function sourceTextFromFile(file: File): Promise<string> {
  const name = String(file.name || '').toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  const isText =
    file.type.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown')

  if (isPdf) {
    const { extractPdfLines } = await import('./pdfImport')
    const lines = await extractPdfLines(await file.arrayBuffer())
    if (!lines.length) {
      throw new Error('这份 PDF 没有文字层（可能是扫描件或图片导出），无法读取文字')
    }
    // 按页聚合，页与页之间留空行，帮助模型分辨分页
    let page = lines[0].page
    const out: string[] = []
    for (const line of lines) {
      if (line.page !== page) {
        out.push('')
        page = line.page
      }
      out.push(line.text)
    }
    return out.join('\n')
  }

  if (isText) return await file.text()

  throw new Error('目前只支持 PDF 与纯文本 / Markdown 文件（Word 与扫描图片暂不支持）')
}
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * 把模型返回的 JSON 归一化成可以直接合并进模块的对象。
 *
 * 只挑认识的字段，并丢掉空值 —— 模型多给的键、空字符串都不写回，
 * 避免把「没提取到」变成「把原有内容清空」。
 */
export function normalizeFillResult(
  raw: Record<string, unknown>,
  target: FillTarget,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const put = (key: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
    else if (Array.isArray(value) && value.length) out[key] = value
  }

  if (target.kind === 'basics') {
    put('name', str(raw.name))
    put('jobTitle', str(raw.jobTitle))
    const fields = arr(raw.fields)
      .map((f) => {
        const o = rec(f)
        const label = str(o.label)
        const value = str(o.value)
        // 复用工厂而不是手搓对象：字段的 id 由工厂生成，漏掉会让纸上 key 重复
        return label && value ? createMeta(label, value) : null
      })
      .filter(Boolean)
    if (fields.length) out.fields = fields
    return out
  }

  switch (target.sectionType) {
    case 'grid': {
      const items = arr(raw.items)
        .map((i) => {
          const o = rec(i)
          const label = str(o.label)
          const value = str(o.value)
          return label && value ? createGridItem({ icon: 'none', label, value }) : null
        })
        .filter(Boolean)
      if (items.length) out.items = items
      break
    }
    case 'entries': {
      const items = arr(raw.items)
        .map((i) => {
          const o = rec(i)
          const entry = createEntry()
          for (const key of ['time', 'org', 'role'] as const) {
            const v = str(o[key])
            if (v) entry[key] = v
          }
          entry.meta = arr(o.meta)
            .map((m) => {
              const mo = rec(m)
              const label = str(mo.label)
              const value = str(mo.value)
              return label && value ? createMeta(label, value) : null
            })
            .filter(Boolean) as typeof entry.meta
          entry.bullets = arr(o.bullets)
            .map((b) => (typeof b === 'string' ? b.trim() : str(rec(b).text)))
            .filter((b) => b.length)
            .map((text) => createBullet(text))
          // 连机构名都没提取到、也没有要点，就当作没这条
          const meaningful = entry.org || entry.role || entry.time || entry.bullets.length
          return meaningful ? entry : null
        })
        .filter(Boolean)
      if (items.length) out.items = items
      break
    }
    case 'skills': {
      const fields = arr(raw.fields)
        .map((f) => {
          const o = rec(f)
          const label = str(o.label)
          const value = str(o.value)
          return label && value ? createMeta(label, value) : null
        })
        .filter(Boolean)
      if (fields.length) out.fields = fields
      const items = arr(raw.items)
        .map((i) => {
          const o = rec(i)
          const name = str(o.name)
          if (!name) return null
          const level = Number(o.level)
          // 熟练度是 0-100 的整数，纸上的进度条宽度直接用它
          const safeLevel = Number.isFinite(level)
            ? Math.max(0, Math.min(100, Math.round(level)))
            : 60
          return createSkill({ name, level: safeLevel })
        })
        .filter(Boolean)
      if (items.length) out.items = items
      break
    }
    default: {
      const content = str(raw.content)
      if (content) out.content = content
    }
  }
  return out
}
