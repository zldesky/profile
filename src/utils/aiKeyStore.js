/**
 * AI 服务配置的本地存储。
 *
 * 安全模型（诚实版）：
 *  - Key 只存在用户自己的浏览器里，永不上传到本应用服务器存储；
 *    调用时经本机服务转发（/api/ai/chat），转发即用即弃，不写库不打日志。
 *  - 「记住密钥」存 localStorage（关浏览器后仍在）；不勾选只存 sessionStorage
 *    （关标签页即失效）。两者都能被本机恶意软件/恶意扩展读取，
 *    建议用户使用低额度的专用 Key，这是纯本地应用能做到的最诚实方案。
 *  - localStorage 里不做伪装加密：伪加密只给人虚假安全感，不如明示风险。
 */

const PERSIST_KEY = 'resume-studio-ai-v1'
const SESSION_KEY = 'resume-studio-ai-session-v1'

/** 常见 OpenAI 兼容服务商预设；选「自定义」时由用户手填 */
export const AI_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    id: 'moonshot',
    label: 'Kimi 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
]

/**
 * 读取配置。记住的优先，其次当前会话的；都没有返回 null。
 * @returns {{ baseUrl: string, model: string, apiKey: string, remember: boolean } | null}
 */
export function loadAISettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null')
    if (saved && saved.baseUrl && saved.model) {
      return { ...saved, remember: true }
    }
  } catch {
    /* 损坏数据按未配置处理 */
  }
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (session && session.baseUrl && session.model) {
      return { ...session, remember: false }
    }
  } catch {
    /* 同上 */
  }
  return null
}

/**
 * 保存配置。remember=true 落 localStorage，否则只落 sessionStorage。
 * 两条路互斥：保存时会清掉另一边的旧配置。
 */
export function saveAISettings({ baseUrl, model, apiKey, remember }) {
  const payload = JSON.stringify({ baseUrl, model, apiKey })
  try {
    if (remember) {
      localStorage.setItem(PERSIST_KEY, payload)
      sessionStorage.removeItem(SESSION_KEY)
    } else {
      sessionStorage.setItem(SESSION_KEY, payload)
      localStorage.removeItem(PERSIST_KEY)
    }
  } catch {
    /* 存储被禁用时静默：AI 功能本次会话仍可用内存态兜底 */
  }
}

/** 清除全部本地痕迹（换 Key / 不想再用时用） */
export function clearAISettings() {
  try {
    localStorage.removeItem(PERSIST_KEY)
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* 忽略 */
  }
}
