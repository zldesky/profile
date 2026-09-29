/**
 * 云端简历读写（/api/resume）。
 *
 * 与 serverPdf.js 同一原则：同源相对路径，开发态走 Vite 代理，
 * 生产态由渲染服务自身托管站点。Cookie 会话由浏览器自动携带。
 *
 * 401 统一标记为 AUTH_EXPIRED，由调用方（useCloudSync）决定降级方式：
 * 编辑继续走本地，不阻塞用户手头的事。
 */

function unauthorized() {
  const error = new Error('登录已过期，请重新登录')
  error.code = 'AUTH_EXPIRED'
  return error
}

/** 读失败抛错；云端还没有简历（首次登录）时返回 null，二者语义不同 */
export async function fetchCloudResume() {
  const response = await fetch('/api/resume')

  if (response.status === 401) throw unauthorized()
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data?.message || `云端简历读取失败（${response.status}）`)
  }

  const data = await response.json()
  return data?.resume ?? null
}

/**
 * 覆盖式保存：云端只保留最后一份快照，最后写入者胜出。
 * @param {object} resume 已 normalize 的简历对象
 * @param {object} [options]
 * @param {boolean} [options.keepalive] 关页前的抢救推送：浏览器在页面卸载后仍尽量送达
 * @returns {Promise<number>} 服务端落库时间戳
 */
export async function saveCloudResume(resume, { keepalive = false } = {}) {
  const response = await fetch('/api/resume', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume }),
    keepalive,
  })

  if (response.status === 401) throw unauthorized()
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data?.message || `云端简历保存失败（${response.status}）`)
  }

  const data = await response.json()
  return data?.updatedAt ?? Date.now()
}
