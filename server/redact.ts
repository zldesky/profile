/**
 * 分享前的敏感信息屏蔽。
 *
 * ── 为什么必须做在服务端、而且做在**存储之前** ──────────────────────
 *
 * 分享链接是公开只读的：拿到链接的人无需登录就能查看，
 * 勾选「展示到简历合集」之后更是进了公开目录。
 * 手机号、邮箱、身份证号这类东西一旦跟着出去，**收不回来**。
 *
 * 所以屏蔽点在 `db.createShare(...)` **之前**（见 index.ts 的 /api/share）：
 * 存进库里的快照本身就已经是屏蔽后的。若只在页面上不显示、
 * 库里与接口里仍是原文，那么 `/api/share/:id` 一请求就全泄了 ——
 * 那只是"看不见"，不是"不暴露"。
 *
 * ── 屏蔽什么 ──────────────────────────────────────────────────────
 *
 * 两条并行的判据，缺一不可：
 *  1. **按字段标签**：`联系电话` 这种标签本身就说明是敏感字段，
 *     哪怕用户填的是「微信同号」这种不像手机号的文本，也要整条屏蔽；
 *  2. **按内容模式**：手机号 / 邮箱 / 身份证号可能被写进任何地方 ——
 *     要点、自我评价、项目描述里都可能贴一个联系方式。
 *     只按标签查会漏掉这些，所以还要在**所有文本**里按模式替换一遍。
 *
 * ── 屏蔽成什么 ────────────────────────────────────────────────────
 *
 * 手机号与邮箱用**部分屏蔽**（`138****0000`、`z***@example.com`）：
 * 这是中文语境里的通行写法，保留"这里本来有个联系方式"的信息，
 * 简历版面也不会突然空掉；泄露的部分有限（号段与前缀）。
 * 其余一律整条替换成 `**`。
 *
 * 屏蔽是**保留字段、替换取值**，而不是删掉字段：
 * 删掉会让版面跳动，收件人也无法判断"是没填还是被隐藏了"。
 */

/** 判断字段标签是否属于敏感信息 */
const SENSITIVE_LABEL_RE =
  /电话|手机|联系方式|联络|邮箱|邮件|e-?mail|微信|wechat|qq|身份证|证件|护照|生日|出生|年龄|性别|婚姻|婚否|政治面貌|地址|住址|现居|籍贯|邮编|社保|银行|账号|卡号/i

/** 手机号：1 开头 11 位，容忍空格与连字符分隔（138 0000 0000 / 138-0000-0000） */
const PHONE_RE = /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g

/** 邮箱 */
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

/** 身份证号：18 位（末位可能是 X） */
const ID_CARD_RE = /(?<!\d)\d{17}[\dXx](?!\d)/g

/** 标签里像电话 / 邮箱 / 身份证的，决定用哪种屏蔽形式 */
const PHONE_LABEL_RE = /电话|手机|联系方式|联络/i
const EMAIL_LABEL_RE = /邮箱|邮件|e-?mail/i

export interface RedactOutcome {
  /** 屏蔽后的简历（结构不变，仅替换取值） */
  resume: unknown
  /** 被屏蔽的字段标签，去重且保持出现顺序；供界面告诉用户屏蔽了什么 */
  maskedLabels: string[]
  /** 在正文（要点 / 段落等）里按模式屏蔽掉的处数 */
  maskedInText: number
}

/** 手机号：保留前 3 位与后 4 位 */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  // 去掉 +86 前缀后再判断长度，避免把国码算进"后 4 位"
  const local = digits.length > 11 && digits.startsWith('86') ? digits.slice(2) : digits
  return local.length >= 7 ? `${local.slice(0, 3)}****${local.slice(-4)}` : '**'
}

/** 邮箱：保留首字母与域名 —— 域名能帮人判断是不是工作邮箱，但不是身份信息 */
function maskEmail(value: string): string {
  const at = value.lastIndexOf('@')
  if (at <= 0) return '**'
  return `${value.slice(0, 1)}***${value.slice(at)}`
}

/** 对一个字段取值做标签驱动的整条屏蔽 */
function maskByLabel(label: string, value: string): string {
  const text = String(value ?? '').trim()
  if (!text) return text
  if (PHONE_LABEL_RE.test(label)) return maskPhone(text)
  if (EMAIL_LABEL_RE.test(label)) return maskEmail(text)
  return '**'
}

/**
 * 在所有文本里按内容模式替换敏感串。
 * 返回替换后的文本与替换次数。
 */
function maskPatternsInText(text: string): { text: string; count: number } {
  let count = 0
  const out = text
    .replace(PHONE_RE, (m) => {
      count += 1
      return maskPhone(m)
    })
    .replace(EMAIL_RE, (m) => {
      count += 1
      return maskEmail(m)
    })
    .replace(ID_CARD_RE, () => {
      count += 1
      return '**'
    })
  return { text: out, count }
}

/**
 * 屏蔽简历里的个人敏感信息。
 *
 * 返回的是**结构相同**的一份新数据（深拷贝语义：不修改入参），
 * 调用方可以直接存库。
 */
export function redactSensitive(resume: unknown): RedactOutcome {
  const maskedLabels: string[] = []
  let maskedInText = 0

  /** 记一次标签屏蔽（去重、保序） */
  const noteLabel = (label: string) => {
    const clean = String(label ?? '').trim() || '未命名字段'
    if (!maskedLabels.includes(clean)) maskedLabels.push(clean)
  }

  /** 文本走一遍模式屏蔽 */
  const scrub = (value: unknown): string => {
    if (typeof value !== 'string' || !value) return typeof value === 'string' ? value : ''
    const result = maskPatternsInText(value)
    maskedInText += result.count
    return result.text
  }

  /** 处理一个 { label, value } 形状的字段 */
  const scrubField = (field: Record<string, unknown>): Record<string, unknown> => {
    const label = String(field.label ?? '')
    const rawValue = field.value
    if (typeof rawValue !== 'string' || !rawValue.trim()) return { ...field }

    if (SENSITIVE_LABEL_RE.test(label)) {
      noteLabel(label)
      return { ...field, value: maskByLabel(label, rawValue) }
    }
    // 标签不含敏感词，但取值本身可能就是个手机号或邮箱
    const scrubbed = scrub(rawValue)
    return { ...field, value: scrubbed }
  }

  /** 递归：任何字符串都过一遍模式屏蔽；识别 {label,value} 形状时额外做标签判定 */
  const walk = (node: unknown, parentKey = ''): unknown => {
    if (typeof node === 'string') return scrub(node)
    if (Array.isArray(node)) return node.map((item) => walk(item, parentKey))
    if (!node || typeof node !== 'object') return node

    const record = node as Record<string, unknown>
    // 形如 { label, value } 的字段：走字段规则（标签判定 + 取值屏蔽）
    if (typeof record.label === 'string' && 'value' in record) {
      return scrubField(record)
    }

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      out[key] = walk(value, key)
    }
    return out
  }

  const redacted = walk(resume)

  return { resume: redacted, maskedLabels, maskedInText }
}

/**
 * 分享场景的统一入口。
 *
 * `revealContacts` 为 true 时**只跳过标签屏蔽**（用户明确要求带上联系方式），
 * 但仍然保留正文里的模式屏蔽吗？—— 不。
 * 这一点是刻意的：那个开关的语义是「这份分享要带上我的联系方式」，
 * 若正文里的号码仍被替掉，用户会以为开关坏了。
 * 所以显式放行时整体不屏蔽，语义才自洽。
 */
export function redactForShare(resume: unknown, { revealContacts = false } = {}): RedactOutcome {
  if (revealContacts) {
    return { resume, maskedLabels: [], maskedInText: 0 }
  }
  return redactSensitive(resume)
}
