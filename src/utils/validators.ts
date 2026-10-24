/**
 * 轻量内容校验：只对「格式几乎必然写错」的输入给出软提示（琥珀色警告），
 * 不阻止输入 —— 简历内容是自由文本，硬校验误伤的成本远大于收益。
 *
 * 迁到 TS 的收益在这里很具体：`contactFieldIssue` 的返回值语义是
 * 「空串表示没问题、否则是给用户看的文案」，调用方（编辑器提示、体检）
 * 全靠这个约定。用 `string` 表达不出「可能是空串」这件事，
 * 但至少能保证「永远不会返回 null/undefined」—— 而体检里就有
 * `if (issue) issues.push(...)` 这种依赖真值的写法，返回 undefined 会被静默吞掉。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** 7-20 位内的电话字符组合，按去掉分隔符后至少 7 位数字判断 */
const PHONE_RE = /^[\d\s+\-()（）]+$/

const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i

/** 单条校验函数的形状：'' 表示通过，否则是提示文案 */
type FieldChecker = (value: string) => string

interface SemanticRule {
  keywords: string[]
  check: FieldChecker
}

/** 字段语义标签：按字段名关键词识别该按什么格式检查 */
const SEMANTIC_RULES: SemanticRule[] = [
  { keywords: ['邮箱', '邮件', 'mail'], check: checkEmail },
  { keywords: ['电话', '手机', '号码', '传真', 'tel', 'phone'], check: checkPhone },
  {
    keywords: ['链接', '网址', '主页', '站点', '仓库', '作品集', '博客', 'github', 'gitee', 'blog'],
    check: checkUrl,
  },
]

/**
 * 判断一个联系方式字段的内容是否可疑。
 *
 * @param label 字段名（如「联系电话」）。接受 unknown：调用方可能从不可信的导入数据里取值
 * @param value 字段内容
 * @returns `''` 表示没问题，否则返回给用户看的提示文案
 */
export function contactFieldIssue(label: unknown, value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return ''

  const name = String(label || '').toLowerCase()
  const rule = SEMANTIC_RULES.find((r) => r.keywords.some((k) => name.includes(k)))
  return rule ? rule.check(text) : ''
}

function checkEmail(value: string): string {
  return EMAIL_RE.test(value) ? '' : '邮箱格式好像不太对，检查一下 @ 和域名'
}

function checkPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!PHONE_RE.test(value) || digits.length < 7 || digits.length > 20) {
    return '电话号码好像不太对，一般 7-20 位数字'
  }
  return ''
}

function checkUrl(value: string): string {
  return URL_RE.test(value) && !/\s/.test(value) ? '' : '链接好像不太对，建议带域名，如 example.com'
}
