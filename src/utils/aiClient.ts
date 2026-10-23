/**
 * AI 调用客户端（OpenAI 兼容 chat/completions）。
 * 请求发往本机服务 /api/ai/chat 转发：Key 每次随请求携带，
 * 服务端即用即弃（见 server/index.ts），前端不做任何直连。
 */
import { API, request } from '@/utils/api'

export interface AiSettings {
  baseUrl: string
  model: string
  apiKey: string
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 发起一次对话补全。
 * @param options.settings AI 配置
 * @param options.messages 对话消息
 * @returns 模型返回的文本
 */
export async function aiChat({
  settings,
  messages,
  temperature = 0.7,
}: {
  settings: AiSettings
  messages: AiMessage[]
  temperature?: number
}): Promise<string> {
  const data = await request<{ content: string }>(API.aiChat, {
    method: 'POST',
    body: {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages,
      temperature,
    },
  })
  return data.content
}

/**
 * 构造改写请求。
 *
 * 提示词里的每条禁令都对应一个真实的坏结果，不是泛泛的「要写好」：
 *  - 模板腔（赋能 / 闭环 / 抓手 / 打造）是中文简历里最刺眼的「不是人写的」信号；
 *  - 同义词替换来回说两遍，读者会以为你在凑字数；
 *  - 堆形容词不会加分量，只会让真正做过的事被埋掉。
 *
 * 最后一条最重要：**允许模型不改**。只给它「改写」这个任务时，
 * 它一定会改点什么；允许它原样返回，才不会把一句本来清楚的要点越改越空。
 *
 * @param kind 要点 / 段落
 * @param text 原文
 * @param jobTitle 求职职位，用于对齐语气
 */
export function buildPolishMessages(
  kind: 'bullet' | 'summary',
  text: string,
  jobTitle = '',
): AiMessage[] {
  const rules = [
    '禁止使用模板腔词汇：赋能、闭环、抓手、颗粒度、深度赋能、助力、打造、生态化。',
    '禁止把同一件事换两个同义词说两遍。',
    '不要为了显得厉害而堆形容词；不确定的细节宁可不写，也不要补充原文没有的事实。',
    '保留原文里的具体名词（公司名、模块名、业务名）与数字，它们是可信度的来源。',
    '如果原文已经清楚表达了结果与数字，就原样返回，不要为了「改写」而改。',
  ].join('')

  const system =
    kind === 'bullet'
      ? `你是资深中文简历顾问。把用户给出的一条简历要点改写得更清楚：动作在前、结果在后、保留原有的事实与数字（绝不编造新经历或数据）、不超过 60 个字、只输出改写后的这一条要点本身，不要序号、引号或任何 markdown 符号。${rules}`
      : `你是资深中文简历顾问。改写用户给出的简历自我评价段落：保留原有事实（绝不编造）、语言凝练、突出核心优势与可核对的结果、控制在 150 字以内、输出纯文本，不要 markdown 符号或引号。${rules}`

  const job = jobTitle ? `目标岗位：${jobTitle}\n` : ''
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${job}原文：${text}` },
  ]
}

/** 去掉模型偶尔带出的 markdown 包裹，简历文本里不该有这些符号 */
export function stripMarkdown(text: string): string {
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

const str = (value: unknown): string => String(value ?? '').trim()

/**
 * 把简历压缩成给模型看的纯文本摘要：只留内容字段，主题 / 模板 / 布局全部剔除，
 * 超预算时截断并标注省略，保证整体消息不超服务端限额。
 */
export function summarizeResumeForAI(resume: unknown, budget = SUMMARY_BUDGET): string {
  const record = (resume ?? {}) as Record<string, unknown>
  const basics = (record.basics ?? {}) as Record<string, unknown>
  const lines: string[] = []

  if (str(basics.name)) lines.push(`姓名：${str(basics.name)}`)
  if (str(basics.jobTitle)) lines.push(`求职职位：${str(basics.jobTitle)}`)
  ;(Array.isArray(basics.fields) ? basics.fields : [])
    .filter((f: Record<string, unknown>) => str(f?.value))
    .forEach((f: Record<string, unknown>) =>
      lines.push(`${str(f.label) || '联系方式'}：${str(f.value)}`),
    )

  ;(Array.isArray(record.sections) ? record.sections : [])
    .filter((s: Record<string, unknown>) => s && s.visible !== false)
    .forEach((section: Record<string, unknown>) => {
      lines.push(`【${str(section.title) || '未命名模块'}】`)
      if (section.type === 'entries') {
        ;(Array.isArray(section.items) ? section.items : []).forEach(
          (entry: Record<string, unknown>) => {
            const head = [str(entry?.org), str(entry?.role), str(entry?.time)]
              .filter(Boolean)
              .join('｜')
            if (head) lines.push(head)
            ;(Array.isArray(entry?.meta) ? entry.meta : [])
              .filter((m: Record<string, unknown>) => str(m?.value))
              .forEach((m: Record<string, unknown>) =>
                lines.push(`${str(m.label) || '补充'}：${str(m.value)}`),
              )
            ;(Array.isArray(entry?.bullets) ? entry.bullets : [])
              .filter((b: Record<string, unknown>) => str(b?.text))
              .forEach((b: Record<string, unknown>) => lines.push(`- ${str(b.text)}`))
          },
        )
      } else if (section.type === 'grid') {
        ;(Array.isArray(section.items) ? section.items : [])
          .filter((item: Record<string, unknown>) => str(item?.value))
          .forEach((item: Record<string, unknown>) =>
            lines.push(`${str(item.label) || '信息'}：${str(item.value)}`),
          )
      } else if (section.type === 'skills') {
        ;(Array.isArray(section.fields) ? section.fields : [])
          .filter((f: Record<string, unknown>) => str(f?.value))
          .forEach((f: Record<string, unknown>) =>
            lines.push(`${str(f.label) || '技能'}：${str(f.value)}`),
          )
        ;(Array.isArray(section.items) ? section.items : [])
          .filter((s: Record<string, unknown>) => str(s?.name))
          .forEach((s: Record<string, unknown>) => lines.push(`- ${str(s.name)}`))
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
export function buildJdMatchMessages(
  resumeSummary: string,
  jdText: string,
  jobTitle = '',
): AiMessage[] {
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

/** JD 匹配结果：matched/missing 的 note 统一承载 evidence 或 why */
export interface JdMatchResult {
  matched: { kw: string; note: string }[]
  missing: { kw: string; note: string }[]
  suggestions: string[]
}

/**
 * 解析 JD 匹配结果：容忍模型带出 markdown 代码块或前后缀文字。
 * @throws {Error} 完全解析不出有效结果时抛错（带中文信息）
 */
export function parseJdMatchResult(text: string): JdMatchResult {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('AI 返回的内容里没有结果，请重试')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('AI 返回的 JSON 格式有误，请重试')
  }

  const toKeywordList = (list: unknown): { kw: string; note: string }[] =>
    (Array.isArray(list) ? list : [])
      .filter((item: Record<string, unknown>) => item && str(item.kw))
      .map((item: Record<string, unknown>) => ({
        kw: str(item.kw),
        note: str(item.evidence ?? item.why ?? ''),
      }))
      .slice(0, 8)

  const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .filter((s: unknown): s is string => typeof s === 'string' && str(s) !== '')
    .map((s: string) => str(s))
    .slice(0, 3)

  const matched = toKeywordList(parsed?.matched)
  const missing = toKeywordList(parsed?.missing)
  if (!matched.length && !missing.length && !suggestions.length) {
    throw new Error('AI 没有给出有效的匹配结果，请重试')
  }
  return { matched, missing, suggestions }
}
