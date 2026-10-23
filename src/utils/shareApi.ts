/**
 * 简历分享读写（/api/share）。
 * 与 cloudResume.ts 同一原则：同源相对路径，开发态走 Vite 代理。
 * 创建与撤销要求登录（401 → AUTH_EXPIRED，由调用方分流）；
 * 查看是公开的，任何拿到链接的人都能读。
 */
import { API, API_ERROR, ApiError, request } from '@/utils/api'
import type { Resume, ShareSnapshot } from '@/types/resume'

/** 服务端告知的屏蔽结果：屏蔽了哪些字段、正文里替换了几处 */
export interface ShareRedaction {
  labels: string[]
  inText: number
}

/**
 * 把当前简历创建为一份公开只读分享。
 *
 * @param options.listInCollection 同时展示到官网「简历合集」
 * @param options.revealContacts 在分享里保留联系方式。
 *   **默认关闭**：服务端会屏蔽手机号 / 邮箱 / 身份证号等敏感信息
 *   （见 server/redact.ts），因为分享链接是公开只读的，勾了合集更是进公开目录。
 */
export async function createShare(
  resume: Resume,
  {
    listInCollection = false,
    revealContacts = false,
  }: {
    listInCollection?: boolean
    revealContacts?: boolean
  } = {},
): Promise<{ id: string; expiresAt: number; redacted: ShareRedaction }> {
  const data = await request<{
    id: string
    expiresAt: number
    redacted?: { labels?: unknown; inText?: unknown }
  }>(API.share, {
    method: 'POST',
    body: { resume, listInCollection, revealContacts },
  })

  return {
    id: data.id,
    expiresAt: data.expiresAt,
    redacted: {
      labels: Array.isArray(data.redacted?.labels) ? (data.redacted.labels as string[]) : [],
      inText: Number(data.redacted?.inText) || 0,
    },
  }
}

/** 公开读取分享内容；404 表示不存在或已过期（code = NOT_FOUND） */
export async function fetchShare(id: string): Promise<ShareSnapshot> {
  const data = await request<{ resume: Resume; createdAt: number; expiresAt: number }>(
    API.shareById(id),
  )
  return { resume: data.resume, createdAt: data.createdAt, expiresAt: data.expiresAt }
}

/** 撤销自己创建的分享 */
export async function deleteShare(id: string): Promise<void> {
  await request(API.shareById(id), { method: 'DELETE' })
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
  const data = await request<{ items?: MyShareItem[] }>(API.shareMine)
  return Array.isArray(data.items) ? data.items : []
}

/**
 * 把「分享链接已失效」与其它失败区分开。
 * 调用方（SharePage）据此显示「链接已过期」而不是笼统的「加载失败」。
 */
export function isShareNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === API_ERROR.NOT_FOUND
}
