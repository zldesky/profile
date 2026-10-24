/**
 * 行内加粗的纯逻辑：`**加粗**` 是纸面文字唯一的行内标记。
 *
 * 为什么做成纯函数：渲染（RichText.vue）、就地编辑里的加粗切换（InlineEditor.vue）
 * 与纯文本导出（exporters.js）三处共用同一份实现 —— 同一份数据在不同出口表现
 * 不一致本身就是 bug（见 PITFALLS C4「技能名导出里有、纸面上没有」），
 * 让它们调同一组函数才不会漂移。
 *
 * 标记语法刻意收得极窄：`**内容**`，且内容里不能出现 `*`（`[^*]+`）。
 * 好处是解析无需回溯、未闭合的 `**` 按普通文字原样显示，用户手打的单个星号
 * 也不会被误吞成标记。
 */

export interface BoldSegment {
  text: string
  bold: boolean
}

interface BoldSpan {
  /** 加粗内容的起始下标（不含前导 **） */
  start: number
  /** 加粗内容的结束下标（不含尾随 **） */
  end: number
}

/** 匹配成对的 **加粗** 标记；全局正则复用时必须先重置 lastIndex */
const BOLD_RE = /\*\*([^*]+)\*\*/g

/** 解析为片段序列，渲染端据此决定哪些文字套 <strong> */
export function parseBoldSegments(raw: string): BoldSegment[] {
  const segments: BoldSegment[] = []
  let last = 0
  BOLD_RE.lastIndex = 0
  for (let m = BOLD_RE.exec(raw); m; m = BOLD_RE.exec(raw)) {
    if (m.index > last) segments.push({ text: raw.slice(last, m.index), bold: false })
    segments.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < raw.length) segments.push({ text: raw.slice(last), bold: false })
  return segments
}

/** 列出全部加粗内容区间（不含两侧 **） */
export function boldSpans(raw: string): BoldSpan[] {
  const spans: BoldSpan[] = []
  BOLD_RE.lastIndex = 0
  for (let m = BOLD_RE.exec(raw); m; m = BOLD_RE.exec(raw)) {
    spans.push({ start: m.index + 2, end: m.index + m[0].length - 2 })
  }
  return spans
}

/** 选区是否完整落在同一个加粗段的内容里（端点可贴边） */
export function isRangeInsideBold(raw: string, start: number, end: number): boolean {
  if (end <= start) return false
  return boldSpans(raw).some((span) => span.start <= start && end <= span.end)
}

export interface BoldToggleResult {
  text: string
  /** 切换后应恢复的输入框选区：保持选中，再按一次即反向切换 */
  selectionStart: number
  selectionEnd: number
}

/**
 * 对就地编辑的选区 [start, end) 做加粗/取消加粗。
 *
 *  - 选区完整落在某个加粗段内容内（端点贴边也算）→ 取消该段加粗。
 *    是**整段**去粗而不是只去选中那半段：标记模型拆开会产生
 *    `**bo**ld**` 这类碎标记，渲染与再编辑都会乱；
 *  - 否则 → 加粗：先剥掉与选区相交的既有标记（部分选中一个粗体也整体
 *    重新包一层），再把剥离后的选区包上 `**…**`。
 *
 * 返回新文本与恢复用的选区；空选区原样返回。
 */
export function toggleBoldRange(raw: string, start: number, end: number): BoldToggleResult {
  if (end <= start) return { text: raw, selectionStart: start, selectionEnd: end }
  const from = Math.max(0, Math.min(start, raw.length))
  const to = Math.max(from, Math.min(end, raw.length))

  const spans = boldSpans(raw)
  /*
   * 与选区相交的既有段，按**含两侧标记**的区间算：选区哪怕只盖住某对 ** 的一半
   * （例如框选时带上了 'a**b**' 里的 '**b'），这对标记也必须整体剥掉，
   * 否则剥离后残留的 '**' 会与包裹层拼出 '****'。
   */
  const hits = spans.filter((s) => s.start - 2 < to && s.end + 2 > from)

  if (hits.length === 1 && hits[0].start <= from && to <= hits[0].end) {
    const { start: s, end: e } = hits[0]
    return {
      text: raw.slice(0, s - 2) + raw.slice(s, e) + raw.slice(e + 2),
      selectionStart: from - 2,
      selectionEnd: to - 2,
    }
  }

  // 加粗：剥掉与选区相交的标记再整体包一层。
  // keep[i] = 原字符串第 i 个字符是否保留；map[i] = 剥离后第 i 个字符会落到的新下标。
  const keep: boolean[] = new Array(raw.length).fill(true)
  for (const s of hits) {
    for (let i = s.start - 2; i < s.start; i++) keep[i] = false
    for (let i = s.end; i < s.end + 2 && i < raw.length; i++) keep[i] = false
  }
  let stripped = ''
  const map: number[] = new Array(raw.length + 1)
  for (let i = 0; i < raw.length; i++) {
    map[i] = stripped.length
    if (keep[i]) stripped += raw[i]
  }
  map[raw.length] = stripped.length

  const innerFrom = map[from]
  const innerTo = map[to]
  const inner = stripped.slice(innerFrom, innerTo)
  // 选区剥完标记后为空（例如只选中了一对 ** 里的星号）就不包，避免产出 ****
  if (!inner) return { text: stripped, selectionStart: innerFrom, selectionEnd: innerTo }
  return {
    text: stripped.slice(0, innerFrom) + '**' + inner + '**' + stripped.slice(innerTo),
    selectionStart: innerFrom + 2,
    selectionEnd: innerTo + 2,
  }
}

/** 剥掉全部加粗标记，供纯文本导出使用（ATS 文本不应出现星号） */
export function stripBoldMarkers(raw: string): string {
  return raw.replace(BOLD_RE, '$1')
}
