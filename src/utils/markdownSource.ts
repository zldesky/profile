/**
 * Markdown 作为一等内容源：解析与序列化。
 *
 * 目标（仿 LapisCV 的多种使用方式）：同一份 Markdown，
 * 既能在 VSCode / Typora / Obsidian 里直接写与预览，也能导回本项目编辑、导出 PDF。
 * 所以这个模块同时提供两个方向，且**共用一套格式约定**：
 *
 *   resumeToSourceMarkdown(resume)  ——  简历 → Markdown
 *   markdownToResume(markdown)      ——  Markdown → 简历（产出 DraftResume，交给 normalizeResume 补 id）
 *
 * ── 格式约定（与 LapisCV 同源，H1/H2/H3 + 列表）────────────────────────
 *
 *   # 姓名                    一级标题 = 姓名块
 *   **职位**                  独占一行的粗体 = 职位
 *   - **标签**：值              基本信息字段
 *   ## 模块标题                二级标题 = 模块（栏）
 *   ### 机构 · 职位            三级标题 = 条目
 *   时间                       紧跟三级标题的普通行 = 时间
 *   - **标签**：值              条目的补充字段
 *   - 要点文本                 条目的要点
 *   - **标签**：值              网格项 / 技能描述字段
 *   - 技能名                   技能条目（无冒号）
 *   普通段落                   文本模块（自我评价）
 *
 * ── 一处关键的取舍：为什么键值行要写成粗体 ──────────────────────────
 *
 * 要点里出现中文冒号是**很常见**的（「重构了构建流程：耗时降 90%」）。
 * 如果键值行和要点都写成 `- 文本：文本`，两者就无法区分 ——
 * 往返一次，带冒号的要点会被静默改成「补充字段」，这是最坏的一类失真（改了数据还不报错）。
 * 所以规范格式把键值行的**标签加粗**，作为无歧义的标记：
 * 粗体 + 冒号 = 键值，其余 = 要点。
 * 加粗对 ATS 解析无影响（纯文本提取会去掉标记）。
 *
 * ── 精确模式 vs 兼容模式 ────────────────────────────────────────────
 *
 * 序列化默认在模块标题后写一行类型提示（HTML 注释，渲染时不可见）：
 *
 *   ## 工作经历
 *   <!-- resume:type=entries -->
 *
 * 解析时：
 *  - **有提示** → 模块类型确定，`- 文本：文本` 在 entries 里一律当作**要点**（精确往返）；
 *  - **无提示** → 类型靠内容猜，此时 entries 里 `- 标签：值` 按惯例当作**补充字段**（兼容手写）。
 * 两条规则都写进下面的注释与 README，不留隐含行为。
 *
 * ── 明确不往返的东西 ───────────────────────────────────────────────
 *
 * 主题（颜色 / 字体 / 字号 / 页边距）、模板 id、模块布局（对齐 / 缩进 / 列数）、
 * 头像（DataURL 太大，不写进 Markdown）、隐藏模块（导出时就被跳过）。
 * 这些在导入时由 normalizeResume 取默认值 —— 也就是说
 * **Markdown 是「内容的源」，不是「整份文档的源」**。
 */

import type { DraftResume, DraftSection, IconName, SectionType } from '@/types/resume'

/* ---------------- 常量 ---------------- */

/** 类型提示的固定前缀。写成 HTML 注释：渲染不可见、ATS 提取时被忽略 */
const TYPE_HINT_PREFIX = 'resume:type='

/** 条目标题里机构与职位之间的分隔符，与导出保持一致 */
const ENTRY_SEPARATOR = ' · '

/** 中文冒号。导出用全角，解析时全角半角都认 */
const COLON = '：'

const str = (value: unknown): string => String(value ?? '').trim()

/*
 * 序列化的入参是 `unknown`（调用方可能从任何地方拿到一份"简历"）。
 * 这两个小工具把不可信输入收窄成可索引的形状，
 * 于是内部不必写 `any`（本仓库 eslint 禁止显式 any），
 * 而每个字段仍然逐处用 str() 兜底。
 */
const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/* ---------------- 序列化 ---------------- */

export interface SourceMarkdownOptions {
  /**
   * 是否写出模块类型提示。默认 true —— 需要精确往返时必须有它。
   * 关掉之后输出与 exporters.js 的 resumeToMarkdown 形状一致（纯 ATS 取向）。
   */
  hints?: boolean
}

/** 键值行。标签加粗是无歧义标记，见文件头的说明 */
const kv = (label: string, value: string) => `- **${str(label) || '信息'}**${COLON}${str(value)}`

/**
 * 渲染为「内容源」Markdown。
 *
 * 隐藏模块不输出（与既有导出行为一致）：Markdown 里没有地方表达 visible=false，
 * 输出再解析回来会多出一个不该显示的模块。
 */
export function resumeToSourceMarkdown(
  resume: unknown,
  options: SourceMarkdownOptions = {},
): string {
  const hints = options.hints !== false
  const root = rec(resume)
  const basics = rec(root.basics)
  const lines: string[] = []

  lines.push(`# ${str(basics.name) || '简历'}`)
  if (str(basics.jobTitle)) lines.push('', `**${str(basics.jobTitle)}**`)

  const contact = arr(basics.fields).filter((f) => str(rec(f).value))
  if (contact.length) {
    lines.push('', ...contact.map((f) => kv(str(rec(f).label), str(rec(f).value))))
  }

  const sections = arr(root.sections).filter((s) => rec(s).visible !== false)

  for (const raw of sections) {
    const section = rec(raw)
    const title = str(section.title) || '未命名模块'
    lines.push('', `## ${title}`)
    if (hints && isSectionType(section.type)) {
      lines.push(`<!-- ${TYPE_HINT_PREFIX}${section.type} -->`)
    }

    if (section.type === 'entries') {
      for (const rawEntry of arr(section.items)) {
        const entry = rec(rawEntry)
        const heading = [str(entry.org), str(entry.role)].filter(Boolean).join(ENTRY_SEPARATOR)
        if (heading) lines.push('', `### ${heading}`)
        if (str(entry.time)) lines.push(str(entry.time))
        for (const rawMeta of arr(entry.meta)) {
          const m = rec(rawMeta)
          if (str(m.value)) lines.push(kv(str(m.label), str(m.value)))
        }
        for (const rawBullet of arr(entry.bullets)) {
          const b = rec(rawBullet)
          if (str(b.text)) lines.push(`- ${str(b.text)}`)
        }
      }
    } else if (section.type === 'grid') {
      for (const rawItem of arr(section.items)) {
        const item = rec(rawItem)
        if (str(item.value)) lines.push(kv(str(item.label), str(item.value)))
      }
    } else if (section.type === 'skills') {
      for (const rawField of arr(section.fields)) {
        const f = rec(rawField)
        if (str(f.value)) lines.push(kv(str(f.label), str(f.value)))
      }
      for (const rawSkill of arr(section.items)) {
        const s = rec(rawSkill)
        if (str(s.name)) lines.push(`- ${str(s.name)}`)
      }
    } else if (section.type === 'text') {
      if (str(section.content)) lines.push('', str(section.content))
    }
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

function isSectionType(value: unknown): value is SectionType {
  return value === 'grid' || value === 'entries' || value === 'skills' || value === 'text'
}

/* ---------------- 解析 ---------------- */

/** 匹配 `- **标签**：值`（键值行的无歧义形式） */
const KV_BOLD_RE = /^[-*]\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$/
/** 匹配 `- 标签：值`（兼容形式，仅非 entries 上下文按键值处理） */
const KV_PLAIN_RE = /^[-*]\s+(.+?)\s*[：:]\s*(.*)$/
/** 匹配 `- 文本`（列表项） */
const LIST_RE = /^[-*]\s+(.*)$/
/** 一级 / 二级 / 三级标题 */
const H1_RE = /^#\s+(.*)$/
const H2_RE = /^##\s+(.*)$/
const H3_RE = /^###\s+(.*)$/
/** 独占一行的粗体：职位 */
const BOLD_ONLY_RE = /^\*\*(.+?)\*\*$/
/** 类型提示注释 */
const TYPE_HINT_RE = /^<!--\s*resume:type=([a-z]+)\s*-->$/
/** 头像：<img alt="avatar" src="...">，LapisCV 用这个写法 */
const AVATAR_RE = /<img[^>]*\balt=["']avatar["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i
/** 分隔线：LapisCV 用它标记分页。本项目的分页是自动的，这里只识别并跳过 */
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/

/**
 * 解析 Markdown 为简历草稿。
 *
 * 返回的是 **DraftResume**（不含 id 与默认字段），
 * 交给 `normalizeResume` 补齐 —— 复用既有的 id 生成与字段兜底，
 * 而不是在这里再写一套造对象逻辑。
 *
 * 解析器对残缺输入一律宽容：认不出的行按内容归入最近的模块，不抛错。
 * 简历文本是用户手写的，抛错会把一次笔误升级成白屏。
 */
export function markdownToResume(markdown: string): DraftResume {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')

  /*
   * 这里的字段先声明成**不带 id** 的形状。
   * DraftBasics.fields 用的是归一化后的 GridItem（`extends Identified`，要求 id），
   * 而草稿本来就没有 id —— 补 id 是 normalizeResume 的职责（见它的 ensureId）。
   * 与 pdfImport.ts 的写法一致：先演化数组，最后在返回处断言一次，
   * 把「草稿缺 id」这一事实收在边界上，而不是把内部逻辑全写成 any。
   */
  const basics = {
    name: '',
    jobTitle: '',
    fields: [] as { icon: IconName; label: string; value: string }[],
    avatar: '',
    showAvatar: false,
  }
  const sections: DraftSection[] = []
  let avatarSrc = ''

  let i = 0
  const n = lines.length

  /* ---------- 第一阶段：姓名块（第一个二级标题之前） ---------- */
  for (; i < n; i += 1) {
    const line = lines[i].trim()
    if (H2_RE.test(line)) break
    if (!line) continue

    const avatar = AVATAR_RE.exec(line)
    if (avatar) {
      avatarSrc = avatar[1]
      continue
    }
    if (HR_RE.test(line)) continue

    const h1 = H1_RE.exec(line)
    if (h1 && !H2_RE.test(line)) {
      // 一级标题是姓名；重复出现时以第一个为准（后面那些多半是误用）
      if (!basics.name) basics.name = str(h1[1])
      continue
    }

    const bold = BOLD_ONLY_RE.exec(line)
    if (bold) {
      if (!basics.jobTitle) basics.jobTitle = str(bold[1])
      continue
    }

    const kvPair = parseKeyValue(line, true)
    if (kvPair) {
      basics.fields.push({ icon: 'none', label: kvPair.label, value: kvPair.value })
      continue
    }

    // 姓名块里剩下的普通行：没有字段可放，但也不能丢 —— 当作一条无标签信息
    if (!basics.jobTitle && !basics.fields.length) basics.jobTitle = line
  }

  /* ---------- 第二阶段：各模块 ---------- */
  while (i < n) {
    const head = H2_RE.exec(lines[i].trim())
    if (!head) {
      i += 1
      continue
    }
    const title = str(head[1]) || '未命名模块'
    i += 1

    // 标题后紧跟的类型提示（允许中间有注释型空行，但不吃正文）
    let hinted: SectionType | null = null
    while (i < n && !lines[i].trim()) i += 1
    const hint = TYPE_HINT_RE.exec(lines[i]?.trim() ?? '')
    if (hint && isSectionType(hint[1])) {
      hinted = hint[1]
      i += 1
    }

    // 收集正文，直到下一个二级标题
    const body: string[] = []
    while (i < n && !H2_RE.test(lines[i].trim())) {
      body.push(lines[i])
      i += 1
    }

    // 标题后可能还夹着一条类型提示（标题与提示之间有空行的情况已经在上面消费掉；
    // 这里再兜一次：正文首行的提示也认，避免手写时多敲一个空行就丢掉类型）
    let bodyStart = 0
    while (bodyStart < body.length && !body[bodyStart].trim()) bodyStart += 1
    const lateHint = TYPE_HINT_RE.exec(body[bodyStart]?.trim() ?? '')
    if (!hinted && lateHint && isSectionType(lateHint[1])) {
      hinted = lateHint[1]
      body.splice(bodyStart, 1)
    }

    sections.push(parseSection(title, hinted, body))
  }

  if (avatarSrc) {
    basics.avatar = avatarSrc
    basics.showAvatar = true
  }

  // 断言一次收在边界：缺 id 由 normalizeResume 补齐（见上面 basics 的说明）
  return { basics: basics as DraftResume['basics'], sections }
}

/** 键值行解析。`allowPlain` 为 false 时只认加粗形式（entries 上下文的精确判定） */
function parseKeyValue(line: string, allowPlain: boolean): { label: string; value: string } | null {
  const bold = KV_BOLD_RE.exec(line)
  if (bold) return { label: str(bold[1]), value: str(bold[2]) }
  if (!allowPlain) return null
  const plain = KV_PLAIN_RE.exec(line)
  if (plain) return { label: str(plain[1]), value: str(plain[2]) }
  return null
}

/** 按内容猜模块类型（无类型提示时的兼容路径） */
function guessSectionType(body: string[]): SectionType {
  const meaningful = body.map((l) => l.trim()).filter(Boolean)
  if (!meaningful.length) return 'text'
  if (meaningful.some((l) => H3_RE.test(l))) return 'entries'

  const lists = meaningful.filter((l) => LIST_RE.test(l))
  if (lists.length) {
    // 有「带冒号的键值行」也有「不带冒号的裸列表项」→ 技能（描述字段 + 技能条目）
    const withColon = lists.filter((l) => KV_PLAIN_RE.test(l)).length
    const bare = lists.length - withColon
    if (withColon > 0 && bare > 0) return 'skills'
    // 全是裸列表项：技能条目（无描述字段）比「网格里有空值的项」合理得多
    if (withColon === 0) return 'skills'
    return 'grid'
  }
  return 'text'
}

function parseSection(title: string, hinted: SectionType | null, body: string[]): DraftSection {
  const type = hinted ?? guessSectionType(body)

  if (type === 'entries') {
    // precise 看的是 hinted，不是 type：类型是提示给的时候，才敢断言「非加粗列表项就是要点」
    return { type, title, visible: true, items: parseEntries(body, hinted === 'entries') }
  }
  if (type === 'grid') return { type, title, visible: true, items: parseGridItems(body) }
  if (type === 'skills') {
    const { fields, items } = parseSkills(body)
    return { type, title, visible: true, fields, items }
  }
  return { type: 'text', title, visible: true, content: parseText(body) }
}

/** 解析中途的条目形状：与 EntryItem 同构，但不带 id（补 id 是 normalizeResume 的职责） */
interface DraftEntry {
  org: string
  role: string
  time: string
  logo: string
  meta: { label: string; value: string }[]
  bullets: { text: string }[]
}

/**
 * 条目列表：`### 机构 · 职位` + 时间 + 补充字段 + 要点。
 *
 * `precise` = 该模块的类型是**提示给的**（规范格式），此时只有加粗键值行算补充字段，
 * 其余列表项一律是要点 —— 「主修课程：数据结构…」这类带中文冒号的要点才能精确往返。
 * 没有提示时（手写输入）退回「带冒号即键值」的惯例。
 *
 * 早先版本用「是不是第一条列表项」来猜，那个启发式很脆：
 * 要点与补充字段的先后顺序一变，判定就反了。
 */
function parseEntries(body: string[], precise: boolean) {
  const entries: DraftEntry[] = []
  let current: DraftEntry | null = null

  for (const raw of body) {
    const line = raw.trim()
    if (!line) continue
    if (HR_RE.test(line)) continue

    const h3 = H3_RE.exec(line)
    if (h3) {
      const text = str(h3[1])
      const at = text.indexOf(ENTRY_SEPARATOR)
      current = {
        // 机构与职位用「 · 」分隔；没有分隔符时整串当机构（拆错比丢掉好辨认）
        org: at >= 0 ? str(text.slice(0, at)) : text,
        role: at >= 0 ? str(text.slice(at + ENTRY_SEPARATOR.length)) : '',
        time: '',
        logo: '',
        meta: [] as { label: string; value: string }[],
        bullets: [] as { text: string }[],
      }
      entries.push(current)
      continue
    }

    // 没有三级标题之前的正文：无法归属到某个条目，忽略（避免造出一个空机构条目）
    if (!current) continue

    const boldKv = parseKeyValue(line, false)
    if (boldKv) {
      current.meta.push(boldKv)
      continue
    }

    const list = LIST_RE.exec(line)
    if (list) {
      // 兼容模式才把「带冒号的列表项」当补充字段；精确模式下它不是要点就是字段，由加粗决定
      const plainKv = precise ? null : parseKeyValue(line, true)
      if (plainKv) {
        current.meta.push(plainKv)
      } else {
        current.bullets.push({ text: str(list[1]) })
      }
      continue
    }

    /*
     * 普通行有两种可能：紧跟标题的**时间**，或某条要点的**换行续写**。
     * 判定必须看「字段/要点是否已经开始」，只看 time 是否为空是不够的 ——
     * 那会让 `### 公司` `- 要点` `续写` 里的「续写」被当成时间（实测就是这么错的）。
     */
    const nothingYet = !current.time && !current.meta.length && !current.bullets.length
    if (nothingYet) {
      current.time = line
    } else if (current.bullets.length) {
      const last = current.bullets[current.bullets.length - 1]
      last.text = `${last.text} ${line}`
    }
  }

  return entries
}

/** 键值网格 */
function parseGridItems(body: string[]) {
  const items: { icon: IconName; label: string; value: string }[] = []
  for (const raw of body) {
    const line = raw.trim()
    if (!line || HR_RE.test(line)) continue
    const kvPair = parseKeyValue(line, true)
    if (kvPair) items.push({ icon: 'none', label: kvPair.label, value: kvPair.value })
  }
  return items
}

/** 技能：带冒号的是描述字段，不带冒号的是技能条目 */
function parseSkills(body: string[]) {
  const fields: { label: string; value: string }[] = []
  const items: { name: string; level: number }[] = []

  for (const raw of body) {
    const line = raw.trim()
    if (!line || HR_RE.test(line)) continue
    const kvPair = parseKeyValue(line, true)
    if (kvPair) {
      fields.push(kvPair)
      continue
    }
    const list = LIST_RE.exec(line)
    if (list) items.push({ name: str(list[1]), level: 80 })
  }
  return { fields, items }
}

/** 文本模块：保留段落，去掉列表标记（文本模块里不该有列表） */
function parseText(body: string[]) {
  return body
    .map((l) => l.trim())
    .filter((l) => l && !HR_RE.test(l) && !TYPE_HINT_RE.test(l))
    .join('\n')
    .trim()
}
