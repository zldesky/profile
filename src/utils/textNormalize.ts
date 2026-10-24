/**
 * 中文文案规范化（纯函数，无 DOM、无 Vue、不做任何网络请求）。
 *
 * 它解决的是一个具体的观感问题：中文与英文/数字之间该有的空格、全角标点、
 * 连续空格。这些单看都没错，但同一份简历里五种写法混在一起，就显得不专业 ——
 * 而它们恰恰是最容易被忽略、也最容易被机械修正的一类问题。
 *
 * ---------------- 四条硬规矩（改这个文件前先读） ----------------
 *
 * 1. **只做可逆、可解释的替换。** 每一处改动都要能在预览里指出「原文 → 新文」，
 *    不做任何需要「理解语义」的改写。理解语义的部分属于写作检查与措辞改写。
 *
 * 2. **绝不碰代码与数字。** `Vue2.7`、`C++`、`100%`、`2022-06`、`v1.2.3`、
 *    文件路径、URL 一律原样保留。为此用「受保护片段」把它们整体跳过，
 *    而不是靠正则去猜 —— 猜错的代价是改坏技术简历里最要紧的信息。
 *
 * 3. **中英空格默认开，标点全角默认关。**
 *    中英空格几乎总是改进；而把 `,` 换成 `，` 在技术简历里未必更好
 *    （`React, Vue` 这类并列写半角更自然）。默认值要站在「不改坏」这一侧。
 *
 * 4. **能力可关闭。** 每个开关独立，用户可以只做中英空格而不动标点。
 */

/** 规范化选项 */
export interface NormalizeOptions {
  /** 中英文/数字之间补半角空格（默认开） */
  cjkLatinSpace?: boolean
  /** 折叠连续空格、去掉标点两侧多余空格（默认开） */
  collapseSpaces?: boolean
  /** 纯中文语境里的半角逗号/句号转全角（默认关，见文件头第 3 条） */
  fullWidthPunctuation?: boolean
}

export interface NormalizeChange {
  /** 改动前的片段（含少量上下文，便于在预览里定位） */
  before: string
  after: string
  /** 这条改动的类别，用于预览里分组显示 */
  kind: 'space' | 'punctuation' | 'collapse'
  /** 在原文中的位置，便于高亮 */
  index: number
}

export interface NormalizeResult {
  text: string
  changes: NormalizeChange[]
}

/** 中日韩字符（含扩展 A 与兼容区） */
const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
const CJK_RE = new RegExp(`[${CJK}]`)
/** 拉丁字母与数字 */
const LATIN_RE = /[A-Za-z0-9]/

/**
 * 受保护片段：整体跳过，绝不改写。
 *
 * 顺序有意义 —— URL 必须排在「路径」之前，否则 `https://a.com/b` 会先被
 * 路径规则吃掉一部分，剩下的 `https://a.com` 又匹配不上完整 URL。
 */
const PROTECTED_PATTERNS: RegExp[] = [
  // URL
  /\bhttps?:\/\/[^\s，。；：）(]+/g,
  // 邮箱
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
  // 版本号 / 带点的技术名词：Vue2.7、Node 18.17.0、v1.2.3
  /\b[A-Za-z]+\d+(?:\.\d+)+\b/g,
  // 运算符与缩写：C++、C#、F#、.NET
  /(?:\b[A-Za-z]\+{1,2}|\b[A-Za-z]#|\.NET\b)/g,
  // 日期与时间：2022-06、2022/06/15、10:30
  /\b\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  // 百分比与数值区间：100%、25K-35K、8-90
  /\b\d+(?:\.\d+)?%/g,
  /\b\d+[A-Za-z]?[-~]\d+[A-Za-z]?\b/g,
  // 文件路径与扩展名
  /\b[\w./-]+\.(?:js|ts|vue|json|md|css|html|py|java|go|rs|sql|yml|yaml|tsx|jsx)\b/gi,
]

/** 用占位符替换受保护片段，处理完再还原 */
function protect(text: string): { masked: string; restore: (value: string) => string } {
  const saved: string[] = []
  let masked = text
  for (const pattern of PROTECTED_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const token = `\uE000${saved.length}\uE000`
      saved.push(match)
      return token
    })
  }
  return {
    masked,
    restore: (value: string) =>
      /*
       * 还原时顺手收拾占位符两侧的空格问题。
       *
       * 踩过的坑：占位符是 `\uE000N\uE000` 这种私用区标记，
       * 中英空格判定看到的是「汉字 + 私用区字符」，于是 `升级到Vue2.7`
       * 被保护成 `升级到\uE0000\uE000` 后**判不出需要空格**，
       * 还原回来就成了「升级到Vue2.7」—— 一个受保护片段把空格规则一起吃掉了。
       *
       * 用私用区字符而不是 `\u0000`：后者是控制字符，
       * eslint 的 no-control-regex 会报错，而这条规则的存在本身是对的
       * （控制字符出现在简历文本里几乎总是脏数据）。
       *
       * 解法：把占位符当成「字母数字」参与判定，即还原后检查
       * 「占位符前面是汉字、且紧邻汉字」时补一个空格。
       */
      value
        .replace(/([\u4e00-\u9fff\uf900-\ufaff])\uE000(\d+)\uE000/g, (_, cjk, i) => {
          const original = saved[Number(i)] ?? ''
          // 原文本身是以字母/数字开头的技术名词才补空格（URL、邮箱前面通常已经有空格）
          return /^[A-Za-z0-9]/.test(original) ? `${cjk} ${original}` : `${cjk}${original}`
        })
        .replace(/\uE000(\d+)\uE000([\u4e00-\u9fff\uf900-\ufaff])/g, (_, i, cjk) => {
          const original = saved[Number(i)] ?? ''
          return /[A-Za-z0-9]$/.test(original) ? `${original} ${cjk}` : `${original}${cjk}`
        })
        .replace(/\uE000(\d+)\uE000/g, (_, i) => saved[Number(i)] ?? ''),
  }
}

/** 中英之间补空格：只在「汉字↔字母数字」相邻时插入 */
function addCjkLatinSpaces(text: string): { text: string; changes: NormalizeChange[] } {
  const changes: NormalizeChange[] = []
  const out: string[] = []

  for (let i = 0; i < text.length; i += 1) {
    const current = text[i]
    const next = text[i + 1]
    out.push(current)
    if (!next) continue

    const currentIsCjk = CJK_RE.test(current)
    const nextIsCjk = CJK_RE.test(next)
    const currentIsLatin = LATIN_RE.test(current)
    const nextIsLatin = LATIN_RE.test(next)

    // 汉字后紧跟字母数字，或字母数字后紧跟汉字 —— 且两者之间还没有空格
    const needsSpace = (currentIsCjk && nextIsLatin) || (currentIsLatin && nextIsCjk)
    if (!needsSpace) continue

    out.push(' ')
    changes.push({
      before: `${current}${next}`,
      after: `${current} ${next}`,
      kind: 'space',
      index: i,
    })
  }

  return { text: out.join(''), changes }
}

/** 折叠连续空格，并去掉中文标点两侧多余的空格 */
function collapseSpaces(text: string): { text: string; changes: NormalizeChange[] } {
  const changes: NormalizeChange[] = []

  // 连续空格（含全角空格）折成一个半角空格
  let next = text.replace(/[ \t\u3000]{2,}/g, (match) => {
    changes.push({ before: match, after: ' ', kind: 'collapse', index: -1 })
    return ' '
  })

  // 中文标点前不该有空格，后面可以有（英文排版习惯）
  next = next.replace(/\s+([，。；：！？、）】》])/g, (match, punct) => {
    changes.push({ before: match, after: punct, kind: 'collapse', index: -1 })
    return punct
  })
  next = next.replace(/([（【《])\s+/g, (match, punct) => {
    changes.push({ before: match, after: punct, kind: 'collapse', index: -1 })
    return punct
  })

  return { text: next, changes }
}

/**
 * 纯中文语境的半角标点转全角。
 *
 * 「纯中文语境」的判定：标点两侧都不是 ASCII 字母/数字。
 * 这样 `React, Vue` 不会被改成 `React， Vue`，而 `我做过三件事, 都很重要` 会。
 */
function fullWidthPunctuation(text: string): { text: string; changes: NormalizeChange[] } {
  const changes: NormalizeChange[] = []
  const MAP: Record<string, string> = {
    ',': '，',
    '.': '。',
    ';': '；',
    ':': '：',
    '?': '？',
    '!': '！',
  }

  const out: string[] = []
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const replacement = MAP[ch]
    if (!replacement) {
      out.push(ch)
      continue
    }
    const prev = text[i - 1] ?? ''
    const next = text[i + 1] ?? ''
    // 任一侧是英文/数字 → 视为代码或英文排版，保持半角
    const treatAsChinese = !LATIN_RE.test(prev) && !LATIN_RE.test(next)
    if (treatAsChinese) {
      out.push(replacement)
      changes.push({ before: ch, after: replacement, kind: 'punctuation', index: i })
    } else {
      out.push(ch)
    }
  }
  return { text: out.join(''), changes }
}

/**
 * 规范化一段中文文案。
 *
 * @param text 原文
 * @param options 各项能力开关（缺省：中英空格开、折叠空格开、标点全角关）
 * @returns 新文本 + 改动清单（清单为空表示无需修改，调用方据此跳过）
 */
export function normalizeZh(text: string, options: NormalizeOptions = {}): NormalizeResult {
  const raw = String(text ?? '')
  if (!raw.trim()) return { text: raw, changes: [] }

  const {
    cjkLatinSpace = true,
    collapseSpaces: doCollapse = true,
    fullWidthPunctuation: doPunct = false,
  } = options

  const { masked, restore } = protect(raw)
  let current = masked
  const changes: NormalizeChange[] = []

  if (doCollapse) {
    const step = collapseSpaces(current)
    current = step.text
    changes.push(...step.changes)
  }

  if (doPunct) {
    const step = fullWidthPunctuation(current)
    current = step.text
    changes.push(...step.changes)
  }

  if (cjkLatinSpace) {
    const step = addCjkLatinSpaces(current)
    current = step.text
    changes.push(...step.changes)
  }

  const finalText = restore(current)
  // 没有任何净变化时不返回改动（避免「打开预览却一片空白」的困惑）
  if (finalText === raw) return { text: raw, changes: [] }
  return { text: finalText, changes }
}

/**
 * 生成便于阅读的差异对（最多 limit 条）。
 *
 * 只列出真正不同的片段：预览弹窗里逐条勾选的前提是「每条都能看懂」，
 * 一次列出 40 处只会让人全部跳过。
 */
export function summarizeChanges(result: NormalizeResult, limit = 12): NormalizeChange[] {
  return result.changes.filter((c) => c.before !== c.after).slice(0, limit)
}

/**
 * 把改动计数换算成人话，用于按钮与 toast。
 * @returns 例如「3 处空格」「1 处标点」
 */
export function describeChanges(changes: NormalizeChange[]): string {
  if (!changes.length) return ''
  const counts = { space: 0, punctuation: 0, collapse: 0 }
  for (const change of changes) counts[change.kind] += 1
  const parts: string[] = []
  if (counts.space) parts.push(`${counts.space} 处中英空格`)
  if (counts.collapse) parts.push(`${counts.collapse} 处多余空格`)
  if (counts.punctuation) parts.push(`${counts.punctuation} 处标点`)
  return parts.join('、')
}
