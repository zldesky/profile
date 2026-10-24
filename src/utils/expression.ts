/**
 * 要点级的写作检查引擎（纯函数，无 DOM、无网络、无 Vue）。
 *
 * 与 utils/completeness 的分工：
 *   completeness  看**整份简历**的完整度（缺联系方式、模块是空的、缺教育背景）；
 *   本文件        看**一条要点**写得怎么样（弱动词、没数字、模板黑话、重复）。
 * 两者都会产出 issue，但只有这里能给出「改哪个片段」，所以它才是编辑时逐条提示的依据。
 *
 * 判不准就降级、只诊断不改写 —— 两条边界的理由写在 data/writingRules.ts 顶部。
 */
import {
  BULLET_LENGTH,
  BUZZWORDS,
  FIRST_PERSON,
  RESULT_MARKERS,
  SELF_PRAISE,
  VAGUE_SCALES,
  WEAK_VERBS,
  ruleById,
} from '@/data/writingRules'
import type { CheckLevel, RuleReplacement } from '@/data/writingRules'

/** 经历类别：同一条句子在不同模块里的判定不同（见 ctx 说明） */
export type EntryKind = 'work' | 'project' | 'education' | 'campus' | 'unknown'

export interface CheckContext {
  /**
   * 这条要点属于哪类经历。
   * 教育经历里的「主修课程：数据结构、计算机网络」是完全正常的写法，
   * 对它的第一条要点硬套「动词开头」只会让用户把正确的内容改坏。
   */
  entryKind?: EntryKind
  /** 同一段经历里的其它要点，用于重复检测 */
  siblings?: string[]
}

/** 命中片段：前端据此高亮，而不是只给一句笼统的提示 */
export interface FindingSpan {
  start: number
  end: number
}

export interface Finding {
  ruleId: string
  level: CheckLevel
  title: string
  detail: string
  /** 命中的原文片段（可能为空：整条为对象的问题，如 too-long） */
  spans: FindingSpan[]
  /** 可一键采用的替换候选；没有就是只能手改 */
  replacements: RuleReplacement[]
  /** 这条是否可以「不用管」（记 7 天） */
  dismissible: boolean
}

/** 一条要点最多报几条，避免满屏红字 */
const MAX_FINDINGS_PER_BULLET = 3

/**
 * 永不截断的规则：它们关系到「内容本身有问题」，而不是「措辞可以更好」。
 *
 * 起因是一条真实的测试失败：两条完全相同的要点，第一条要报出 4 个问题
 * （含糊程度词 / 没数字 / 自我评价 / 重复），截断后「重复」被挤掉 ——
 * 而重复恰恰是最该让用户看到的那一条。截断是为了不刷屏，不该把最重要的话挤掉。
 */
const ALWAYS_KEPT = new Set(['structure.duplicate', 'lexicon.buzzword'])

const LEVEL_ORDER: Record<CheckLevel, number> = { error: 0, warn: 1, tip: 2 }

/** 文本规范化的最小单位：全角转半角、去空白，仅用于判定，不改写原文 */
function norm(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
}

/** 中文语境的「字数」：去掉空白后的字符数，数字与英文各算一个 */
export function charCount(text: string): number {
  return String(text ?? '').replace(/\s+/g, '').length
}

/**
 * 提取所有命中片段的位置。
 * 用逐次 indexOf 而不是正则全局匹配：正则要转义用户输入里的特殊字符，
 * 而这里的候选词都是固定词组，indexOf 更直白也不会漏。
 *
 * `matchWholeLatin` 用于纯英文字母的候选（如 `my`）：它本来就不该出现在中文句子里，
 * 但如果不加词边界，`go my z` 这种就永远命中不了、而 `myself` 会被误伤。
 * 中文候选一律不加边界 —— 中文没有词分隔符，加了反而漏。
 */
function findSpans(text: string, needles: string[], matchWholeLatin = false): FindingSpan[] {
  const spans: FindingSpan[] = []
  /*
   * 先对候选去重。
   *
   * 踩过的坑：WEAK_VERBS 里「负责」出现了三次（三个不同的替换方向），
   * 于是同一个位置被扫三遍，界面上显示成「命中：负责负责负责」。
   * 候选词组本身允许重复（一个词条一种改法），但**扫描**必须按词去重。
   */
  const unique = [...new Set(needles)]
  for (const needle of unique) {
    if (!needle) continue
    if (matchWholeLatin && /^[A-Za-z]+$/.test(needle)) {
      const re = new RegExp(`(?<![A-Za-z])${needle}(?![A-Za-z])`, 'g')
      for (const m of text.matchAll(re)) {
        spans.push({ start: m.index ?? 0, end: (m.index ?? 0) + needle.length })
      }
      continue
    }
    let from = 0
    for (;;) {
      const idx = text.indexOf(needle, from)
      if (idx === -1) break
      spans.push({ start: idx, end: idx + needle.length })
      from = idx + needle.length
    }
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** 是否为「有实际内容」的文本：至少含一个中日韩汉字或字母或数字 */
function hasMeaningfulText(text: string): boolean {
  return /[\u4e00-\u9fa5\u3400-\u4dbfA-Za-z0-9]/.test(text)
}

/** 从规则条文装配一条 finding；未知 ruleId 时返回 null（宁可少报，不要抛错） */
function makeFinding(ruleId: string, spans: FindingSpan[] = []): Finding | null {
  const rule = ruleById(ruleId)
  if (!rule) return null
  return {
    ruleId: rule.id,
    level: rule.level,
    title: rule.title,
    detail: rule.detail,
    spans,
    replacements: rule.replacements ?? [],
    dismissible: rule.dismissible,
  }
}

/**
 * 相似度：最长公共子序列长度 / 较长串长度。
 *
 * 用它而不是编辑距离，是因为「删了几个字」这种差异（复述同一件事）应当判为高相似，
 * 而编辑距离对长度敏感，短句里改一个字就会掉到很低。
 * 纯逻辑、无依赖：两条 80 字以内的句子做 O(n*m) 完全够用（6400 次比较）。
 */
export function similarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  const longer = Math.max(x.length, y.length)
  const dp: number[] = new Array(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i += 1) {
    let prev = 0
    for (let j = 1; j <= y.length; j += 1) {
      const temp = dp[j]
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1])
      prev = temp
    }
  }
  return dp[y.length] / longer
}

/** 相似度达到这个值就当成「说的是同一件事」 */
export const DUPLICATE_THRESHOLD = 0.85

/** 教育经历里第一条允许「标签：内容」这种非动作句式 */
const LABEL_PREFIX_RE = /^[^：:]{2,8}[：:]/

/**
 * 检查一条要点。
 * @param text 要点原文
 * @param ctx 上下文（经历类型 + 同段其它要点）
 * @returns 最多 3 条发现，按严重度排序；没有问题时返回空数组
 */
export function analyzeBullet(text: string, ctx: CheckContext = {}): Finding[] {
  const raw = String(text ?? '')
  // 空内容、纯标点、只有空白：都交给 completeness 的「模块是空的」处理，
  // 这里再报一遍「这条几乎没信息」只是噪音
  if (!norm(raw) || !hasMeaningfulText(raw)) return []

  const findings: Finding[] = []
  const push = (finding: Finding | null) => {
    if (finding) findings.push(finding)
  }

  const charTotal = charCount(raw)
  const hasDigit = /\d/.test(raw)
  const isEducation = ctx.entryKind === 'education'
  const isLabelStyle = LABEL_PREFIX_RE.test(raw.trim())

  /* ---- 结构：长度 ---- */
  if (charTotal > BULLET_LENGTH.max) push(makeFinding('structure.too-long'))
  if (charTotal < BULLET_LENGTH.min && !hasDigit) push(makeFinding('structure.too-short'))

  /* ---- 词汇：模板黑话（最典型的「AI 味」，优先报） ---- */
  const buzz = findSpans(raw, BUZZWORDS)
  if (buzz.length) push(makeFinding('lexicon.buzzword', buzz))

  /* ---- 动词：弱动词 / 第一人称 ---- */
  // 教育经历里的「标签：内容」不算弱动词问题，它本来就不是动作句
  const skipVerbRules = isEducation && isLabelStyle
  if (!skipVerbRules) {
    const weak = findSpans(
      raw,
      WEAK_VERBS.map((item) => item.from),
    )
    if (weak.length) push(makeFinding('verb.weak', weak))
  }

  const pronouns = findSpans(raw, FIRST_PERSON, true)
  if (pronouns.length) push(makeFinding('verb.pronoun', pronouns))

  /* ---- 量化 ---- */
  if (!hasDigit) {
    push(makeFinding('quantify.missing'))
  } else {
    const markers = findSpans(raw, RESULT_MARKERS)
    if (!markers.length) push(makeFinding('quantify.no-baseline'))
  }

  const vague = findSpans(raw, VAGUE_SCALES)
  // 「提升显著」配了数字也还是空话；但「明显下降 30%」里有数字，属于可接受
  if (vague.length && !hasDigit) push(makeFinding('quantify.vague-scale', vague))

  const praise = findSpans(raw, SELF_PRAISE)
  if (praise.length) push(makeFinding('quantify.self-praise', praise))

  /* ---- 一致性：同段重复 ---- */
  const siblings = Array.isArray(ctx.siblings) ? ctx.siblings : []
  /*
   * 这里**故意不再做「这不是我自己吗」的判断**。
   *
   * 踩过的坑：先写了 `norm(other) !== norm(raw)` 来排除自身，结果两条逐字相同的
   * 要点反而永远不报重复 —— 而它们正是最该报的情况。根源在于 norm 会全角转半角，
   * 两次规范化后的结果相等并不等于「同一个对象」。
   *
   * 正解是把「排除自身」放到调用方：analyzeEntry 按**索引**过滤，
   * 而不是按文本内容过滤（按内容过滤在两条文本相同时会误删）。
   */
  const duplicated = siblings.some((other) => similarity(other, raw) >= DUPLICATE_THRESHOLD)
  if (duplicated) push(makeFinding('structure.duplicate'))

  /*
   * 排序与截断：严重度优先，同级按「第一次命中的位置」往后排 ——
   * 让用户先看到的总是句子开头的问题，改起来最顺。
   * ALWAYS_KEPT 里的规则不参与截断（理由见该常量的注释）。
   */
  const firstSpan = (f: Finding) => f.spans[0]?.start ?? Number.MAX_SAFE_INTEGER
  const sorted = findings.sort(
    (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || firstSpan(a) - firstSpan(b),
  )
  const kept = sorted.filter((f) => ALWAYS_KEPT.has(f.ruleId))
  const rest = sorted.filter((f) => !ALWAYS_KEPT.has(f.ruleId))
  return [...kept, ...rest].slice(0, Math.max(MAX_FINDINGS_PER_BULLET, kept.length))
}

/** 检查一段经历的全部要点，返回按要点文本分组的发现 */
export function analyzeEntry(
  texts: string[],
  ctx: Omit<CheckContext, 'siblings'> = {},
): Finding[][] {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? ''))
  return list.map((text, index) =>
    analyzeBullet(text, {
      ...ctx,
      siblings: list.filter((_, i) => i !== index),
    }),
  )
}


/*
 * ---------------- 时间区间 ----------------
 *
 * 实现搬到了 utils/entryTime.ts，这里只做重导出。
 * 搬走的原因：界面上的时间选择器也要用同一套解析与格式化。
 * 两处各留一份的话，迟早出现「检查说没重叠、界面显示的是另一个区间」——
 * 而那种矛盾一旦被用户发现，整个检查功能就不可信了。
 */
export {
  EMPTY_PICKER_VALUE,
  MONTH_OPTIONS,
  formatTimeRange,
  formatYearMonth,
  fromPickerValue,
  monthIndex,
  parseTimeRange,
  rangesOverlap,
  readTimeInput,
  toPickerValue,
  yearOptions,
} from '@/utils/entryTime'
export type {
  MonthPoint,
  TimeInput,
  TimePickerValue,
  TimeRange,
} from '@/utils/entryTime'
