/**
 * 多文档：登记表与各自的 localStorage 槽位。
 *
 * 存储布局（理解这一层的关键）：
 *   resume-studio-v1          主键，只放「当前正在编辑」那份的完整内容
 *   resume-studio-doc-<id>    槽位，放其余每份的完整内容
 *   resume-studio-registry-v1 登记表，只放元信息（id / 名称 / 是否固定 / 更新时间）
 *   resume-studio-active-v1   上次编辑的是哪一份，刷新后据此恢复
 *
 * 为什么活跃文档要单独放主键：老用户升上来时只有主键有数据，登记表是就地补的，
 * 这样无需迁移即可无感变成多文档。代价是「切换文档」必须做一次搬运——
 * 把当前内容 park 回自己的槽位，再把目标槽位读进主键。
 *
 * 搬运顺序是刻意的：先把当前内容 park 回槽位，再载入目标，最后才删目标槽位。
 * 中途崩溃最多留下一个重复槽位，绝不会丢文档。
 */

import { uid } from '@/utils/helpers'
import { normalizeResume } from '@/data/normalizeResume'
import { inlineAvatarRefs } from '@/utils/backup'
import { loadAvatar } from '@/utils/avatarStore'
import {
  ACTIVE_DOC_KEY,
  REGISTRY_KEY,
  STORAGE_KEY,
  collectAvatarRefs,
  compactForStorage,
  docKey,
  errorMessage,
  readJSON,
  removeKey,
  writeJSON,
} from './resumePersistence'
import type { Resume } from '@/types/resume'

export interface DocEntry {
  id: string
  name: string
  /** 手动重命名过后为 true，此时 name 不再跟随简历里的姓名 */
  pinned: boolean
  updatedAt: number
}

/** 文档显示名：默认跟随简历里的姓名，手动重命名（pinned）后固定 */
export function deriveDocName(data: Resume | null | undefined): string {
  return String(data?.basics?.name || '').trim() || '未命名简历'
}

export const newDocId = (): string => uid('doc')

/** 槽位的存储键。整包恢复时要直接写槽位，因此把键的构造方式暴露出去 */
export const docSlotKey = (id: string): string => docKey(id)

/* ---------------- 登记表 ---------------- */

/**
 * 读登记表。
 * 缺登记表（老用户）或结构损坏时返回 null，调用方据此走「首次使用」分支就地补一条。
 */
export function readRegistry(): DocEntry[] | null {
  const list = readJSON(REGISTRY_KEY)
  if (
    Array.isArray(list) &&
    list.length &&
    list.every((d) => Boolean(d) && typeof (d as DocEntry).id === 'string')
  ) {
    return list as DocEntry[]
  }
  return null
}

export function writeRegistry(list: DocEntry[]): void {
  // 登记表极小，写失败只影响列表展示，不打断编辑，因此不返回失败
  writeJSON(REGISTRY_KEY, list)
}

/** 补一条登记项（不改 name / pinned 时用 patch 传入覆盖项） */
export function makeDocEntry(id: string, patch: Partial<DocEntry> = {}): DocEntry {
  return { id, name: '未命名简历', pinned: false, updatedAt: Date.now(), ...patch }
}

/* ---------------- 活跃文档 ---------------- */

export function readActiveDocId(): string | null {
  const id = readJSON(ACTIVE_DOC_KEY)
  return typeof id === 'string' && id ? id : null
}

export function writeActiveDocId(id: string): void {
  // 写不进去只影响刷新后的定位，不影响当前编辑
  writeJSON(ACTIVE_DOC_KEY, id)
}

/* ---------------- 槽位 ---------------- */

/** 读一份槽位内容；缺失或损坏返回 null（调用方应据此避免覆盖当前文档） */
export function readDocSlot(id: string): Resume | null {
  const data = readJSON(docKey(id))
  return data ? (data as Resume) : null
}

/** 把一份简历写进槽位；失败返回可读原因 */
export function writeDocSlot(id: string, data: Resume): { ok: boolean; warning: string } {
  try {
    localStorage.setItem(docKey(id), compactForStorage(data))
    return { ok: true, warning: '' }
  } catch (error) {
    return { ok: false, warning: `简历副本保存失败：${errorMessage(error)}` }
  }
}

export function removeDocSlot(id: string): void {
  removeKey(docKey(id))
}

/* ---------------- 进出槽位 ---------------- */

/**
 * 把当前简历存回自己的槽位，并刷新登记表。
 * 未固定的文档名跟随简历姓名同步（固定过的不动）。
 */
export function parkDoc(list: DocEntry[], activeId: string, data: Resume): { warning: string } {
  const entry = list.find((d) => d.id === activeId)
  if (!entry) return { warning: '' }

  if (!entry.pinned) entry.name = deriveDocName(data)
  entry.updatedAt = Date.now()

  const outcome = writeDocSlot(entry.id, data)
  writeRegistry(list)
  return { warning: outcome.warning }
}

/** 槽位内容做一次归一化后写入（复制文档时保证新槽位是完整形态） */
export function writeNormalizedSlot(id: string, data: unknown): boolean {
  return writeJSON(docKey(id), normalizeResume(data))
}

/* ---------------- 备份与清理 ---------------- */

/** 一份简历的头像引用内联成 dataURL，使备份拷到任何设备都能完整恢复 */
export async function inlineAvatars(data: Resume): Promise<Resume> {
  return inlineAvatarRefs(data, loadAvatar)
}

/**
 * 收集所有槽位里被引用的头像，供清理判断。
 * 主键与快照由调用方（store）补进来，因为它才知道当前文档与快照列表。
 */
export function collectSlotAvatarRefs(list: DocEntry[], activeId: string): string[] {
  const refs: string[] = []
  for (const doc of list) {
    if (doc.id === activeId) continue
    const raw = localStorage.getItem(docKey(doc.id))
    if (raw) refs.push(...collectAvatarRefs(raw))
  }
  return refs
}

/** 收集主键里被引用的头像 */
export function collectActiveAvatarRefs(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? collectAvatarRefs(raw) : []
}

/** 清掉所有非活跃槽位（整包恢复前调用，避免 id 不相交时留下孤儿文档占空间） */
export function clearInactiveSlots(list: DocEntry[], activeId: string): void {
  list.forEach((doc) => {
    if (doc.id !== activeId) removeKey(docKey(doc.id))
  })
}
