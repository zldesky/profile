/**
 * 写作检查的规则条文。
 *
 * 这个文件**只有数据，没有判断逻辑**（逻辑在 utils/expression.ts）。
 * 分开的理由：规则的「判什么」和「怎么判」无关，而判法要按经历类型、岗位变化，
 * 条文却应该一眼能读完、能被人改。文案散进代码后，改一句话要翻五个 switch。
 *
 * ---------------- 三条设计边界（改这个文件前先读） ----------------
 *
 * 1. **只诊断，不改写。** 检查结果永远不自动落库；带 replace 的规则也只是给用户
 *    一个「点一下才生效」的候选。简历上的每一句话都必须是人自己认过的。
 *
 * 2. **判不准就降级。** 「精通」是否属实不可能从文本判断，所以它是 tip 不是 error。
 *    error 只留给「招聘方会直接扣印象分」的硬伤：缺联系方式、空模块。
 *
 * 3. **每条都要能回答三个问题**：为什么提示我（title/detail）、怎么改（replace 或
 *    引导到位置）、改完会好在哪里（detail 里的那半句）。
 *
 * ---------------- 为什么这些规则值得存在 ----------------
 *
 * 简历的「AI 味」几乎都可以归到下面几类可机械识别的东西上：
 * 弱动词（负责/参与）、无人称主语、形容词堆砌（大幅/显著）、无量化结果、
 * 同义反复、模板黑话（赋能/闭环）。它们没有任何一条需要语言模型才能发现 ——
 * 规则比模型更可解释、更快、也不编造事实。
 */

/** 检查级别：与 utils/completeness 的级别共用一套语义 */
export type CheckLevel = 'error' | 'warn' | 'tip'

/** 一条替换建议：把 from 换成 to（to 为空表示「删掉」） */
export interface RuleReplacement {
  from: string
  to: string
  /** 给用户看的说明，比如「换成动词开头」；缺省用规则本身的 detail */
  note?: string
}

export interface WritingRule {
  /** 稳定标识：测试、忽略列表、埋点都用它。改了等于换了一条规则 */
  id: string
  /** 一句话说清「这条要点哪里不对」 */
  title: string
  /** 为什么这么判 + 改完有什么好处。必须两句都有，否则用户只会觉得被挑刺 */
  detail: string
  example?: string
  level: CheckLevel
  /** 是否提供一键替换。缺省表示只能手动改 */
  replacements?: RuleReplacement[]
  /** 同类规则共享一个分组，弹窗里按组折叠 */
  group: 'verb' | 'quantify' | 'structure' | 'consistency' | 'lexicon'
  /** 让用户可以「这条不用管」，记 7 天（见 expression.ts 的忽略机制） */
  dismissible: boolean
}

/**
 * 弱动词 → 更强的写法。
 *
 * 注意「负责」的替换不是唯一的：有时事实就是「负责某模块」。所以这里给三个候选，
 * 由用户挑，而不是替他决定 —— 改成「主导」而事实只是「配合」，那是替他撒谎。
 */
export const WEAK_VERBS: RuleReplacement[] = [
  { from: '负责', to: '主导', note: '如果是你定方向、担结果' },
  { from: '负责', to: '独立完成', note: '如果全程一个人做' },
  { from: '负责', to: '牵头推进', note: '如果是推动多方' },
  { from: '参与', to: '承担', note: '写出你具体的那一块' },
  { from: '配合', to: '协同完成', note: '写清你交付了什么' },
  { from: '协助', to: '支持', note: '写清你独立负责的部分' },
  { from: '跟进', to: '推进', note: '补上推进后的结果' },
]

/** 含糊的程度词：单独出现时说服力为零，配了数字才有意义 */
export const VAGUE_SCALES = [
  '大幅',
  '显著',
  '明显',
  '一定程度',
  '较为',
  '比较',
  '有所',
  '极大',
  '巨大',
]

/** 无法验证的自夸词：招聘方看到这些只会当作没写 */
export const SELF_PRAISE = [
  '非常优秀',
  '出色',
  '优异',
  '卓越',
  '极强',
  '良好',
  '扎实',
  '深刻理解',
  '精通',
]

/** 模板黑话：这些词在 2020 年前后的互联网公司里被用滥了，面试官看到只会皱眉 */
export const BUZZWORDS = [
  '赋能',
  '闭环',
  '抓手',
  '颗粒度',
  '深度赋能',
  '助力',
  '打造',
  '赋予新的活力',
  '生态化',
]

/** 第一人称：简历默认主语是「我」，写出来反而啰嗦 */
export const FIRST_PERSON = ['我们', '本人', '咱们', '我的']

/** 结果性动词：有数字但没有这些词，说明只写了「做了什么」，没写「做成了什么」 */
export const RESULT_MARKERS = [
  '提升',
  '提高',
  '提升至',
  '下降',
  '降低',
  '缩短',
  '减少',
  '增长',
  '增加',
  '节省',
  '节约',
  '达到',
  '做到',
  '覆盖',
  '支撑',
  '承载',
  '从',
  '到',
  '倍',
]

/* ---------------- 规则条文 ---------------- */

export const WRITING_RULES: Record<string, WritingRule> = {
  'verb.weak': {
    id: 'verb.weak',
    title: '开头用了弱动词',
    detail:
      '「负责 / 参与 / 配合」只说明你在这件事里出现过，没说明你做了什么、做到什么程度。换成具体动作能让人一眼看出你的位置。',
    example: '负责后台管理开发 → 独立完成后台 6 个模块，上线后日活 2 万',
    level: 'warn',
    group: 'verb',
    dismissible: true,
    replacements: WEAK_VERBS,
  },

  'verb.pronoun': {
    id: 'verb.pronoun',
    title: '写了第一人称',
    detail:
      '简历的每一句默认主语都是「你」，写「我 / 我们 / 本人」既占字数又显得口语。去掉即可，不损失任何信息。',
    level: 'warn',
    group: 'verb',
    dismissible: true,
    replacements: [
      { from: '们', to: '' },
      { from: '本人', to: '' },
      { from: '咱们', to: '' },
      { from: '我的', to: '' },
    ],
  },

  'verb.negation': {
    id: 'verb.negation',
    title: '出现了「了 / 的」堆叠',
    detail: '「完成了…的优化」这类结构读起来拖沓。删掉虚词，句子更短，重点更靠前。',
    level: 'tip',
    group: 'verb',
    dismissible: true,
  },

  'quantify.missing': {
    id: 'quantify.missing',
    title: '这条没有数字',
    detail:
      '没有数字的成果无法被评估，招聘方只能当作「做过」。补上规模（多少人/多少条）、幅度（差多少）或时间（多久），可信度会完全不同。',
    example: '优化了构建流程 → 构建耗时从 8 分钟降到 90 秒',
    level: 'tip',
    group: 'quantify',
    dismissible: true,
  },

  'quantify.no-baseline': {
    id: 'quantify.no-baseline',
    title: '只有数字，没有对比',
    detail:
      '「服务 3000 个用户」是描述，「服务 3000 个用户，次月留存 42%」才是成果。把数字连到一个变化上，或者给一个行业/团队参照。',
    level: 'tip',
    group: 'quantify',
    dismissible: true,
  },

  'quantify.vague-scale': {
    id: 'quantify.vague-scale',
    title: '用了含糊的程度词',
    detail:
      '「大幅 / 显著 / 明显」在招聘方眼里等于没说 —— 每个人都会这么写。给出具体幅度，或者干脆删掉这个词。',
    level: 'warn',
    group: 'quantify',
    dismissible: true,
  },

  'quantify.self-praise': {
    id: 'quantify.self-praise',
    title: '出现了自我评价式的形容词',
    detail:
      '「精通 / 出色 / 扎实」无法被验证，也不会加分。换成一件证明它的事：做过的模块、带过的量、解决的疑难。',
    level: 'tip',
    group: 'quantify',
    dismissible: true,
  },

  'lexicon.buzzword': {
    id: 'lexicon.buzzword',
    title: '用了模板黑话',
    detail:
      '「赋能 / 闭环 / 抓手」这类词在简历里已经不传递信息，反而让人觉得在凑字数。用你实际做的事替换它。',
    level: 'warn',
    group: 'lexicon',
    dismissible: true,
  },

  'structure.too-long': {
    id: 'structure.too-long',
    title: '这条太长了',
    detail:
      '超过 80 字的一条要点，HR 平均只会扫到前 20 字。拆成两条，或删掉修饰性的从句，把结果放到句首。',
    level: 'tip',
    group: 'structure',
    dismissible: true,
  },

  'structure.too-short': {
    id: 'structure.too-short',
    title: '这条几乎没信息',
    detail: '少于 8 个字、又没有任何数字，基本等同于没写。补上做了什么、做成了什么。',
    level: 'tip',
    group: 'structure',
    dismissible: true,
  },

  'structure.duplicate': {
    id: 'structure.duplicate',
    title: '和另一条要点几乎一样',
    detail:
      '同一段经历里出现两条意思相同的要点，会让人怀疑你在凑条数。删掉一条，或者把差异点（对象、指标）写清楚。',
    level: 'warn',
    group: 'consistency',
    dismissible: false,
  },

  'consistency.time-overlap': {
    id: 'consistency.time-overlap',
    title: '时间与另一段经历重叠',
    detail:
      '同一模块里两段经历的时间区间有交叉，除非是「在职期间读研」这种真实情况，否则会被追问。确认后可以忽略这条提示。',
    level: 'warn',
    group: 'consistency',
    dismissible: true,
  },

  'consistency.intent-mismatch': {
    id: 'consistency.intent-mismatch',
    title: '求职意向与顶部职位不一致',
    detail:
      '顶部的「求职职位」和求职意向里的「求职岗位」写的是两个岗位，招聘方会不确定你到底投哪个。建议统一。',
    level: 'warn',
    group: 'consistency',
    dismissible: true,
  },
}

/** 按 id 取规则条文；未知 id 返回 undefined（调用方应原样忽略，不要抛错） */
export function ruleById(id: string): WritingRule | undefined {
  return WRITING_RULES[id]
}

/**
 * 每条要点的长度阈值（中文字符数）。
 * 与 structure.too-long 共用，界面上的字数提示也读这里 —— 同一个数字只定义一次，
 * 否则「检查说超了、界面说没超」这种自相矛盾迟早出现。
 */
export const BULLET_LENGTH = { min: 8, max: 80 }

/** 一段经历建议保留的要点条数上限 */
export const BULLETS_PER_ENTRY = 5
