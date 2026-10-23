/**
 * 简历合集读取（/api/collection，公开接口）。
 * 游客由服务端截断到 guestVisible 条（其余条目连 id 都不下发），
 * 登录后同一接口返回完整分页；响应随会话 Cookie 变化，
 * 服务端已按 no-store 下发，这里不做本地缓存。
 */
import { API, request } from '@/utils/api'
import type { CollectionItem } from '@/types/resume'

export interface StyleFacet {
  key: string
  count: number
}

export interface CollectionPage {
  total: number
  items: CollectionItem[]
  categories: StyleFacet[]
  authenticated: boolean
  guestLimited: boolean
  guestVisible: number
}

/**
 * 拉取合集一页。
 * @param options.offset 起始位置（按条目数）
 * @param options.limit 本页条数上限
 * @param options.category 分类键（'all' 或缺省 = 全部）
 */
export async function fetchCollection({
  offset = 0,
  limit = 12,
  category = 'all',
}: { offset?: number; limit?: number; category?: string } = {}): Promise<CollectionPage> {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (category && category !== 'all') query.set('category', category)

  const data = await request<{
    total: number
    items: CollectionItem[]
    categories?: unknown
    authenticated: boolean
    guestLimited: boolean
    guestVisible: number
  }>(`${API.collection}?${query}`)

  return {
    total: data.total,
    items: data.items,
    categories: Array.isArray(data.categories) ? (data.categories as StyleFacet[]) : [],
    authenticated: data.authenticated,
    guestLimited: data.guestLimited,
    guestVisible: data.guestVisible,
  }
}
