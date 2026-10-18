import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'

import { DEFAULT_THEME, createResume } from '@/data/defaultResume'
import { normalizeResume } from '@/data/normalizeResume'
import { buildBackup, parseBackup } from '@/utils/backup'
import { AVATAR_REF_PREFIX, loadAvatar } from '@/utils/avatarStore'
import { createHistory } from '@/utils/history'
import { clamp, clone, debounce, moveItem } from '@/utils/helpers'
import { computePageStyle, computePrintCss } from '@/utils/resumeStyle'
import type { Resume, Theme } from '@/types/resume'

import {
  createAutosave,
  pruneOrphanAvatars,
  compactForStorage,
  collectOwnedAvatarRefs,
  readSavedResume,
  writeJSON,
} from './resumePersistence'
import * as history_ from './resumeHistory'
import * as docs from './resumeDocuments'
import * as tree from './resumeMutations'
import type { Snapshot } from './resumeHistory'
import type { DocEntry } from './resumeDocuments'

/** 历史提交的停顿窗口：连续敲字只在停顿后产生一条历史 */
const HISTORY_DEBOUNCE_MS = 600

/**
 * 本机数据总入口。
 *
 * 职责边界（拆解后的分工，改代码前先确认落在哪一层）：
 *   resumePersistence   localStorage 键名 / 紧凑序列化 / 配额保护 / 自动保存调度
 *   resumeHistory       历史版本快照的采样节流、去重与 LRU
 *   resumeDocuments     登记表与各文档槽位、备份汇出与恢复
 *   resumeMutations     模块树的纯操作（不碰存储、不认识 store）
 *   本文件              响应式状态 + 编排：把上面几层的纯数据结果同步回 ref
 *
 * 所以这里几乎不做具体工作，只负责「什么时候调用哪一层、结果怎么落到响应式状态」。
 */
export const useResumeStore = defineStore('resume', () => {
  /* ---------------- 响应式状态 ---------------- */

  // 简历对象整体会被替换（重置、导入），因此用 ref 保持深层响应
  const resume = ref<Resume>(createResume())
  // 以下都是原始值，用 shallowRef 避免无谓的深层代理
  const savedAt = shallowRef(0)
  const storageWarning = shallowRef('')
  const restored = shallowRef(false)
  /** 当前打开文档的 id；内容本体始终存在主文档键 resume-studio-v1 */
  const activeDocId = shallowRef('main')
  /** 本地简历登记表：[{ id, name, pinned, updatedAt }] */
  const docList = ref<DocEntry[]>([])
  /** 历史版本快照（LRU），供误操作后回退 */
  const snapshots = ref<Snapshot[]>([])
  /** 头像可拖拽范围（毫米，相对模板默认位置），由预览区测量后写入 */
  const avatarLimits = ref({ minDx: -120, maxDx: 120, minDy: -18, maxDy: 35 })

  /** 活跃文档 id 一变就落盘：刷新/崩溃后才能恢复到同一份，而不是错把别的文档当主文档 */
  watch(activeDocId, (id) => docs.writeActiveDocId(id))

  /* ---------------- 派生数据 ---------------- */

  const theme = computed(() => resume.value.theme)
  const basics = computed(() => resume.value.basics)
  const sections = computed(() => resume.value.sections)
  const visibleSections = computed(() => resume.value.sections.filter((s) => s.visible))

  /** 纸张与主题相关的 CSS 变量（几何计算抽在 utils/resumeStyle，分享页共用） */
  const pageStyle = computed(() => computePageStyle(resume.value))

  /** 打印页边距，注入到 document 的 @page 规则 */
  const printCss = computed(() => computePrintCss(resume.value))

  function dismissWarning(): void {
    storageWarning.value = ''
  }

  /* ---------------- 撤销 / 重做 ---------------- */

  const serializeForHistory = (): string => JSON.stringify(resume.value)
  const history = createHistory()

  /** 紧凑序列化当前简历（主键落盘、快照与槽位共用同一种存储形态） */
  const compactResume = (): string => compactForStorage(resume.value)

  /** 文档显示名：默认跟随简历里的姓名，手动重命名（pinned）后固定 */
  const deriveDocName = (data: Resume = resume.value): string => docs.deriveDocName(data)

  /** 驱动顶栏撤销/重做按钮的禁用态 */
  const canUndo = shallowRef(false)
  const canRedo = shallowRef(false)
  const syncHistoryFlags = (): void => {
    canUndo.value = history.canUndo()
    canRedo.value = history.canRedo()
  }

  /** 把当前状态立成新的历史基线（载入、切换文档、回退快照等「非编辑」动作后调用） */
  function updateBaseline(): void {
    history.reset(serializeForHistory())
    syncHistoryFlags()
  }

  /**
   * 成组修改（一次输入、一次拖拽、一次增删）停顿后记一笔。
   * 入栈的是修改前的基线：连续敲字只在停顿后产生一条历史。
   */
  const commitHistory = debounce(() => {
    if (history.commit(serializeForHistory())) syncHistoryFlags()
  }, HISTORY_DEBOUNCE_MS)

  watch(resume, commitHistory, { deep: true })

  /** 撤销。先把未满停顿窗口的输入补记入栈，保证当前状态能被「重做」回来 */
  function undo(): void {
    commitHistory.flush()
    const snapshot = history.undo(serializeForHistory())
    if (!snapshot) return
    resume.value = normalizeResume(JSON.parse(snapshot)) as Resume
    syncHistoryFlags()
  }

  function redo(): void {
    const snapshot = history.redo(serializeForHistory())
    if (!snapshot) return
    resume.value = normalizeResume(JSON.parse(snapshot)) as Resume
    syncHistoryFlags()
  }

  /* ---------------- 载入简历 ---------------- */

  /** 头像异步回填的代次：每次载入新数据递增，慢返回的旧回填直接作废 */
  let adoptGeneration = 0

  /**
   * 载入一份简历数据：头像若是 IndexedDB 引用，先置空渲染，
   * 异步取回 dataURL 后回填，避免模板渲染到非法 src。
   */
  function adoptResume(data: unknown): void {
    const generation = ++adoptGeneration
    const normalized = normalizeResume(data)
    const avatarRef = normalized.basics?.avatar
    if (typeof avatarRef === 'string' && avatarRef.startsWith(AVATAR_REF_PREFIX)) {
      normalized.basics.avatar = ''
      loadAvatar(avatarRef).then((dataUrl) => {
        // 等待期间可能已切换/导入过别的文档，过期回填会把 A 的头像写进 B
        if (generation !== adoptGeneration) return
        if (!dataUrl) {
          storageWarning.value = '头像的本地缓存读取失败，请重新上传头像'
          return
        }
        // 等待期间用户可能已经上传了新头像，仅在仍为空时回填
        if (!resume.value.basics.avatar) resume.value.basics.avatar = dataUrl
        // 回填属于「恢复本来状态」而不是一次编辑，历史基线随之重立
        updateBaseline()
      })
    }
    resume.value = normalized
  }

  /** 新建空白文档：姓名、求职意向与模块都清空，避免沿用上一份的内容 */
  function blankResume(): Resume {
    const blank = createResume()
    blank.basics.name = ''
    blank.basics.jobTitle = ''
    blank.basics.fields = []
    blank.sections = []
    return blank
  }

  /* ---------------- 持久化与自动保存 ---------------- */

  const autosave = createAutosave({
    getData: () => resume.value,
    onResult: (outcome) => {
      if (outcome.ok) {
        savedAt.value = Date.now()
        storageWarning.value = ''
        return
      }
      storageWarning.value = outcome.warning
    },
    onSaved: () => sampleSnapshot(),
    collectAvatarRefs: () => [
      ...collectOwnedAvatarRefs(),
      ...docs.collectSlotAvatarRefs(docList.value, activeDocId.value),
    ],
    onPrune: (refs) => pruneOrphanAvatars(refs),
  })

  /** 立即保存（跳过防抖），并把结果贴到响应式状态上 */
  const save = (): void => {
    autosave.saveNow()
  }

  const scheduleSave = (): void => autosave.scheduleSave()

  // 关页 / 切后台前立即落盘，最后几个字符不丢；store 销毁时解绑
  const unbindUnloadFlush = autosave.bindUnloadFlush()
  onScopeDispose(unbindUnloadFlush)

  watch(resume, scheduleSave, { deep: true })

  /* ---------------- 历史版本快照 ---------------- */

  /** 采样一份快照（受节流与去重约束），结果同步回响应式列表 */
  function sampleSnapshot(force = false): void {
    const { list, sampled } = history_.sample(snapshots.value, {
      serialize: () => compactResume(),
      getName: () => deriveDocName(),
      force,
    })
    // sample 未采样时会原样返回入参，这里只在真有变化时替换，避免无谓触发依赖
    if (sampled) snapshots.value = list
  }

  /**
   * 回退到某份历史版本。恢复前先把当前状态强制采样一份，反悔还能再回来。
   * @returns 是否恢复成功
   */
  function restoreSnapshot(id: string): boolean {
    const raw = history_.snapshotData(snapshots.value, id)
    if (raw === null) return false

    let data: Resume
    try {
      data = JSON.parse(raw) as Resume
    } catch {
      return false
    }

    sampleSnapshot(true)
    adoptResume(data)
    updateBaseline()
    save()
    return true
  }

  /* ---------------- 多份简历 ---------------- */

  /** 把当前文档写回自己的槽位（切换走之前调用），并刷新登记表 */
  function parkCurrentDoc(): void {
    const { warning } = docs.parkDoc(docList.value, activeDocId.value, resume.value)
    if (warning) storageWarning.value = warning
  }

  /** 切换到另一份简历：当前内容存回槽位，目标槽位载入主文档 */
  function switchDoc(id: string): void {
    if (id === activeDocId.value) return
    if (!docList.value.some((d) => d.id === id)) return

    // 槽位损坏时宁可不动，避免把当前文档切丢
    const data = docs.readDocSlot(id)
    if (!data) return

    parkCurrentDoc()
    activeDocId.value = id
    adoptResume(data)
    updateBaseline()
    save()
    // 新内容已落主键后再清目标槽位：中途崩溃最多留下一个重复槽位，不会丢文档
    docs.removeDocSlot(id)
  }

  /** 新建一份空白简历并切换过去 */
  function createDoc(): string {
    parkCurrentDoc()
    const id = docs.newDocId()
    docList.value.push(docs.makeDocEntry(id))
    activeDocId.value = id
    resume.value = blankResume()
    updateBaseline()
    docs.writeRegistry(docList.value)
    save()
    return id
  }

  /** 把一份简历数据（导入文件、分享页带入）存为新文档并切换过去 */
  function importAsDoc(data: unknown): string {
    parkCurrentDoc()
    const id = docs.newDocId()
    docList.value.push(docs.makeDocEntry(id))
    activeDocId.value = id
    adoptResume(data)
    updateBaseline()
    docs.writeRegistry(docList.value)
    save()
    return id
  }

  /** 复制一份简历（活跃文档取内存态，其余读槽位），放到登记表末尾 */
  function duplicateDoc(id: string): void {
    const entry = docList.value.find((d) => d.id === id)
    if (!entry) return

    const data = id === activeDocId.value ? clone(resume.value) : docs.readDocSlot(id)
    if (!data) return

    const newId = docs.newDocId()
    if (!docs.writeNormalizedSlot(newId, data)) {
      storageWarning.value = '复制简历失败：本机存储空间不足'
      return
    }
    docList.value.push(
      docs.makeDocEntry(newId, {
        name: `${entry.pinned ? entry.name : deriveDocName(data)} 副本`,
      }),
    )
    docs.writeRegistry(docList.value)
  }

  /** 手动重命名后固定，不再跟随简历姓名 */
  function renameDoc(id: string, name: string): void {
    const entry = docList.value.find((d) => d.id === id)
    if (!entry) return
    entry.name = String(name || '').trim() || entry.name
    entry.pinned = true
    docs.writeRegistry(docList.value)
  }

  /** 删除一份简历。至少保留一份；删除当前文档时自动切到列表里的第一份 */
  function removeDoc(id: string): boolean {
    if (docList.value.length <= 1) return false
    const index = docList.value.findIndex((d) => d.id === id)
    if (index === -1) return false

    docList.value.splice(index, 1)

    if (id !== activeDocId.value) {
      docs.removeDocSlot(id)
      docs.writeRegistry(docList.value)
      return true
    }

    // 删除的是当前文档：载入第一份其它简历顶上，被删内容不留残余
    const next = docList.value[0]
    const data = docs.readDocSlot(next.id)
    docs.removeDocSlot(id)
    activeDocId.value = next.id
    if (data) adoptResume(data)
    else resume.value = createResume()
    updateBaseline()
    docs.writeRegistry(docList.value)
    save()
    // 新内容已落主键后再清原槽位：中途崩溃最多留下一个重复槽位，不会丢文档
    if (data) docs.removeDocSlot(next.id)
    return true
  }

  /* ---------------- 整包备份 ---------------- */

  /**
   * 汇出本机全部简历与历史版本。头像引用在导出前内联回 dataURL，
   * 这样备份文件拷到任何设备都能完整恢复。
   */
  async function exportAllData(): Promise<ReturnType<typeof buildBackup>> {
    const docsPayload: Parameters<typeof buildBackup>[0]['docs'] = []
    for (const entry of docList.value) {
      const data = entry.id === activeDocId.value ? clone(resume.value) : docs.readDocSlot(entry.id)
      // 槽位损坏的单份简历跳过，不阻断整包备份
      if (!data) continue
      docsPayload.push({
        id: entry.id,
        name: entry.pinned ? entry.name : deriveDocName(data),
        pinned: Boolean(entry.pinned),
        updatedAt: entry.updatedAt,
        data: await docs.inlineAvatars(data),
      })
    }
    if (!docsPayload.length) throw new Error('没有可备份的简历')

    const snapsPayload: Parameters<typeof buildBackup>[0]['snapshots'] = []
    for (const snap of snapshots.value) {
      try {
        snapsPayload.push({
          id: snap.id,
          name: snap.name,
          updatedAt: snap.updatedAt,
          data: await docs.inlineAvatars(JSON.parse(snap.data) as Resume),
        })
      } catch {
        /* 单份快照损坏只影响它自己 */
      }
    }

    return buildBackup({ activeId: activeDocId.value, docs: docsPayload, snapshots: snapsPayload })
  }

  /**
   * 用整包备份覆盖本机全部数据：登记表、槽位、快照、当前文档。
   * 结构校验在 parseBackup 里完成，不合法直接抛错，本机数据一个字节都不动。
   * @returns 恢复的简历份数
   */
  function importAllData(raw: string | object): number {
    const parsed = parseBackup(raw)

    // 先清掉全部旧槽位，避免 id 不相交时留下孤儿文档占空间
    docs.clearInactiveSlots(docList.value, activeDocId.value)

    const target = parsed.docs.find((doc) => doc.id === parsed.activeId)
    docList.value = parsed.docs.map((doc) => ({
      id: doc.id,
      name: doc.name,
      pinned: doc.pinned,
      updatedAt: doc.updatedAt,
    }))

    let failed = 0
    parsed.docs.forEach((doc) => {
      if (doc.id === target.id) return
      if (!writeJSON(docs.docSlotKey(doc.id), compactForStorage(doc.data as Resume))) failed += 1
    })
    if (failed) {
      storageWarning.value = `整包恢复：${failed} 份简历因本机空间不足未写入，其余已恢复`
    }

    snapshots.value = parsed.snapshots.map((snap) => ({
      id: snap.id,
      name: snap.name,
      updatedAt: snap.updatedAt,
      data: compactForStorage(snap.data as Resume),
    }))
    history_.replaceSnapshots(snapshots.value)

    activeDocId.value = target.id
    adoptResume(target.data)
    updateBaseline()
    docs.writeRegistry(docList.value)
    save()
    return parsed.docs.length
  }

  /* ---------------- 载入 ---------------- */

  function load(): boolean {
    const saved = readSavedResume()
    if (saved) {
      // 内容损坏（解析失败）时按「首次使用」处理，退回默认示例
      try {
        adoptResume(saved)
        restored.value = true
      } catch {
        restored.value = false
      }
    }

    snapshots.value = history_.readSnapshots()

    // 登记表：老用户只有一份主文档，就地补一条登记，无感升级到多文档
    const existing = docs.readRegistry()
    if (existing) {
      docList.value = existing
      // 恢复上次正在编辑的文档：活跃内容存主键、其余存各自槽位，认错了就会张冠李戴
      const savedActiveId = docs.readActiveDocId()
      if (savedActiveId && existing.some((d) => d.id === savedActiveId)) {
        activeDocId.value = savedActiveId
      } else if (!existing.some((d) => d.id === activeDocId.value)) {
        activeDocId.value = existing[0].id
      }
    } else {
      docList.value = [docs.makeDocEntry(activeDocId.value, { name: deriveDocName() })]
      docs.writeRegistry(docList.value)
    }
    return restored.value
  }

  const loaded = load()

  // 历史基线以最终载入的数据为准：默认示例 → 已保存内容不算一次「修改」，
  // 否则页面刚打开撤销按钮就是亮的。基线必须在 load() 之后建立。
  updateBaseline()

  // 会话起点强制采一份快照：至少每次打开都有一个可回退的时点
  sampleSnapshot(true)

  /* ---------------- 主题与基本信息 ---------------- */

  function setTheme(patch: Partial<Theme>): void {
    Object.assign(resume.value.theme, patch)
  }

  function resetTheme(): void {
    resume.value.theme = { ...DEFAULT_THEME }
  }

  function setBasics(patch: Partial<Resume['basics']>): void {
    Object.assign(resume.value.basics, patch)
  }

  function setAvatarLimits(next: Partial<typeof avatarLimits.value>): void {
    avatarLimits.value = { ...avatarLimits.value, ...next }
  }

  /** 设置头像偏移，超出已测得边界时会被裁剪到边界值 */
  function setAvatarPos(patch: Partial<{ dx: number; dy: number }>): void {
    const current = resume.value.basics.avatarPos || { dx: 0, dy: 0 }
    const limits = avatarLimits.value
    const bounds = (min: number, max: number): [number, number] =>
      min <= max ? [min, max] : [max, min]

    const [minDx, maxDx] = bounds(limits.minDx, limits.maxDx)
    const [minDy, maxDy] = bounds(limits.minDy, limits.maxDy)

    const next = {
      dx: clamp(Number(patch.dx ?? current.dx) || 0, minDx, maxDx),
      dy: clamp(Number(patch.dy ?? current.dy) || 0, minDy, maxDy),
    }

    // 值未变化时不写回，避免与预览区的测量互相触发
    if (current.dx === next.dx && current.dy === next.dy) return
    resume.value.basics.avatarPos = next
  }

  function addBasicsField(): void {
    resume.value.basics.fields.push(tree.createBasicsField())
  }

  function updateBasicsField(id: string, patch: tree.Patch): void {
    const field = tree.findById(resume.value.basics.fields, id)
    if (field) Object.assign(field, patch)
  }

  function removeBasicsField(id: string): void {
    const fields = resume.value.basics.fields
    const index = fields.findIndex((f) => f.id === id)
    if (index >= 0) fields.splice(index, 1)
  }

  function moveBasicsField(from: number, to: number): void {
    resume.value.basics.fields = moveItem(resume.value.basics.fields, from, to)
  }

  /* ---------------- 全局操作 ---------------- */

  function resetAll(): void {
    resume.value = createResume()
    // 重置是「从这里重新数」的边界：清空历史，避免撤销一路回到重置前
    updateBaseline()
  }

  function replaceResume(data: unknown): void {
    adoptResume(data)
    updateBaseline()
  }

  function toJSON(): string {
    return JSON.stringify(resume.value, null, 2)
  }

  return {
    resume,
    theme,
    basics,
    sections,
    avatarLimits,
    visibleSections,
    pageStyle,
    printCss,
    savedAt,
    storageWarning,
    restored,
    canUndo,
    canRedo,
    dismissWarning,

    save,
    undo,
    redo,
    resetAll,
    replaceResume,
    toJSON,

    activeDocId,
    docList,
    switchDoc,
    createDoc,
    importAsDoc,
    duplicateDoc,
    renameDoc,
    removeDoc,

    snapshots,
    restoreSnapshot,
    exportAllData,
    importAllData,

    setTheme,
    resetTheme,

    setBasics,
    setAvatarPos,
    setAvatarLimits,
    addBasicsField,
    updateBasicsField,
    removeBasicsField,
    moveBasicsField,

    addSection: (type: Parameters<typeof tree.addSection>[1]) =>
      tree.addSection(resume.value, type),
    addSectionFromPreset: (key: string) => tree.addSectionFromPreset(resume.value, key),
    removeSection: (id: string) => tree.removeSection(resume.value, id),
    duplicateSection: (id: string) => tree.duplicateSection(resume.value, id),
    updateSection: (id: string, patch: tree.Patch) => tree.updateSection(resume.value, id, patch),
    updateSectionLayout: (id: string, patch: Parameters<typeof tree.updateSectionLayout>[2]) =>
      tree.updateSectionLayout(resume.value, id, patch),
    moveSection: (from: number, to: number) => tree.moveSection(resume.value, from, to),
    reorderSectionsByIds: (ids: string[]) => tree.reorderSectionsByIds(resume.value, ids),
    reorderEntriesByIds: (sid: string, ids: string[]) =>
      tree.reorderEntriesByIds(resume.value, sid, ids),
    reorderGridItemsByIds: (sid: string, ids: string[]) =>
      tree.reorderGridItemsByIds(resume.value, sid, ids),
    reorderSkillFieldsByIds: (sid: string, ids: string[]) =>
      tree.reorderSkillFieldsByIds(resume.value, sid, ids),
    reorderSkillsByIds: (sid: string, ids: string[]) =>
      tree.reorderSkillsByIds(resume.value, sid, ids),

    addGridItem: (sid: string) => tree.addGridItem(resume.value, sid),
    updateGridItem: (sid: string, iid: string, patch: Parameters<typeof tree.updateGridItem>[3]) =>
      tree.updateGridItem(resume.value, sid, iid, patch),
    removeGridItem: (sid: string, iid: string) => tree.removeGridItem(resume.value, sid, iid),

    addEntry: (sid: string) => tree.addEntry(resume.value, sid),
    updateEntry: (sid: string, eid: string, patch: tree.Patch) =>
      tree.updateEntry(resume.value, sid, eid, patch),
    removeEntry: (sid: string, eid: string) => tree.removeEntry(resume.value, sid, eid),
    moveEntry: (sid: string, from: number, to: number) =>
      tree.moveEntry(resume.value, sid, from, to),
    addBullet: (sid: string, eid: string) => tree.addBullet(resume.value, sid, eid),
    updateBullet: (sid: string, eid: string, bid: string, text: string) =>
      tree.updateBullet(resume.value, sid, eid, bid, text),
    removeBullet: (sid: string, eid: string, bid: string) =>
      tree.removeBullet(resume.value, sid, eid, bid),
    addEntryMeta: (sid: string, eid: string) => tree.addEntryMeta(resume.value, sid, eid),
    updateEntryMeta: (sid: string, eid: string, mid: string, patch: tree.Patch) =>
      tree.updateEntryMeta(resume.value, sid, eid, mid, patch),
    removeEntryMeta: (sid: string, eid: string, mid: string) =>
      tree.removeEntryMeta(resume.value, sid, eid, mid),

    addSkillField: (sid: string) => tree.addSkillField(resume.value, sid),
    updateSkillField: (sid: string, fid: string, patch: tree.Patch) =>
      tree.updateSkillField(resume.value, sid, fid, patch),
    removeSkillField: (sid: string, fid: string) => tree.removeSkillField(resume.value, sid, fid),
    addSkill: (sid: string) => tree.addSkill(resume.value, sid),
    updateSkill: (sid: string, skillId: string, patch: tree.Patch) =>
      tree.updateSkill(resume.value, sid, skillId, patch),
    removeSkill: (sid: string, skillId: string) => tree.removeSkill(resume.value, sid, skillId),

    /** 载入结果：true 表示本机有已保存内容被恢复 */
    loaded,
  }
})
