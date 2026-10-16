/**
 * 简历分享读写（/api/share）。
 * 与 cloudResume.js 同一原则：同源相对路径，开发态走 Vite 代理。
 * 创建与撤销要求登录（401 → AUTH_EXPIRED，由调用方分流）；
 * 查看是公开的，任何拿到链接的人都能读。
 */
import type { Resume, ShareSnapshot } from '@/types/resume'

function unauthorized(): Error & { code: string } {
  const error = new Error('请先登录后使用') as Error & { code: string }
  error.code = 'AUTH_EXPIRED'
  return error
}

/**
 * 把当前简历创建为一份公开只读分享。
 * @param options.listInCollection 同时展示到官网「简历合集」
 */
export async function createShare(
  resume: Resume,
  { listInCollection = false }: { listInCollection?: boolean } = {},
): Promise<{ id: string; expiresAt: number }> {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume, listInCollection }),
  })

  if (response.status === 401) throw unauthorized()
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `分享创建失败（${response.status}）`)
  }
  return { id: data.id, expiresAt: data.expiresAt }
}

/** 公开读取分享内容；404 表示不存在或已过期 */
export async function fetchShare(id: string): Promise<ShareSnapshot> {
  const response = await fetch(`/api/share/${encodeURIComponent(id)}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.message || `分享读取失败（${response.status}）`) as Error & {
      code: string
    }
    error.code = response.status === 404 ? 'NOT_FOUND' : 'FETCH_FAILED'
    throw error
  }
  return { resume: data.resume, createdAt: data.createdAt, expiresAt: data.expiresAt }
}

/** 撤销自己创建的分享 */
export async function deleteShare(id: string): Promise<void> {
  const response = await fetch(`/api/share/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (response.status === 401) throw unauthorized()
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `撤销失败（${response.status}）`)
  }
}

/** 我创建的分享摘要（/api/share/mine，要求登录） */
export interface MyShareItem {
  id: string
  name: string
  jobTitle: string
  /** 是否展示在官网简历合集 */
  listed: boolean
  createdAt: number
  expiresAt: number
}

/** 拉取当前用户的分享列表 */
export async function fetchMyShares(): Promise<MyShareItem[]> {
  const response = await fetch('/api/share/mine')
  if (response.status === 401) throw unauthorized()
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || `分享列表读取失败（${response.status}）`)
  }
  return data.items
}
