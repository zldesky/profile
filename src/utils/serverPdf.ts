/**
 * 调用本地 PDF 渲染服务（server/index.ts）。
 * 开发环境通过 Vite 代理访问 /api，生产环境由该服务自身托管静态站点，均为同源请求。
 *
 * 服务若设置了访问口令（PDF_ACCESS_PASSWORD），请求需带 Authorization: Bearer。
 * 口令由用户在前端输入、只存在于内存与会话存储中——这个服务同时在托管前端，
 * 任何写死在源码里的口令都会被打包成公开 JS，因此绝不能图省事硬编码。
 */
import { API, API_ERROR, ApiError, request, requestBlob } from '@/utils/api'
import type { ApiErrorCode } from '@/utils/api'

/**
 * 口令类错误码。`/api/pdf` 与 `/api/health` 的 401/429 语义与其它端点不同：
 * 401 要区分「没带口令」与「口令错误」，429 要区分「口令被锁」与「额度用尽」，
 * 因为四种情况的处理方式完全不同（弹口令框 / 报错 / 提示锁定 / 回退打印导出）。
 *
 * 判据是服务端的文案关键词 —— 这不是偷懒：服务端在这两个端点上没有下发布尔标记，
 * 而新增标记要改协议。集中在 classifyPdfError 一处，至少不会四处各判一套。
 */
export const PDF_ERROR = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_LOCKED: 'AUTH_LOCKED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
} as const

export type PdfErrorCode = (typeof PDF_ERROR)[keyof typeof PDF_ERROR]

/** 把 ApiError 细分成 PDF 导出特有的四种成因 */
function classifyPdfError(error: ApiError): string {
  if (error.status === 401) {
    return /不正确/.test(error.message) ? PDF_ERROR.AUTH_FAILED : PDF_ERROR.AUTH_REQUIRED
  }
  if (error.status === 429) {
    return /口令/.test(error.message) ? PDF_ERROR.AUTH_LOCKED : PDF_ERROR.QUOTA_EXHAUSTED
  }
  return error.code
}

function authHeaders(password: string): Record<string, string> {
  return password ? { Authorization: `Bearer ${password}` } : {}
}

/**
 * 把简历数据提交给渲染服务，取回 PDF 二进制。
 * @param resume 简历数据
 * @param filename 文件名（不含扩展名）
 * @param password 访问口令，服务未设口令时传空串
 */
export async function requestServerPdf(
  resume: unknown,
  filename: string,
  password = '',
): Promise<Blob> {
  try {
    return await requestBlob(API.pdf, {
      method: 'POST',
      headers: authHeaders(password),
      body: { resume, filename },
    })
  } catch (cause) {
    // 统一转成带 PDF 细分码的 ApiError，调用方仍按 error.code 分流
    if (cause instanceof ApiError) {
      throw new ApiError(cause.message, classifyPdfError(cause) as ApiErrorCode, cause.status)
    }
    throw cause
  }
}

export interface ServerHealth {
  authRequired: boolean
  /** 只在服务端确认口令有效时才返回，未通过时为 null */
  quota: { day: string; limit: number; used: number; remaining: number } | null
  authPopup: boolean
}

/**
 * 查询渲染服务状态。
 *
 * authRequired 用来判断是否需要向用户索取口令；
 * quota 只在服务端确认口令有效时才返回，未通过时为 null——此时不应展示额度，
 * 否则等于把「今天还剩多少次」这类服务端信息泄露给未验证的调用方。
 * authPopup 是登录/注册弹窗交互开关（AUTH_POPUP 配置），异常时按开启处理。
 *
 * @returns 服务未启动时返回 null
 */
export async function fetchServerHealth(password = ''): Promise<ServerHealth | null> {
  try {
    const data = await request<{
      authRequired?: boolean
      quota?: ServerHealth['quota']
      authPopup?: boolean
    }>(API.health, { headers: authHeaders(password) })

    return {
      authRequired: data.authRequired === true,
      quota: data.quota ?? null,
      authPopup: data.authPopup !== false,
    }
  } catch {
    // 服务未启动 / 网络不可达时返回 null：调用方据此隐藏额度，不是错误
    return null
  }
}

/**
 * 判断一个错误是不是额度用尽（可提示用户改用打印导出）。
 *
 * 比较写成 `String(code)` 是必要的：`ApiError.code` 的静态类型是
 * `ApiErrorCode`，而这里挂上去的是 PDF 专用的细分码（运行时确实是
 * QUOTA_EXHAUSTED，但类型上不在那个联合里），直接比较会被 TS 判为
 * 「两个类型没有重叠」而报错。用 String 收口，意图仍是值比较。
 */
export function isQuotaExhausted(error: unknown): boolean {
  return error instanceof ApiError && String(error.code) === PDF_ERROR.QUOTA_EXHAUSTED
}

export { API_ERROR }
