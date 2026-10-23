/**
 * 历史版本快照（跨文档的时间线备份）。
 *
 * 语义是「自动存档」而不是「每次编辑都留痕」，所以有两道闸门：
 *   1. 采样节流：两次采样间隔不足 SNAPSHOT_INTERVAL 就直接跳过；
 *   2. 内容去重：与上一份内容一致也跳过——频繁刷新不该用重复快照把有价值的旧版本挤出 LRU。
 * 超出 SNAPSHOT_MAX 时从最旧的丢弃；写失败（多为超配额）则砍半重试一次。
 *
 * 本模块只管快照列表本身，不认识 Vue：列表传进传出，由 store 持有响应式副本。
 */

import { uid } from '@/utils/helpers'
import { SNAPSHOTS_KEY, writeJSON } from './resumePersistence'

export interface Snapshot {
  id: string
  name: string
  updatedAt: number
  /** 紧凑序列化后的简历 JSON（头像走 IndexedDB 引用） */
  data: string
}

/** 采样间隔与保留上限：约覆盖最近一小时内的关键时点 */
export const SNAPSHOT_INTERVAL = 5 * 60 * 1000
export const SNAPSHOT_MAX = 12

/** 从 localStorage 读快照列表；缺失或损坏按空处理，丢掉结构不合法的条目 */
export function readSnapshots(): Snapshot[] {
  let list: unknown
  try {
    list = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || 'null')
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  return list.filter(
    (s): s is Snapshot =>
      Boolean(s) &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      typeof s.data === 'string',
  )
}

/** 写快照列表；失败返回 false，由采样逻辑决定是否砍半重试 */
export function writeSnapshots(list: Snapshot[]): boolean {
  return writeJSON(SNAPSHOTS_KEY, list)
}

/** 覆盖整份快照列表（整包备份恢复时用） */
export function replaceSnapshots(list: Snapshot[]): boolean {
  return writeSnapshots(list)
}

export interface SampleOptions {
  /** 当前简历的紧凑序列化结果 */
  serialize: () => string
  /** 快照显示名（跟随简历姓名，或用户手工改过的文档名） */
  getName: () => string
  /** 是否跳过节流检查（会话开始时采一份「起点」） */
  force?: boolean
  /** 采样时刻，默认 Date.now()；便于测试固定时间 */
  now?: number
}

/**
 * 采样一份快照。返回新的列表（未采样时原样返回），调用方据此同步响应式副本。
 *
 * 传 force = true 会跳过**间隔**检查，但仍做内容去重：语义是「现在必须留一个时点」，
 * 而不是「允许存两份一模一样的数据」。
 */
export function sample(
  current: Snapshot[],
  options: SampleOptions,
): { list: Snapshot[]; sampled: boolean } {
  const list = current.slice()
  const now = options.now ?? Date.now()
  const last = list[list.length - 1]

  if (!options.force && last && now - last.updatedAt < SNAPSHOT_INTERVAL) {
    return { list: current, sampled: false }
  }

  const data = options.serialize()
  if (last && last.data === data) return { list: current, sampled: false }

  list.push({ id: uid('snap'), name: options.getName(), updatedAt: now, data })
  while (list.length > SNAPSHOT_MAX) list.shift()

  if (!writeSnapshots(list)) {
    // 写入失败大概率是超容量：砍半重试一次，再失败就放弃本轮采样
    list.splice(0, Math.ceil(list.length / 2))
    if (!writeSnapshots(list)) return { list: current, sampled: false }
  }

  return { list, sampled: true }
}

/** 取一份快照的数据字符串；不存在返回 null（解析交给调用方，便于给出更准的错误） */
export function snapshotData(list: Snapshot[], id: string): string | null {
  return list.find((s) => s.id === id)?.data ?? null
}

/** 剔除结构不合法的快照（整包导入来的数据要先过这一关） */ export function sanitizeSnapshots(
  list: unknown,
): Snapshot[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      id: typeof s.id === 'string' ? s.id : uid('snap'),
      name: typeof s.name === 'string' ? s.name : '未命名快照',
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      data: typeof s.data === 'string' ? s.data : '',
    }))
    .filter((s) => s.data !== '')
}
