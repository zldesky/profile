/**
 * 轻量内容校验：只对「格式几乎必然写错」的输入给出软提示（琥珀色警告），
 * 不阻止输入 —— 简历内容是自由文本，硬校验误伤的成本远大于收益。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** 7-20 位内的电话字符组合，按去出分隔符后至少 7 位数字判断 */
const PHONE_RE = /^[\d\s+\-()（）]+$/

const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i

/** 字段语义标签：按字段名关键词识别该按什么格式检查 */
const SEMANTIC_RULES = [
  { keywords: ['邮箱', '邮件', 'mail'], check: checkEmail },
  { keywords: ['电话', '手机', '号码', '传真', 'tel', 'phone'], check: checkPhone },
  {
    keywords: ['链接', '网址', '主页', '站点', '仓库', '作品集', '博客', 'github', 'gitee', 'blog'],
    check: checkUrl,
  },
]

/**
 * 判断一个联系方式字段的内容是否可疑。
 * @param {string} label 字段名（如「联系电话」）
 * @param {string} value 字段内容
 * @returns {string} '' 表示没问题，否则返回给用户看的提示文案
 */
export function contactFieldIssue(label, value) {
  const text = String(value || '').trim()
  if (!text) return ''

  const name = String(label || '').toLowerCase()
  const rule = SEMANTIC_RULES.find((r) => r.keywords.some((k) => name.includes(k)))
  return rule ? rule.check(text) : ''
}

function checkEmail(value) {
  return EMAIL_RE.test(value) ? '' : '邮箱格式好像不太对，检查一下 @ 和域名'
}

function checkPhone(value) {
  const digits = value.replace(/\D/g, '')
  if (!PHONE_RE.test(value) || digits.length < 7 || digits.length > 20) {
    return '电话号码好像不太对，一般 7-20 位数字'
  }
  return ''
}

function checkUrl(value) {
  return URL_RE.test(value) && !/\s/.test(value) ? '' : '链接好像不太对，建议带域名，如 example.com'
}
