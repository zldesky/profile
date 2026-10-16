/**
 * PDF 简历导入：把（文字版）PDF 解析回可编辑的简历 JSON。
 *
 * 分两层：
 *  - extractPdfLines：pdf.js 抽取文字并按坐标聚合成行（[{ text, size, page }]），
 *    这层依赖 pdfjs-dist，浏览器环境才可运行；
 *  - buildResumeFromLines：纯函数启发式解析——识别模块标题、按日期切条目、
 *    抽取联系方式与姓名职位，单元测试直接喂合成行，不碰 pdfjs。
 *
 * 边界说明：扫描版 / 图片型 PDF 没有文字层，抽不出内容时会给出明确警告，
 * 不会产出一个空简历。启发式解析做不到完美还原，导入后提示用户核对。
 */
import type { DraftResume, DraftSection, GridItem } from '@/types/resume'

/** 模块标题 → 段落类型。允许「一、」「01.」这类编号前缀 */
const SECTION_DEFS = [
  { key: 'intent', re: /^(求职意向|求职目标|意向岗位|基本信息|联系方式)$/ },
  { key: 'work', re: /^(工作经历|工作经验|职业经历|职业经验|工作背景|实习经历|实习经验)$/ },
  { key: 'project', re: /^(项目经历|项目经验|项目实践|核心项目)$/ },
  { key: 'edu', re: /^(教育背景|教育经历|学习经历)$/ },
  { key: 'skills', re: /^(技能特长|专业技能|核心技能|技能|IT技能)$/ },
  { key: 'cert', re: /^(荣誉奖项|获奖经历|荣誉|证书|资格证书)$/ },
  { key: 'summary', re: /^(自我评价|自我介绍|个人总结|个人优势|关于我)$/ },
] as const

type SectionKey = (typeof SECTION_DEFS)[number]['key']

/** 条目起始行的时间段，覆盖 2022-03 / 2022.03 / 2022年3月 / 2022-03 - 至今 等写法 */
const TIME_RE =
  /(?:19|20)\d{2}\s*[.\-/年]?\s*\d{1,2}\s*月?\s*(?:[-–—~至到]\s*(?:(?:19|20)\d{2}\s*[.\-/年]?\s*\d{1,2}\s*月?|至今|现在|目前|今))?/

const PHONE_RE = /(?:1[3-9]\d{9}|\d{3,4}-\d{4}-\d{4}|\d{3,4}-\d{7,8}(?:-\d{3,4})?)/
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const BULLET_RE = /^[-–—•·●▪◦‣►»]+\s*/
const LABEL_RE = /^([^：:]{1,10})[：:]\s*(.+)$/
const NUMBERING_RE = /^[一二三四五六七八九十\d]{1,3}\s*[、..．]\s*/

/** pdfjs 是体积大头，且 worker 只在真正导入时才需要：首次调用时懒加载 */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      if (typeof window === 'undefined') {
        // Node（集成测试环境）：用 legacy 构建 + 真实文件路径。
        // 计算型 import 配合 @vite-ignore，Vite 不会把这条 Node 分支打进浏览器包。
        const legacy = 'pdfjs-dist/legacy/build/pdf.mjs'
        const lib = await import(/* @vite-ignore */ legacy)
        const { createRequire } = await import(/* @vite-ignore */ 'node:module')
        const { pathToFileURL } = await import(/* @vite-ignore */ 'node:url')
        // worker 在 Node 里经动态 import 加载，Windows 下必须是 file:// URL
        lib.GlobalWorkerOptions.workerSrc = pathToFileURL(
          createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
        ).href
        return lib
      }
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ])
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })()
  }
  return pdfjsPromise
}

/** 从 PDF 抽出的一个视觉行 */
export interface PdfLine {
  text: string
  size: number
  page: number
}

interface RowItem {
  str: string
  x: number
  right: number
  size: number
}

interface PdfRow {
  y: number
  size: number
  items: RowItem[]
}

/**
 * 抽取 PDF 文本并按坐标聚合成行。
 * @param data PDF 二进制
 */
export async function extractPdfLines(data: ArrayBuffer): Promise<PdfLine[]> {
  const pdfjs = await loadPdfjs()
  const pdf = await pdfjs.getDocument({ data }).promise

  /** 最多解析前 3 页：简历超过 3 页基本不是简历排版 */
  const maxPage = Math.min(pdf.numPages, 3)
  const lines: PdfLine[] = []

  for (let pageNo = 1; pageNo <= maxPage; pageNo += 1) {
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()

    /** 按 y 坐标聚类（容差取字号一半），同一视觉行合成一条 */
    const rows: PdfRow[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const x = item.transform[4]
      const y = item.transform[5]
      const size = Math.hypot(item.transform[2], item.transform[3]) || 10
      const row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, r.size * 0.45))
      if (row) {
        row.items.push({ str: item.str, x, right: x + (item.width || 0), size })
        row.size = Math.max(row.size, size)
      } else {
        rows.push({
          y,
          size,
          items: [{ str: item.str, x, right: x + (item.width || 0), size }],
        })
      }
    }

    rows.sort((a, b) => b.y - a.y)
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x)
      let text = ''
      let prevRight = -Infinity
      for (const item of row.items) {
        // 条目间隙超过 0.25em 视为视觉分栏，补一个空格，供后续切分 org / role
        if (text && item.x - prevRight > row.size * 0.25) text += ' '
        text += item.str
        prevRight = item.right
      }
      const clean = text.replace(/\s+/g, ' ').trim()
      if (clean) lines.push({ text: clean, size: row.size, page: pageNo })
    }
  }

  return lines
}

/** 去掉「一、」这类编号前缀后匹配模块标题，命中返回段落键 */
function matchSection(text: string): SectionKey | null {
  const bare = text.replace(NUMBERING_RE, '').trim()
  const def = SECTION_DEFS.find((item) => item.re.test(bare))
  return def && bare.length <= 10 ? def.key : null
}

/** 从一行里提取时间段；没有时间段返回 null */
function extractTime(text: string): string | null {
  const match = text.match(TIME_RE)
  if (!match) return null
  return match[0].trim()
}

/** 条目解析的中间形态：归一化时再补 id / meta 等 */
interface DraftEntry {
  time: string
  org: string
  role: string
  meta: unknown[]
  bullets: { text: string }[]
}

/**
 * 切分条目行：时间段之后的部分按空格 / 竖线拆成机构与职位。
 * 我们的模板把 time / org / role 排在同一视觉行，PDF 抽出来是
 * 「2022-03 - 至今 某某公司 高级工程师」；分隔粒度启发式处理，导入后可改。
 */
function splitEntryLine(text: string): DraftEntry | null {
  const time = extractTime(text)
  if (!time) return null
  const rest = text
    .slice(text.indexOf(time) + time.length)
    .replace(/^[\s|·,，]+/, '')
    .trim()
  const parts = rest.split(/\s+/).filter(Boolean)
  if (!parts.length) return { time, org: '', role: '', meta: [], bullets: [] }
  if (parts.length === 1) return { time, org: parts[0], role: '', meta: [], bullets: [] }
  return { time, org: parts[0], role: parts.slice(1).join(' '), meta: [], bullets: [] }
}

/** 从导入前的自由文本行里找出姓名与求职岗位 */
function extractHead(head: PdfLine[]): { name: string; jobTitle: string } {
  let name = ''
  let jobTitle = ''
  if (head.length) {
    const maxSize = Math.max(...head.map((line) => line.size))
    // 姓名 = 头部字号最大、长度 2-6 且不含数字的行；否则退第一条
    const nameLine = head.find(
      (line) =>
        line.size >= maxSize * 0.85 &&
        line.text.length >= 2 &&
        line.text.length <= 6 &&
        !/\d/.test(line.text),
    )
    name = (nameLine || head[0]).text.trim()
    const rest = head.filter((line) => line !== nameLine)
    // 求职岗位 = 紧随其后、含职位关键词且较短的那行
    jobTitle =
      rest.find(
        (line) =>
          line.text.length <= 20 &&
          /(工程|经理|设计|专员|主管|总监|教师|顾问|运营|产品|市场|财务|人事|开发|分析|架构|运营|编辑|记者|医生|律师|会计)/.test(
            line.text,
          ),
      )?.text || ''
  }
  return { name, jobTitle }
}

/**
 * 启发式主函数：行 → 简历 JSON（未 normalize，交给 store.importAsDoc）。
 */
export function buildResumeFromLines(lines: PdfLine[]): {
  resume: DraftResume
  warnings: string[]
} {
  const warnings: string[] = []
  const head: PdfLine[] = []
  const buckets: Record<SectionKey, string[] | DraftEntry[]> = {
    intent: [],
    work: [],
    project: [],
    edu: [],
    skills: [],
    cert: [],
    summary: [],
  }
  let section: SectionKey | null = null
  let current: DraftEntry | null = null
  let rawCount = 0

  for (const line of lines) {
    const text = line.text.replace(BULLET_RE, '').trim()
    if (!text) continue
    rawCount += 1

    const title = matchSection(text)
    if (title) {
      // 切换模块前先提交上一模块的待写条目，否则最后一条会被丢弃
      if (current && section) {
        ;(buckets[section] as DraftEntry[]).push(current)
        current = null
      }
      section = title
      continue
    }

    if (!section) {
      head.push({ text, size: line.size, page: line.page })
      continue
    }

    if (section === 'work' || section === 'project' || section === 'edu') {
      const entry = splitEntryLine(text)
      if (entry) {
        if (current) (buckets[section] as DraftEntry[]).push(current)
        current = entry
        continue
      }
      if (current) {
        // 紧跟条目行的短行优先当职位（部分模板把 role 排在 org 下一行）
        if (!current.role && text.length <= 24 && !current.bullets.length) {
          current.role = text
        } else {
          current.bullets.push({ text })
        }
      } else {
        ;(buckets.summary as string[]).push(text)
      }
      continue
    }

    ;(buckets[section] as string[]).push(text)
  }
  if (current && section) (buckets[section] as DraftEntry[]).push(current)

  /* ---------------- 头部：姓名 / 求职岗位 / 联系方式 ---------------- */

  const { name, jobTitle } = extractHead(head)
  if (!name) warnings.push('没有识别出姓名，请手动补充')
  if (!jobTitle) warnings.push('没有识别出求职岗位，请手动补充')

  const allText = lines.map((line) => line.text).join('\n')
  const fields = []
  const phone = allText.match(PHONE_RE)?.[0]
  const email = allText.match(EMAIL_RE)?.[0]
  if (phone) fields.push({ icon: 'phone' as const, label: '联系电话', value: phone })
  if (email) fields.push({ icon: 'mail' as const, label: '联系邮箱', value: email })
  if (!phone && !email) warnings.push('没有识别出联系方式，请手动补充')

  /* ---------------- 各段落 → 模块 ---------------- */

  const sections: DraftSection[] = []
  const intentItems = (buckets.intent as string[])
    .map((text) => {
      const labeled = text.match(LABEL_RE)
      return labeled
        ? { icon: 'briefcase' as const, label: labeled[1].trim(), value: labeled[2].trim() }
        : { icon: 'briefcase' as const, label: '求职意向', value: text }
    })
    // 纯联系方式行已抽进 basics.fields，不再当求职意向
    .filter((item) => item.value && !PHONE_RE.test(item.value) && !EMAIL_RE.test(item.value))
  if (intentItems.length) {
    sections.push({ type: 'grid', title: '求职意向', visible: true, items: intentItems })
  }

  const entrySection = (key: SectionKey, title: string): void => {
    const items = buckets[key] as DraftEntry[]
    if (!items.length) return
    sections.push({
      type: 'entries',
      title,
      visible: true,
      showLogo: false,
      items: items.filter((item) => item.org || item.bullets.length),
    })
  }
  entrySection('work', '工作经历')
  entrySection('project', '项目经历')
  entrySection('edu', '教育背景')

  const skillFields: { label: string; value: string }[] = []
  const skillItems: { name: string; level: number }[] = []
  for (const text of buckets.skills as string[]) {
    const labeled = text.match(LABEL_RE)
    if (labeled) {
      skillFields.push({ label: labeled[1].trim(), value: labeled[2].trim() })
    } else {
      // 分隔符不含斜杠与间隔号：'Vue / TypeScript' 这类技能名不能被拆散
      for (const skillName of text.split(/[、，,;；]+/)) {
        const clean = skillName.trim()
        if (clean.length >= 1 && clean.length <= 24) skillItems.push({ name: clean, level: 80 })
      }
    }
  }
  if (skillFields.length || skillItems.length) {
    sections.push({
      type: 'skills',
      title: '技能特长',
      visible: true,
      showBars: false,
      fields: skillFields,
      items: skillItems.slice(0, 20),
    })
  }

  if (buckets.cert.length) {
    sections.push({
      type: 'grid',
      title: '荣誉证书',
      visible: true,
      items: (buckets.cert as string[])
        .slice(0, 20)
        .map((text) => ({ icon: 'award' as const, label: '荣誉', value: text })),
    })
  }

  const summaryText = (buckets.summary as string[]).join('')
  if (summaryText) {
    sections.push({ type: 'text', title: '自我评价', visible: true, content: summaryText })
  }

  /** 兜底：一行都没识别出结构时，把全文塞进文本模块，至少可编辑 */
  if (!sections.length && rawCount) {
    warnings.push('没有识别出常见的模块结构，已放入「原文内容」，请手动整理')
    sections.push({
      type: 'text',
      title: '原文内容',
      visible: true,
      content: lines.map((line) => line.text).join('\n'),
    })
  }

  return {
    resume: {
      template: 'classic',
      basics: { name, jobTitle, avatar: '', showAvatar: false, fields: fields as GridItem[] },
      sections,
    },
    warnings,
  }
}

/**
 * 解析 PDF 文件为可编辑简历。
 */
export async function parseResumePdf(
  file: File,
): Promise<{ resume: DraftResume; warnings: string[] }> {
  const data = await file.arrayBuffer()
  const lines = await extractPdfLines(data)
  if (!lines.length) {
    throw new Error('这份 PDF 没有文字层（可能是扫描件），无法自动解析，请改用 JSON 导入或手动录入')
  }
  const result = buildResumeFromLines(lines)
  if (!result.resume.basics.name) {
    result.warnings.unshift('姓名识别失败，请导入后核对')
  }
  return result
}
