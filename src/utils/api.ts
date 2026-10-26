/**
 * 统一的 `/api` 调用层。
 *
 * 为什么需要它：这个项目原先有 **20 处手写 `fetch`**，散在 10 个 util / 页面 / 组件里，
 * 每处都自己决定「怎么读错误信息、401 怎么办、非 JSON 响应怎么兜底」。
 * 结果同一个语义有四五种实现，而且**新增一个端点就要再选一次错误语义**：
 *
 *   - `cloudResume.js`  401 → 抛带 code 的 Error，其余抛普通 Error
 *   - `shareApi.ts`     401 → AUTH_EXPIRED，404 → NOT_FOUND，其余看 `ok` 字段
 *   - `aiClient.js`     401 → AUTH_EXPIRED，其余拼一句中文
 *   - `useAuth.ts`      失败返回 null（连错误都不抛）
 *   - `useStyleConfig`  失败静默回退内置配置
 *   - `ShareDialog`     失败静默返回空数组
 *
 * 这些差异本身有的是**刻意的**（配置读不到就该回退，不能白屏），所以本文件
 * 不强行统一「失败后怎么办」，只统一**最底下那三层**：
 *
 *   1. 请求怎么发（相对路径、JSON、keepalive）；
 *   2. 响应怎么读（非 JSON 兜底、`ok` 字段校验、服务端 message 提取）；
 *   3. 错误怎么表达（一个 `ApiError`，带 `code` / `status` / 可读 `message`）。
 *
 * 上层要回退就 catch 后回退，要弹窗就按 `code` 分流 —— 判据从此只有一份。
 */

/** 错误码：调用方按它分流，不要靠匹配中文文案（文案会改，码不会） */
export const API_ERROR = {
  /** 会话过期 / 未登录。调用方通常降级为本地编辑或拉起登录 */
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  /** 目标不存在（分享链接失效、已删除） */
  NOT_FOUND: 'NOT_FOUND',
  /** 服务端拒绝，但属于可预期限制（额度、来源、参数） */
  REJECTED: 'REJECTED',
  /** 网络层失败：服务没起、断网、超时 */
  NETWORK: 'NETWORK',
  /** 其它 */
  REQUEST_FAILED: 'REQUEST_FAILED',
} as const

export type ApiErrorCode = (typeof API_ERROR)[keyof typeof API_ERROR]

/**
 * 一次失败的 API 调用。
 *
 * `message` 是**可以直接给用户看**的中文（优先取服务端下发的 message），
 * 所以调用方大多可以直接 `toast(error.message)`；要分流的看 `code`。
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  /** HTTP 状态码；网络层失败时为 0 */
  readonly status: number

  constructor(message: string, code: ApiErrorCode, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** 端点清单：路径只在这里出现一次，避免同一个字符串散落多处后拼错 */
export const API = {
  health: '/api/health',
  captcha: '/api/captcha',
  captchaVerify: '/api/captcha/verify',
  authMe: '/api/auth/me',
  authLogin: '/api/auth/login',
  authRegister: '/api/auth/register',
  authLogout: '/api/auth/logout',
  resume: '/api/resume',
  pdf: '/api/pdf',
  aiChat: '/api/ai/chat',
  /** Magpie 本机直连（免 Key）：目标地址由服务端固定，前端只传 model 与 messages */
  aiMagpie: '/api/ai/magpie',
  /** Magpie 网关探测 / 一键联调 / 下载安装 */
  magpieStatus: '/api/magpie/status',
  magpieProbe: '/api/magpie/probe',
  magpieInstall: '/api/magpie/install',
  imageProxy: '/api/image-proxy',
  styles: '/api/styles',
  stylesAdmin: '/api/styles-admin',
  collection: '/api/collection',
  share: '/api/share',
  shareMine: '/api/share/mine',
  /** 单个分享；调用方负责 encodeURIComponent */
  shareById: (id: string): string => `/api/share/${encodeURIComponent(id)}`,
} as const

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** 会自动 JSON.stringify 并带上 Content-Type */
  body?: unknown
  /** 附加请求头（如 Authorization: Bearer） */
  headers?: Record<string, string>
  /** 关页前的抢救请求：浏览器在页面卸载后仍尽量送达 */
  keepalive?: boolean
}

/** 把状态码 + 服务端 message 翻译成错误码。文案匹配只作为最后手段。 */
function classify(status: number, message: string): ApiErrorCode {
  if (status === 401) return API_ERROR.AUTH_EXPIRED
  if (status === 404) return API_ERROR.NOT_FOUND
  // 429 是额度/限频，400 是参数，403 是来源或权限：都属于「可预期拒绝」
  if (status === 400 || status === 403 || status === 429) return API_ERROR.REJECTED
  // 服务端没给状态码可用时的兜底：口令类错误靠文案区分（见 serverPdf 的历史原因）
  if (/口令|来源/.test(message)) return API_ERROR.REJECTED
  return API_ERROR.REQUEST_FAILED
}

/**
 * 读响应体并解析 JSON。
 *
 * 非 JSON（HTML 错误页、空 body、网关返回的纯文本）不抛错，返回 `{}` ——
 * 调用方拿到的 `message` 会是空串，由下面补一个带状态码的兜底文案。
 * 这样「服务端 500 且返回 HTML」不会表现成一个看不懂的 JSON 解析异常。
 */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * 发一次 API 请求并返回解析后的 JSON。
 *
 * 失败一律抛 `ApiError`：HTTP 非 2xx、或响应体里 `ok === false`。
 * （本项目的服务端约定成功回 `{ ok: true, ... }`，失败回 `{ ok: false, message }`，
 * 但有些端点在 200 里也会带 `ok: false`，所以两者都要查。）
 *
 * @param path 以 `/api` 开头的路径，建议用 `API.*`
 * @param options 请求配置
 */
export async function request<T = Record<string, unknown>>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers, keepalive } = options

  const init: RequestInit = { method, keepalive }
  if (headers) init.headers = headers
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...headers }
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(path, init)
  } catch (cause) {
    // fetch 只在网络层失败时 reject（服务没起、断网、CORS）。
    // 保留原始错误到 cause，便于在控制台看出是哪种。
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new ApiError(`无法连接服务：${detail}`, API_ERROR.NETWORK, 0)
  }

  const data = await readJson(response)
  const message = typeof data.message === 'string' ? data.message : ''

  if (!response.ok) {
    const fallback = `请求失败（${response.status}）`
    throw new ApiError(message || fallback, classify(response.status, message), response.status)
  }

  if (data.ok === false) {
    /*
     * 2xx 却带 `ok:false`：服务端明确拒绝了这次请求，只是选了 200 作为载体。
     * 不能走 `classify(response.status)` —— 200 会落到 REQUEST_FAILED，
     * 把「参数不合法」这类可预期拒绝说成未知错误，调用方就没法按 code 分流了。
     */
    throw new ApiError(message || '请求被服务端拒绝', API_ERROR.REJECTED, response.status)
  }

  return data as T
}

/** 取二进制响应（PDF 下载）。失败同样抛 `ApiError`。 */
export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { method = 'GET', body, headers, keepalive } = options

  const init: RequestInit = { method, keepalive }
  if (headers) init.headers = headers
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...headers }
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(path, init)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new ApiError(`无法连接服务：${detail}`, API_ERROR.NETWORK, 0)
  }

  if (!response.ok) {
    // 失败时服务端回的是 JSON，不是 PDF
    const data = await readJson(response)
    const message = typeof data.message === 'string' ? data.message : ''
    throw new ApiError(
      message || `请求失败（${response.status}）`,
      classify(response.status, message),
      response.status,
    )
  }

  return response.blob()
}

/** 判断任意 catch 到的值是不是「登录过期」。用于各处的降级分流。 */
export function isAuthExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === API_ERROR.AUTH_EXPIRED
}

/** 把任意 catch 到的值转成可以直接展示的中文。 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}
