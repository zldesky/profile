/**
 * 云端简历读写（/api/resume）。
 *
 * 与 serverPdf.js 同一原则：同源相对路径，开发态走 Vite 代理，
 * 生产态由渲染服务自身托管站点。Cookie 会话由浏览器自动携带。
 *
 * 401 由 utils/api 统一标记为 AUTH_EXPIRED，调用方（useCloudSync）按 code 分流：
 * 编辑继续走本地，不阻塞用户手头的事。
 */
import { API, request } from '@/utils/api'
import type { Resume } from '@/types/resume'

/** 读失败抛错；云端还没有简历（首次登录）时返回 null，二者语义不同 */
export async function fetchCloudResume(): Promise<Resume | null> {
  const data = await request<{ resume?: Resume | null }>(API.resume)
  return data.resume ?? null
}

/**
 * 覆盖式保存：云端只保留最后一份快照，最后写入者胜出。
 *
 * @param resume 已 normalize 的简历对象
 * @param options.keepalive 关页前的抢救推送：浏览器在页面卸载后仍尽量送达
 * @returns 服务端落库时间戳
 */
export async function saveCloudResume(
  resume: Resume,
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<number> {
  const data = await request<{ updatedAt?: number }>(API.resume, {
    method: 'PUT',
    body: { resume },
    keepalive,
  })
  return data.updatedAt ?? Date.now()
}
