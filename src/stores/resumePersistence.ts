/**
 * 本地持久化底座：localStorage 键名、紧凑序列化、配额保护与防抖自动保存。
 *
 * 这一层不认识 Vue、也不认识 store，只处理「把一份简历写进浏览器、再读回来」。
 * 多文档槽位（resumeDocuments）与历史快照（resumeHistory）都建在它上面。
 *
 * 两个容易踩的点：
 *   1. 头像 dataURL 直接塞进 localStorage 很快会撑爆 5MB 配额，所以序列化时换成
 *      IndexedDB 引用（idb-avatar:*），读取方负责回填；
 *   2. 超配额时 localStorage.setItem 抛的是同步异常，必须就地降级成可读提示，
 *      否则一次自动保存失败会顺着 watch 抛到 Vue 的调度里变成未捕获错误。
 */

import { clone, debounce, uid } from '@/utils/helpers'
import {
  flushAvatarWrites,
  isAvailable as isAvatarStoreAvailable,
  pruneAvatars,
  storeAvatar,
} from '@/utils/avatarStore'
import type { Resume } from '@/types/resume'

export const STORAGE_KEY = 'resume-studio-v1'
/** localStorage 单域名容量约 5MB，预留安全余量 */
export const STORAGE_LIMIT = 4.5 * 1024 * 1024
/** 多文档登记表：[{ id, name, pinned, updatedAt }] */
export const REGISTRY_KEY = 'resume-studio-registry-v1'
/** 上次活跃文档 id：活跃文档内容存主键，刷新后要靠它恢复「正在编辑哪份」 */
export const ACTIVE_DOC_KEY = 'resume-studio-active-v1'
export const DOC_KEY_PREFIX = 'resume-studio-doc-'
/** 历史版本快照：[{ id, name, updatedAt, data }]，跨文档的时间线备份 */
export const SNAPSHOTS_KEY = 'resume-studio-snapshots-v1'

export const docKey = (id: string): string => `${DOC_KEY_PREFIX}${id}`

/** 读取失败时的可读信息：strict 下 catch 到的 error 是 unknown，不能直接取 .message */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 自动保存的防抖间隔：编辑过程中不落盘，停顿后才写一次 */
export const SAVE_DEBOUNCE_MS = 400
/** 头像清理的防抖间隔：删除是批量的，等编辑动作结束再统一回收 */
export const PRUNE_DEBOUNCE_MS = 6000

/* ---------------- 原始读写 ---------------- */

/** 读一个键并 JSON 解析；缺失或损坏一律返回 null，不抛错 */
export function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** 写一个键；失败（多为超配额）返回 false，让调用方决定怎么提示 */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key: string): void {
  localStorage.removeItem(key)
}

/** 读主键里已保存的简历；未保存过返回 null（调用方据此区分「首次使用」） */
export function readSavedResume(): unknown {
  return readJSON(STORAGE_KEY)
}

/** 主键与快照里被引用的头像，供回收判断（槽位部分由 documents 补上） */
export function collectOwnedAvatarRefs(): string[] {
  const refs: string[] = []
  const main = localStorage.getItem(STORAGE_KEY)
  if (main) refs.push(...collectAvatarRefs(main))
  const snaps = localStorage.getItem(SNAPSHOTS_KEY)
  if (snaps) refs.push(...collectAvatarRefs(snaps))
  return refs
}

/* ---------------- 序列化 ---------------- */

/**
 * 任意一份简历数据的紧凑序列化：头像 dataURL 换成 IndexedDB 引用。
 * 主文档落盘、整包备份写槽位、历史快照三条路径共用这一条，
 * 保证「存进去的形态」在全局只有一种。
 */
export function compactForStorage(data: Resume): string {
  const copy = clone(data)
  const avatar = copy.basics?.avatar
  if (isAvatarStoreAvailable() && typeof avatar === 'string' && avatar.startsWith('data:image')) {
    copy.basics.avatar = storeAvatar(avatar)
  }
  return JSON.stringify(copy)
}

/* ---------------- 配额保护 ---------------- */

export interface SaveOutcome {
  ok: boolean
  /** 失败或超限时给用户看的话，成功时为空串 */
  warning: string
}

export const QUOTA_WARNING = '内容体积过大，可能无法自动保存，建议压缩头像图片或导出 JSON 备份'

/**
 * 把简历写进主文档键，并做配额保护。
 * 超过 STORAGE_LIMIT 时提前放弃（写进去也是半截数据），交给用户压缩后再存。
 */
export function saveResume(data: Resume): SaveOutcome {
  let serialized: string
  try {
    serialized = compactForStorage(data)
  } catch (error) {
    return { ok: false, warning: `自动保存失败：${errorMessage(error)}` }
  }

  if (serialized.length > STORAGE_LIMIT) {
    return { ok: false, warning: QUOTA_WARNING }
  }

  try {
    localStorage.setItem(STORAGE_KEY, serialized)
    return { ok: true, warning: '' }
  } catch (error) {
    return { ok: false, warning: `自动保存失败：${errorMessage(error)}` }
  }
}

/* ---------------- 头像回收 ---------------- */

const AVATAR_REF_RE = /idb-avatar:[0-9a-z]+/g

export function collectAvatarRefs(text: string): string[] {
  return text.match(AVATAR_REF_RE) || []
}

/**
 * 清掉已不被任何文档或快照引用的头像 blob（换过头像后会残留旧文件）。
 * keep 由调用方算好：它才知道哪些槽位是活的。
 */
export function pruneOrphanAvatars(keep: string[]): void {
  pruneAvatars(keep)
}

/* ---------------- 自动保存调度 ---------------- */

export interface AutosaveOptions {
  /** 取当前要保存的简历 */
  getData: () => Resume
  /** 保存结果回调：store 据此更新 savedAt / storageWarning */
  onResult: (outcome: SaveOutcome) => void
  /** 落盘成功后触发快照采样 */
  onSaved?: () => void
  /** 防抖窗口外仍要立刻落盘的时机（关页 / 切后台） */
  collectAvatarRefs?: () => string[]
  onPrune?: (refs: string[]) => void
}

export interface Autosave {
  /** 立即保存（跳过防抖） */
  saveNow: () => void
  /** 排入防抖队列 */
  scheduleSave: () => void
  /** 注册「关页 / 切后台立即落盘」，返回解绑函数 */
  bindUnloadFlush: () => () => void
  /** 排入头像回收队列 */
  schedulePrune: () => void
}

/**
 * 组装自动保存：一次保存 = 写主键 → 回调结果 → 采样快照 → 回收头像。
 * 关页与切后台走同一条 flush 路径，避免最后几个字符卡在防抖窗口里丢掉。
 */
export function createAutosave(options: AutosaveOptions): Autosave {
  const runSave = (): SaveOutcome => {
    const outcome = saveResume(options.getData())
    options.onResult(outcome)
    if (outcome.ok) options.onSaved?.()
    return outcome
  }

  const scheduleSave = debounce(runSave, SAVE_DEBOUNCE_MS)

  const flush = (): void => {
    scheduleSave.cancel()
    runSave()
    // 头像二进制落 IndexedDB 是异步的：尽力等它提交，避免「引用已存、blob 未落库」
    flushAvatarWrites()
  }

  const schedulePrune = debounce(() => {
    if (options.collectAvatarRefs && options.onPrune) options.onPrune(options.collectAvatarRefs())
  }, PRUNE_DEBOUNCE_MS)

  const bindUnloadFlush = (): (() => void) => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  return { saveNow: runSave, scheduleSave, bindUnloadFlush, schedulePrune }
}

/** 打开一份新文档时的 id 生成（与 store 的 doc id 同源，集中在这里便于统一前缀） */
export const newDocId = (): string => uid('doc')
