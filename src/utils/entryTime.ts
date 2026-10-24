/**
 * 经历时间区间的解析与格式化（纯函数，无 DOM、无 Vue）。
 *
 * 为什么值得单独一层：
 *  同一段时间有两个读者 —— 一致性检查（两段经历是否重叠）与界面上的时间选择器。
 *  两边各写一份解析，迟早会出现「检查说没重叠、界面显示成另一个区间」这种自相矛盾。
 *
 * 一条贯穿全文件的规矩：**解析不出来就不猜。**
 * 猜错会直接造成误报（把「大学期间」当成某个月，然后报「时间重叠」），
 * 而误报比漏报更伤信任 —— 用户会因此关掉整个检查功能。
 */

/** 年份-月份；`null` 表示未识别 */
export interface MonthPoint {
  year: number
  month: number
}

export interface TimeRange {
  start: MonthPoint
  /** null 表示「至今」 */
  end: MonthPoint | null
  /** 是否识别出了「至今」 */
  ongoing: boolean
}

/**
 * 界面用的三段式结果。
 *
 *  - `empty`      ：还没填，显示空的年月选择器；
 *  - `structured` ：解析出了结构，显示选择器并预填；
 *  - `freeform`   ：像「大学期间」「2019 上半年」这种自由写法，**保留文本框**，
 *                   绝不强行改写成年月，也绝不把它当成某个区间去比重叠。
 */
export type TimeInput =
  { kind: 'empty' } | { kind: 'structured'; range: TimeRange } | { kind: 'freeform' }

/*
 * 年份必须**不紧邻其它数字**。
 *
 * 踩坑现场：`2022 - 2024` 被解析成「2022 年 20 月」。
 * 原正则 `(\d{4})\s*[年\-/.]\s*(\d{1,2})` 的 `\d{4}` 从第一个 `2022` 起步没问题，
 * 但分隔符类里含 `-`，于是 ` - 2` 被当成「年-月」的分隔，月份抓到 `2024` 的前两位 `20`。
 * 只要年份前后都不允许再跟数字，`2024` 就不会被当成月份。
 * 这条是测试先红、才发现的 —— 不是推理出来的。
 */
const DATE_RE = /(?<!\d)(\d{4})\s*[年\-/.]\s*(\d{1,2})(?!\d)/g
const YEAR_ONLY_RE = /(?<!\d)(?:19|20)\d{2}(?!\d)/g
const ONGOING_RE = /至今|现在|目前|present|now/i

function collectDates(text: string): MonthPoint[] {
  return (
    [...text.matchAll(DATE_RE)]
      .map((m) => ({ year: Number(m[1]), month: Number(m[2]) }))
      // 月份越界的写法（如 2022-13）一律不认，交给 freeform 回退
      .filter((point) => point.month >= 1 && point.month <= 12)
  )
}

function collectYears(text: string): number[] {
  return [...text.matchAll(YEAR_ONLY_RE)]
    .map((m) => Number(m[0]))
    .filter((year) => year >= 1950 && year <= 2100)
}

/**
 * 解析一段经历的时间文本。
 *
 * 支持的写法（文档示例、用户手打、PDF 导入实际会产出的）：
 *   `2022-06 - 至今`、`2022.6 ~ 2023.11`、`2022年6月—2023年11月`、`2022 - 2024`、`2019`
 * 解析不出来就返回 null。
 */
export function parseTimeRange(text: string): TimeRange | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null

  const dates = collectDates(raw)
  const ongoing = ONGOING_RE.test(raw)

  if (dates.length >= 2) {
    return { start: dates[0], end: dates[1], ongoing: false }
  }
  if (dates.length === 1) {
    if (ongoing) return { start: dates[0], end: null, ongoing: true }
    return { start: dates[0], end: dates[0], ongoing: false }
  }

  /*
   * 只有年份：`2022 - 2024` / `2022`。
   * 用整年近似（1 月 ~ 12 月），不做月份推测 —— 用户没写月份，猜一个只会制造误报。
   *
   * 但「只有一个年份、且原文里没有区间分隔符」时**不算区间**：
   * `2019 上半年`、`2022 届` 这类写法里的年份是描述的一部分，不是完整的起止时间。
   * 把它们当成「2019 全年」会让界面把用户原本的写法改掉（freeform 变成 structured），
   * 也会让重叠检查拿一个并不存在的区间去比。测试就是从这条抓出来的。
   */
  const years = collectYears(raw)
  const hasRangeSeparator = /[-~–—至到]/.test(raw)
  if (years.length >= 2) {
    return {
      start: { year: years[0], month: 1 },
      end: { year: years[1], month: 12 },
      ongoing: false,
    }
  }
  if (years.length === 1 && hasRangeSeparator) {
    if (ongoing) return { start: { year: years[0], month: 1 }, end: null, ongoing: true }
    return {
      start: { year: years[0], month: 1 },
      end: { year: years[0], month: 12 },
      ongoing: false,
    }
  }
  return null
}

/**
 * 界面用的三分支判定：空 / 可结构化 / 只能自由填写。
 *
 * `parseTimeRange` 与这里的差别在于**空字符串**：解析函数对空返回 null，
 * 但界面上「空」和「写了看不懂的东西」是两种完全不同的状态 ——
 * 前者该显示空的年月选择器，后者必须保留用户原本的文字。
 */
export function readTimeInput(text: string): TimeInput {
  const raw = String(text ?? '').trim()
  if (!raw) return { kind: 'empty' }
  const range = parseTimeRange(raw)
  if (range) return { kind: 'structured', range }
  return { kind: 'freeform' }
}

/** 月份序号，便于比较 */
export function monthIndex(point: MonthPoint): number {
  return point.year * 12 + (point.month - 1)
}

/**
 * 两个时间区间是否重叠。
 * 「至今」视为无限远；同月交接**不算**重叠 —— 换工作是常态。
 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  const aStart = monthIndex(a.start)
  const aEnd = a.end ? monthIndex(a.end) : Number.POSITIVE_INFINITY
  const bStart = monthIndex(b.start)
  const bEnd = b.end ? monthIndex(b.end) : Number.POSITIVE_INFINITY
  return aStart < bEnd && bStart < aEnd
}

/** `YYYY-MM` */
export function formatYearMonth(point: MonthPoint | null): string {
  if (!point) return ''
  return `${point.year}-${String(point.month).padStart(2, '0')}`
}

/**
 * 把时间区间归一成统一的展示写法：`YYYY-MM - YYYY-MM` / `YYYY-MM - 至今`。
 * 解析不出来时原样返回 fallback，绝不改写用户的自由输入。
 */
export function formatTimeRange(range: TimeRange | null, fallback = ''): string {
  if (!range) return fallback
  return `${formatYearMonth(range.start)} - ${range.ongoing ? '至今' : formatYearMonth(range.end)}`
}

/** 界面选择器的一份取值，字段都可为空（表示还没选） */
export interface TimePickerValue {
  startYear: number | null
  startMonth: number | null
  endYear: number | null
  endMonth: number | null
  ongoing: boolean
}

export const EMPTY_PICKER_VALUE: TimePickerValue = {
  startYear: null,
  startMonth: null,
  endYear: null,
  endMonth: null,
  ongoing: false,
}

/** 从结构化区间取出选择器取值 */
export function toPickerValue(range: TimeRange | null): TimePickerValue {
  if (!range) return { ...EMPTY_PICKER_VALUE }
  return {
    startYear: range.start.year,
    startMonth: range.start.month,
    endYear: range.end?.year ?? null,
    endMonth: range.end?.month ?? null,
    ongoing: range.ongoing,
  }
}

/**
 * 把选择器取值拼回存储用的字符串。
 *
 * 规则（刻意保守）：
 *  - 开始时间没选全 → 返回空串。半截数据比空数据更糟：`2022-  - 至今` 这种会被纸面原样印出来。
 *  - 勾了「至今」→ 忽略结束时间，写成 `YYYY-MM - 至今`。
 *  - 结束时间没选全 → 只写开始，例如 `2022-06`。这是简历里合法的写法（在职中/时间待定）。
 */
export function fromPickerValue(value: TimePickerValue): string {
  const { startYear, startMonth, endYear, endMonth, ongoing } = value
  if (!startYear) return ''
  const start = formatYearMonth({
    year: startYear,
    month: startMonth ?? 1,
  })

  if (ongoing) return `${start} - 至今`
  if (endYear && endMonth) {
    return `${start} - ${formatYearMonth({ year: endYear, month: endMonth })}`
  }
  return start
}

/**
 * 选择器里的年份候选：当前年 +5 到 -40。
 * 上限留 5 年（应届生会写未来毕业时间），下限 40 年（再往前的工作年限直接用文本框更合适）。
 */
export function yearOptions(now = new Date()): number[] {
  const current = now.getFullYear()
  const years: number[] = []
  for (let year = current + 5; year >= current - 40; year -= 1) years.push(year)
  return years
}

export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)
