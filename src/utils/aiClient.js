/**
 * AI 调用客户端（OpenAI 兼容 chat/completions）。
 * 请求发往本机服务 /api/ai/chat 转发：Key 每次随请求携带，
 * 服务端即用即弃（见 server/index.js），前端不做任何直连。
 */

function unauthorized() {
  const error = new Error('请先登录后使用 AI 功能')
  error.code = 'AUTH_EXPIRED'
  return error
}

/**
 * 发起一次对话补全。
 * @param {object} options
 * @param {{ baseUrl: string, model: string, apiKey: string }} options.settings AI 配置
 * @param {{ role: 'system'|'user'|'assistant', content: string }[]} options.messages
 * @param {number} [options.temperature]
 * @returns {Promise<string>} 模型返回的文本
 */
export async function aiChat({ settings, messages, temperature = 0.7 }) {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages,
      temperature,
    }),
  })

  if (response.status === 401) throw unauthorized()
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `AI 调用失败（${response.status}）`)
  }
  return data.content
}

/**
 * 构造润色请求。
 * 原则是「只改写、不编造」：保留原文的事实与数字，不新增履历内容。
 * @param {'bullet'|'summary'} kind 要点 / 段落
 * @param {string} text 原文
 * @param {string} [jobTitle] 求职职位，用于对齐语气
 */
export function buildPolishMessages(kind, text, jobTitle = '') {
  const system =
    kind === 'bullet'
      ? '你是资深中文简历顾问。把用户给出的一条简历要点改写得更专业：动词开头、保留原有的事实与数字（绝不编造新经历或数据）、突出结果与价值、不超过 60 个字、只输出改写后的这一条要点本身，不要序号、引号或任何 markdown 符号。'
      : '你是资深中文简历顾问。改写用户给出的简历自我评价段落：保留原有事实（绝不编造）、语言凝练有力、突出核心优势与量化结果、控制在 150 字以内、输出纯文本，不要 markdown 符号或引号。'

  const job = jobTitle ? `目标岗位：${jobTitle}\n` : ''
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${job}原文：${text}` },
  ]
}

/** 去掉模型偶尔带出的 markdown 包裹，简历文本里不该有这些符号 */
export function stripMarkdown(text) {
  return String(text || '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/^[「"'『]|[」"'』]$/g, '')
    .trim()
}
