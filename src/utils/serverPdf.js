/**
 * 调用本地 PDF 渲染服务（server/index.js）。
 * 开发环境通过 Vite 代理访问 /api，生产环境由该服务自身托管静态站点，均为同源请求。
 *
 * 服务若设置了访问口令（PDF_ACCESS_PASSWORD），请求需带 Authorization: Bearer。
 * 口令由用户在前端输入、只存在于内存与会话存储中——这个服务同时在托管前端，
 * 任何写死在源码里的口令都会被打包成公开 JS，因此绝不能图省事硬编码。
 */

/** 错误码，供调用方决定是弹输入框、提示锁定还是回退到打印导出 */
const AUTH_FAILED = 'AUTH_FAILED'
const AUTH_REQUIRED = 'AUTH_REQUIRED'
const AUTH_LOCKED = 'AUTH_LOCKED'
const QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED'

/**
 * 401 与 429 都要区分成因：401 是没带口令还是口令错误，
 * 429 是口令被锁还是当日额度用尽——两者的处理方式完全不同。
 */
function classify(status, message) {
  if (status === 401) return message.includes('不正确') ? AUTH_FAILED : AUTH_REQUIRED
  if (status === 429) return message.includes('口令') ? AUTH_LOCKED : QUOTA_EXHAUSTED
  return 'REQUEST_FAILED'
}

/** 取出服务端给的说明文字，非 JSON 响应则回退为状态码 */
async function readMessage(response) {
  try {
    const data = await response.json()
    if (data?.message) return data.message
  } catch {
    /* 非 JSON 响应，用默认提示 */
  }
  return `渲染服务返回 ${response.status}`
}

function authHeaders(password) {
  return password ? { Authorization: `Bearer ${password}` } : {}
}

/**
 * 把简历数据提交给渲染服务，取回 PDF 二进制。
 * @param {object} resume 简历数据
 * @param {string} filename 文件名（不含扩展名）
 * @param {string} [password] 访问口令，服务未设口令时传空串
 * @returns {Promise<Blob>}
 */
export async function requestServerPdf(resume, filename, password = '') {
  const response = await fetch('/api/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(password) },
    body: JSON.stringify({ resume, filename }),
  })

  if (!response.ok) {
    const message = await readMessage(response)
    const error = new Error(message)
    error.code = classify(response.status, message)
    throw error
  }

  return response.blob()
}

/**
 * 查询渲染服务状态。
 *
 * authRequired 用来判断是否需要向用户索取口令；
 * quota 只在服务端确认口令有效时才返回，未通过时为 null——此时不应展示额度，
 * 否则等于把「今天还剩多少次」这类服务端信息泄露给未验证的调用方。
 *
 * @param {string} [password] 访问口令
 * @returns {Promise<{ authRequired: boolean, quota: object | null } | null>} 服务未启动时返回 null
 */
export async function fetchServerHealth(password = '') {
  try {
    const response = await fetch('/api/health', { headers: authHeaders(password) })
    if (!response.ok) return null

    const data = await response.json()
    return { authRequired: data?.authRequired === true, quota: data?.quota ?? null }
  } catch {
    return null
  }
}
