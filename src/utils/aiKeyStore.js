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
const DRAFT_KEY = 'resume-studio-ai-draft-v1'

/**
 * 常见 OpenAI 兼容服务商的预设。
 *
 * baseUrl 一律写到「版本段」为止：服务端会固定拼 /chat/completions
 * （见 server/aiGuard.ts 的规范化与 index.ts 的调用），多写或少写一段都会 404。
 * 例：硅基流动是 https://api.siliconflow.cn/v1，OpenCode 是
 * https://opencode.ai/inference/v1（注意它**不是** /inference/openai/v1，
 * 那条路径上的 /models 是 404，实测确认）。
 *
 * models 是「常用模型」的候选，供下拉直接选，省去手打模型名；
 * 用户仍可切到自定义手填，因为各家的模型上新很快，写死会过期。
 */
export const AI_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-8B',
      'Qwen/Qwen2.5-7B-Instruct',
      'THUDM/glm-4-9b-chat',
    ],
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
  },
  {
    id: 'moonshot',
    label: 'Kimi 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'],
  },
  {
    id: 'dashscope',
    label: '阿里云百炼（通义千问）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
  },
  {
    id: 'ark',
    label: '火山方舟（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-lite-32k-250115',
    models: ['doubao-1-5-lite-32k-250115', 'doubao-1-5-pro-32k-250115'],
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-lite',
    models: ['hunyuan-lite', 'hunyuan-turbos-latest'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
    models: ['deepseek/deepseek-chat', 'google/gemini-2.0-flash-001'],
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/inference/v1',
    /*
     * models 刻意留空：这条预设唯一可以被核实的是 baseUrl（实测 /inference/v1 是
     * OpenAI 兼容前缀，/inference/openai/v1 返回 404）。此前这里列的
     * deepseek-v4.1-flash / glm-5.3-flash / kimi-k2.5 / gpt-5.5 都无法核实，
     * 用户照着选只会拿到 404 —— 一条选了就报错的预设比没有更糟。
     *
     * 留空的效果是「地址帮你填好，模型名请按你自己的控制台填」，
     * 界面会退化成输入框而不是下拉（tests/aiKeyStore.test.js 对此有断言）。
     */
    model: '',
    models: [],
  },
  { id: 'custom', label: '自定义（任意 OpenAI 兼容）', baseUrl: '', model: '', models: [] },
]

/** 按 id 取预设，取不到按「自定义」处理 */
export function presetById(id) {
  return AI_PRESETS.find((item) => item.id === id) || AI_PRESETS[AI_PRESETS.length - 1]
}

/**
 * 读取配置。记住的优先，其次当前会话的；都没有（或 Key 已丢失）返回 null。
 * apiKey 必须同时在：只配了地址没有 Key 的残缺配置不能算已配置，
 * 否则润色弹窗不再引导去设置，用户只会撞到一条生硬的服务端报错。
 * @returns {{ baseUrl: string, model: string, apiKey: string, remember: boolean } | null}
 */
export function loadAISettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null')
    if (saved && saved.baseUrl && saved.model && saved.apiKey) {
      return { ...saved, remember: true }
    }
  } catch {
    /* 损坏数据按未配置处理 */
  }
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (session && session.baseUrl && session.model && session.apiKey) {
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

/** 清除全部本地痕迹（换 Key / 不想再用时用），含未保存的草稿 */
export function clearAISettings() {
  try {
    localStorage.removeItem(PERSIST_KEY)
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* 忽略 */
  }
  clearAIDraft()
}

/* ---------------- 未保存的草稿 ---------------- */

/**
 * 草稿：弹窗里正在填、但还没通过「保存并测试」的内容。
 *
 * 存在的理由很实际 —— 弹窗可能被 Esc、点遮罩或外层弹窗关闭而卸载，
 * 组件一卸载 setup 里的 ref 就没了，用户填了半天的 Key 会凭空消失。
 * 存 sessionStorage 而不是 localStorage：草稿是「这次正在做的事」，
 * 关掉标签页就该结束，也不该在别人的浏览器里长期留一份半截 Key。
 *
 * 草稿与正式配置分开存（DRAFT_KEY 与 PERSIST_KEY 互不影响），
 * 因此草稿绝不会让 AI 功能误判为「已配置」。
 */
export function saveAIDraft({ presetId, baseUrl, model, apiKey, remember }) {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ presetId, baseUrl, model, apiKey, remember }),
    )
  } catch {
    /* 存储被禁用时静默：草稿只是便利，不该影响主流程 */
  }
}

/** 读取草稿；缺损（连地址都没填）时返回 null，避免每次打开都弹一个空草稿 */
export function loadAIDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
    if (draft && (draft.baseUrl || draft.model || draft.apiKey)) return draft
  } catch {
    /* 损坏数据按无草稿处理 */
  }
  return null
}

export function clearAIDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* 忽略 */
  }
}
