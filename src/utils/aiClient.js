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

/* ---------------- JD 匹配 ---------------- */

/** 服务端限制单条消息 8000 字符：给简历摘要与 JD 各留出安全预算 */
const SUMMARY_BUDGET = 3600
const JD_BUDGET = 2600

const str = (value) => String(value ?? '').trim()

/**
 * 把简历压缩成给模型看的纯文本摘要：只留内容字段，主题 / 模板 / 布局全部剔除，
 * 超预算时截断并标注省略，保证整体消息不超服务端限额。
 * @param {object} resume 简历数据
 * @param {number} [budget] 摘要字符上限
 * @returns {string}
 */
export function summarizeResumeForAI(resume, budget = SUMMARY_BUDGET) {
  const basics = resume?.basics || {}
  const lines = []
  if (str(basics.name)) lines.push(`姓名：${str(basics.name)}`)
  if (str(basics.jobTitle)) lines.push(`求职职位：${str(basics.jobTitle)}`)
  ;(Array.isArray(basics.fields) ? basics.fields : [])
    .filter((f) => str(f?.value))
    .forEach((f) => lines.push(`${str(f.label) || '联系方式'}：${str(f.value)}`))

  ;(Array.isArray(resume?.sections) ? resume.sections : [])
    .filter((s) => s && s.visible !== false)
    .forEach((section) => {
      lines.push(`【${str(section.title) || '未命名模块'}】`)
      if (section.type === 'entries') {
        ;(Array.isArray(section.items) ? section.items : []).forEach((entry) => {
          const head = [str(entry?.org), str(entry?.role), str(entry?.time)]
            .filter(Boolean)
            .join('｜')
          if (head) lines.push(head)
          ;(Array.isArray(entry?.meta) ? entry.meta : [])
            .filter((m) => str(m?.value))
            .forEach((m) => lines.push(`${str(m.label) || '补充'}：${str(m.value)}`))
          ;(Array.isArray(entry?.bullets) ? entry.bullets : [])
            .filter((b) => str(b?.text))
            .forEach((b) => lines.push(`- ${str(b.text)}`))
        })
      } else if (section.type === 'grid') {
        ;(Array.isArray(section.items) ? section.items : [])
          .filter((item) => str(item?.value))
          .forEach((item) => lines.push(`${str(item.label) || '信息'}：${str(item.value)}`))
      } else if (section.type === 'skills') {
        ;(Array.isArray(section.fields) ? section.fields : [])
          .filter((f) => str(f?.value))
          .forEach((f) => lines.push(`${str(f.label) || '技能'}：${str(f.value)}`))
        ;(Array.isArray(section.items) ? section.items : [])
          .filter((s) => str(s?.name))
          .forEach((s) => lines.push(`- ${str(s.name)}`))
      } else if (section.type === 'text') {
        if (str(section.content)) lines.push(str(section.content))
      }
    })

  const text = lines.join('\n')
  if (text.length <= budget) return text
  return `${text.slice(0, budget)}\n（简历后文已省略）`
}

/**
 * 构造 JD 匹配请求：让模型只输出严格 JSON，前端解析后渲染。
 * 与润色同一原则——不编造，matched 必须能在简历里找到对应内容。
 */
export function buildJdMatchMessages(resumeSummary, jdText, jobTitle = '') {
  const system = [
    '你是资深招聘顾问。对比用户的简历与目标岗位 JD，只输出一个 JSON 对象（不要 markdown 代码块、不要任何多余文字），结构：',
    '{"matched":[{"kw":"简历已覆盖的关键词","evidence":"简历对应内容，20字内"}],',
    '"missing":[{"kw":"JD要求但简历缺失的关键词","why":"为什么重要，30字内"}],',
    '"suggestions":["给简历的具体修改建议，每条50字内"]}',
    '规则：关键词从 JD 提取，优先硬技能、工具与任职要求；matched 最多 8 条、missing 最多 6 条、suggestions 最多 3 条；matched 必须在简历内容里有依据，绝不编造。',
  ].join('\n')

  const job = jobTitle ? `目标岗位：${jobTitle}\n\n` : ''
  const user = `${job}【简历内容】\n${resumeSummary}\n\n【岗位 JD】\n${String(jdText || '').slice(0, JD_BUDGET)}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/**
 * 解析 JD 匹配结果：容忍模型带出 markdown 代码块或前后缀文字。
 * @param {string} text 模型返回的文本
 * @returns {{ matched: {kw, note}[], missing: {kw, note}[], suggestions: string[] }}
 * @throws {Error} 完全解析不出有效结果时抛错（带中文信息）
 */
export function parseJdMatchResult(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('AI 返回的内容里没有结果，请重试')
  }

  let parsed
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('AI 返回的 JSON 格式有误，请重试')
  }

  const toKeywordList = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((item) => item && str(item.kw))
      .map((item) => ({ kw: str(item.kw), note: str(item.evidence ?? item.why ?? '') }))
      .slice(0, 8)

  const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .filter((s) => typeof s === 'string' && str(s))
    .map((s) => str(s))
    .slice(0, 3)

  const matched = toKeywordList(parsed?.matched)
  const missing = toKeywordList(parsed?.missing)
  if (!matched.length && !missing.length && !suggestions.length) {
    throw new Error('AI 没有给出有效的匹配结果，请重试')
  }
  return { matched, missing, suggestions }
}
