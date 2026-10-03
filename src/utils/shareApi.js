/**
 * 简历分享读写（/api/share）。
 * 与 cloudResume.js 同一原则：同源相对路径，开发态走 Vite 代理。
 * 创建与撤销要求登录（401 → AUTH_EXPIRED，由调用方分流）；
 * 查看是公开的，任何拿到链接的人都能读。
 */

function unauthorized() {
  const error = new Error('请先登录后使用')
  error.code = 'AUTH_EXPIRED'
  return error
}

/**
 * 把当前简历创建为一份公开只读分享。
 * @param {object} resume 已 normalize 的简历对象
 * @returns {Promise<{ id: string, expiresAt: number }>}
 */
export async function createShare(resume) {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume }),
  })

  if (response.status === 401) throw unauthorized()
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `分享创建失败（${response.status}）`)
  }
  return { id: data.id, expiresAt: data.expiresAt }
}

/** 公开读取分享内容；404 表示不存在或已过期 */
export async function fetchShare(id) {
  const response = await fetch(`/api/share/${encodeURIComponent(id)}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.message || `分享读取失败（${response.status}）`)
    error.code = response.status === 404 ? 'NOT_FOUND' : 'FETCH_FAILED'
    throw error
  }
  return { resume: data.resume, createdAt: data.createdAt, expiresAt: data.expiresAt }
}

/** 撤销自己创建的分享 */
export async function deleteShare(id) {
  const response = await fetch(`/api/share/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (response.status === 401) throw unauthorized()
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `撤销失败（${response.status}）`)
  }
}
