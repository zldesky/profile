/**
 * 整包备份（纯逻辑，可直接单测）。
 *
 * 单份简历的 JSON 导出已有（store.toJSON），但多文档槽位与历史版本快照
 * 都不在里面。整包备份把本机全部简历 + 快照打成一个文件，用于整机迁移
 * 或安心地清浏览器数据。
 *
 * 关键点：本机持久化形态里头像可能是 `idb-avatar:<hash>` 引用，
 * 引用离开这台设备的 IndexedDB 就悬空了——导出前必须内联回 dataURL，
 * 导入时再换回引用控制 localStorage 体积。
 */

import { isAvatarRef } from '@/utils/avatarStore'

export const BACKUP_KIND = 'resume-studio-backup'
export const BACKUP_VERSION = 1

/**
 * 组装整包备份数据。
 * @param {object} input
 * @param {string} input.activeId 备份时打开的文档 id
 * @param {{ id: string, name: string, pinned: boolean, updatedAt: number, data: object }[]} input.docs 全部简历（含活跃文档）
 * @param {{ id: string, name: string, updatedAt: number, data: object }[]} input.snapshots 历史版本
 */
export function buildBackup({ activeId, docs, snapshots }) {
  return {
    app: 'resume-studio',
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    activeId,
    docs,
    snapshots,
  }
}

/**
 * 解析并校验整包备份文件。
 * @param {string|object} raw 文件内容（文本或已解析的对象）
 * @returns {{ activeId: string, docs: Array, snapshots: Array }}
 * @throws {Error} 带可直接展示给用户的中文错误信息
 */
export function parseBackup(raw) {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error('备份文件不是有效的 JSON')
    }
  }
  if (!data || typeof data !== 'object' || data.kind !== BACKUP_KIND) {
    throw new Error('这不是整包备份文件；单份简历的 JSON 请直接用「导入数据」')
  }
  if (!Array.isArray(data.docs) || !data.docs.length) {
    throw new Error('备份文件里没有简历')
  }

  const seen = new Set()
  const docs = data.docs.map((doc, index) => {
    if (!doc || typeof doc.id !== 'string' || !doc.id) {
      throw new Error(`第 ${index + 1} 份简历缺少标识，文件可能已损坏`)
    }
    if (seen.has(doc.id)) {
      throw new Error('备份里存在重复的简历标识，文件可能已损坏')
    }
    seen.add(doc.id)
    if (!doc.data || typeof doc.data !== 'object' || !Array.isArray(doc.data.sections)) {
      throw new Error(`「${doc.name || doc.id}」的简历数据不完整`)
    }
    return {
      id: doc.id,
      name: typeof doc.name === 'string' && doc.name.trim() ? doc.name : '未命名简历',
      pinned: Boolean(doc.pinned),
      updatedAt: Number(doc.updatedAt) || Date.now(),
      data: doc.data,
    }
  })

  const activeId = docs.some((doc) => doc.id === data.activeId) ? data.activeId : docs[0].id

  const snapshots = (Array.isArray(data.snapshots) ? data.snapshots : [])
    .filter(
      (snap) => snap && typeof snap.id === 'string' && snap.data && typeof snap.data === 'object',
    )
    .map((snap) => ({
      id: snap.id,
      name: typeof snap.name === 'string' && snap.name.trim() ? snap.name : '历史版本',
      updatedAt: Number(snap.updatedAt) || Date.now(),
      data: snap.data,
    }))

  return { activeId, docs, snapshots }
}

/**
 * 深度遍历，把对象里所有 `idb-avatar:*` 引用替换为 resolve 取回的 dataURL。
 * 取不到（blob 已被清理）就置空字符串，绝不让悬空引用写进备份文件。
 * @param {*} value 任意可序列化数据
 * @param {(ref: string) => Promise<string|null>} resolve 引用解析器
 * @returns {Promise<*>} 结构相同、引用已内联的新对象
 */
export async function inlineAvatarRefs(value, resolve) {
  if (typeof value === 'string') {
    if (!isAvatarRef(value)) return value
    const dataUrl = await resolve(value)
    return dataUrl || ''
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => inlineAvatarRefs(item, resolve)))
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        await inlineAvatarRefs(item, resolve),
      ]),
    )
    return Object.fromEntries(entries)
  }
  return value
}
