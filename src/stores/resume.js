import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  DEFAULT_SECTION_LAYOUT,
  DEFAULT_THEME,
  createBullet,
  createEntry,
  createGridItem,
  createMeta,
  createResume,
  createSection,
  createSectionFromPreset,
  createSkill,
} from '@/data/defaultResume'
import { normalizeResume } from '@/data/normalizeResume'
import { buildBackup, inlineAvatarRefs, parseBackup } from '@/utils/backup'
import {
  AVATAR_REF_PREFIX,
  flushAvatarWrites,
  isAvailable as isAvatarStoreAvailable,
  loadAvatar,
  pruneAvatars,
  storeAvatar,
} from '@/utils/avatarStore'
import { createHistory } from '@/utils/history'
import { clamp, clone, debounce, moveItem, uid } from '@/utils/helpers'
import { computePageStyle, computePrintCss } from '@/utils/resumeStyle'

const STORAGE_KEY = 'resume-studio-v1'
/** localStorage 单域名容量约 5MB，预留安全余量 */
const STORAGE_LIMIT = 4.5 * 1024 * 1024
/** 多文档登记表：[{ id, name, pinned, updatedAt }] */
const REGISTRY_KEY = 'resume-studio-registry-v1'
/** 上次活跃文档 id：活跃文档内容存主键，刷新后要靠它恢复「正在编辑哪份」 */
const ACTIVE_DOC_KEY = 'resume-studio-active-v1'
const DOC_KEY_PREFIX = 'resume-studio-doc-'
/** 历史版本快照：[{ id, name, updatedAt, data }]，跨文档的时间线备份 */
const SNAPSHOTS_KEY = 'resume-studio-snapshots-v1'
/** 快照采样间隔与保留上限：约覆盖最近一小时内的关键时点 */
const SNAPSHOT_INTERVAL = 5 * 60 * 1000
const SNAPSHOT_MAX = 12

const docKey = (id) => `${DOC_KEY_PREFIX}${id}`

export const useResumeStore = defineStore('resume', () => {
  // 简历对象整体会被替换（重置、导入），因此用 ref 保持深层响应
  const resume = ref(createResume())
  // 以下都是原始值，用 shallowRef 避免无谓的深层代理
  const savedAt = shallowRef(0)
  const storageWarning = shallowRef('')
  const restored = shallowRef(false)
  /** 当前打开文档的 id；内容本体始终存在主文档键 resume-studio-v1 */
  const activeDocId = shallowRef('main')
  /** 本地简历登记表：[{ id, name, pinned, updatedAt }] */
  const docList = ref([])
  /** 历史版本快照（LRU），供误操作后回退 */
  const snapshots = ref([])

  // 活跃文档 id 一变就落盘：刷新/崩溃后才能恢复到同一份，而不是错把别的文档当主文档
  watch(activeDocId, (id) => {
    try {
      localStorage.setItem(ACTIVE_DOC_KEY, JSON.stringify(id))
    } catch {
      /* 写不进去只影响刷新后的定位，不影响当前编辑 */
    }
  })

  /* ---------------- 派生数据 ---------------- */

  const theme = computed(() => resume.value.theme)
  const basics = computed(() => resume.value.basics)
  const sections = computed(() => resume.value.sections)
  const visibleSections = computed(() => resume.value.sections.filter((s) => s.visible))

  /** 纸张与主题相关的 CSS 变量（几何计算抽在 utils/resumeStyle.js，分享页共用） */
  const pageStyle = computed(() => computePageStyle(resume.value))

  /** 打印页边距，注入到 document 的 @page 规则 */
  const printCss = computed(() => computePrintCss(resume.value))

  /* ---------------- 持久化 ---------------- */

  /**
   * 任意一份简历数据的紧凑序列化：头像 dataURL 换成 IndexedDB 引用。
   * 主文档落盘（serializeCompact）、整包恢复写槽位/快照共用这一条路径。
   */
  function compactForStorage(data) {
    const copy = clone(data)
    const avatar = copy.basics?.avatar
    if (isAvatarStoreAvailable() && typeof avatar === 'string' && avatar.startsWith('data:image')) {
      copy.basics.avatar = storeAvatar(avatar)
    }
    return JSON.stringify(copy)
  }

  function serializeCompact() {
    return compactForStorage(resume.value)
  }

  function save() {
    try {
      const serialized = serializeCompact()
      if (serialized.length > STORAGE_LIMIT) {
        storageWarning.value = '内容体积过大，可能无法自动保存，建议压缩头像图片或导出 JSON 备份'
        return
      }
      localStorage.setItem(STORAGE_KEY, serialized)
      savedAt.value = Date.now()
      storageWarning.value = ''
      maybeSnapshot()
      schedulePrune()
    } catch (error) {
      storageWarning.value = `自动保存失败：${error.message}`
    }
  }

  /* ---------------- 历史版本快照 ---------------- */

  function readSnapshots() {
    try {
      const list = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || 'null')
      if (Array.isArray(list)) {
        return list.filter((s) => s && typeof s.id === 'string' && typeof s.data === 'string')
      }
    } catch {
      /* 损坏的快照库按空处理 */
    }
    return []
  }

  function writeSnapshots(list) {
    try {
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list))
      return true
    } catch {
      return false
    }
  }

  /**
   * 保存时采样历史版本：与上一份间隔超过阈值才采，超出上限从最旧丢弃。
   * 快照是跨文档的时间线备份，data 为紧凑序列化（头像走 IndexedDB 引用）。
   * @param {boolean} force 跳过间隔检查（会话开始时采一份「起点」）
   */
  function maybeSnapshot(force = false) {
    const list = snapshots.value
    const now = Date.now()
    const last = list[list.length - 1]
    if (!force && last && now - last.updatedAt < SNAPSHOT_INTERVAL) return

    const data = serializeCompact()
    // 与上一份内容一致就跳过：频繁刷新不该用重复快照把真正有价值的旧版本挤出 LRU
    if (last && last.data === data) return

    list.push({ id: uid('snap'), name: deriveDocName(), updatedAt: now, data })
    while (list.length > SNAPSHOT_MAX) list.shift()

    if (!writeSnapshots(list)) {
      // 写入失败大概率是超容量：砍半重试一次，再失败就放弃本轮采样
      list.splice(0, Math.ceil(list.length / 2))
      writeSnapshots(list)
    }
  }

  /**
   * 回退到某份历史版本。恢复前先把当前状态强制采样一份，反悔还能再回来。
   * @param {string} id 快照 id
   * @returns {boolean} 是否恢复成功
   */
  function restoreSnapshot(id) {
    const snap = snapshots.value.find((s) => s.id === id)
    if (!snap) return false
    let data
    try {
      data = JSON.parse(snap.data)
    } catch {
      return false
    }
    maybeSnapshot(true)
    adoptResume(data)
    history.reset(serializeForHistory())
    syncHistoryFlags()
    save()
    return true
  }

  const scheduleSave = debounce(save, 400)

  /** 清掉已不被任何文档或快照引用的头像 blob（换过头像后会残留旧文件） */
  function pruneOrphanAvatars() {
    const keep = []
    try {
      const main = localStorage.getItem(STORAGE_KEY)
      if (main) keep.push(...collectAvatarRefs(main))
      docList.value.forEach((doc) => {
        if (doc.id === activeDocId.value) return
        const raw = localStorage.getItem(docKey(doc.id))
        if (raw) keep.push(...collectAvatarRefs(raw))
      })
      const snapsRaw = localStorage.getItem(SNAPSHOTS_KEY)
      if (snapsRaw) keep.push(...collectAvatarRefs(snapsRaw))
    } catch {
      return
    }
    pruneAvatars(keep)
  }

  const schedulePrune = debounce(pruneOrphanAvatars, 6000)

  const AVATAR_REF_RE = /idb-avatar:[0-9a-z]+/g

  function collectAvatarRefs(text) {
    return text.match(AVATAR_REF_RE) || []
  }

  // 关页/切后台前把防抖窗口里的改动立即落盘，最后的输入不丢
  const flushSave = () => {
    scheduleSave.cancel()
    save()
    // 头像二进制落 IndexedDB 是异步的：这里尽力等它提交，避免「引用已存、blob 未落库」
    flushAvatarWrites()
  }
  window.addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave()
  })

  /* ---------------- 多份简历 ---------------- */

  function readRegistry() {
    try {
      const list = JSON.parse(localStorage.getItem(REGISTRY_KEY) || 'null')
      if (Array.isArray(list) && list.length && list.every((d) => d && typeof d.id === 'string')) {
        return list
      }
    } catch {
      /* 损坏的登记表按首次使用处理 */
    }
    return null
  }

  function writeRegistry() {
    try {
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(docList.value))
    } catch {
      /* 登记表极小，写失败只影响列表展示，不打断编辑 */
    }
  }

  /** 文档显示名：默认跟随简历里的姓名，手动重命名（pinned）后固定 */
  const deriveDocName = (data = resume.value) =>
    String(data?.basics?.name || '').trim() || '未命名简历'

  /** 头像异步回填的代次：每次载入新数据递增，慢返回的旧回填直接作废 */
  let adoptGeneration = 0

  /**
   * 载入一份简历数据：头像若是 IndexedDB 引用，先置空渲染，
   * 异步取回 dataURL 后回填，避免模板渲染到非法 src。
   */
  function adoptResume(data) {
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
        history.reset(serializeForHistory())
        syncHistoryFlags()
      })
    }
    resume.value = normalized
  }

  /** 把当前文档写回自己的槽位（切换走之前调用），并刷新登记表 */
  function parkCurrentDoc() {
    const entry = docList.value.find((d) => d.id === activeDocId.value)
    if (!entry) return
    if (!entry.pinned) entry.name = deriveDocName()
    entry.updatedAt = Date.now()
    try {
      localStorage.setItem(docKey(entry.id), serializeCompact())
    } catch (error) {
      storageWarning.value = `简历副本保存失败：${error.message}`
    }
    writeRegistry()
  }

  /** 切换到另一份简历：当前内容存回槽位，目标槽位载入主文档 */
  function switchDoc(id) {
    if (id === activeDocId.value) return
    const entry = docList.value.find((d) => d.id === id)
    if (!entry) return

    let data = null
    try {
      const raw = localStorage.getItem(docKey(id))
      if (raw) data = JSON.parse(raw)
    } catch {
      data = null
    }
    // 槽位损坏时宁可不动，避免把当前文档切丢
    if (!data) return

    parkCurrentDoc()
    activeDocId.value = id
    adoptResume(data)
    history.reset(serializeForHistory())
    syncHistoryFlags()
    save()
    // 新内容已落主键后再清目标槽位：中途崩溃最多留下一个重复槽位，不会丢文档
    localStorage.removeItem(docKey(id))
  }

  /** 新建一份空白简历并切换过去 */
  function createDoc() {
    parkCurrentDoc()
    const id = uid('doc')
    docList.value.push({ id, name: '未命名简历', pinned: false, updatedAt: Date.now() })
    activeDocId.value = id
    const blank = createResume()
    blank.basics.name = ''
    blank.basics.jobTitle = ''
    blank.basics.fields = []
    blank.sections = []
    resume.value = blank
    history.reset(serializeForHistory())
    syncHistoryFlags()
    writeRegistry()
    save()
    return id
  }

  /** 把一份简历数据（导入文件、分享页带入）存为新文档并切换过去 */
  function importAsDoc(data) {
    parkCurrentDoc()
    const id = uid('doc')
    docList.value.push({ id, name: '未命名简历', pinned: false, updatedAt: Date.now() })
    activeDocId.value = id
    adoptResume(data)
    history.reset(serializeForHistory())
    syncHistoryFlags()
    writeRegistry()
    save()
    return id
  }

  /** 复制一份简历（活跃文档取内存态，其余读槽位），放到登记表末尾 */
  function duplicateDoc(id) {
    const entry = docList.value.find((d) => d.id === id)
    if (!entry) return

    let data
    if (id === activeDocId.value) {
      data = clone(resume.value)
    } else {
      try {
        data = JSON.parse(localStorage.getItem(docKey(id)) || 'null')
      } catch {
        data = null
      }
    }
    if (!data) return

    const newId = uid('doc')
    try {
      localStorage.setItem(docKey(newId), JSON.stringify(normalizeResume(data)))
      docList.value.push({
        id: newId,
        name: `${entry.pinned ? entry.name : deriveDocName(data)} 副本`,
        pinned: false,
        updatedAt: Date.now(),
      })
      writeRegistry()
    } catch (error) {
      storageWarning.value = `复制简历失败：${error.message}`
    }
  }

  /** 手动重命名后固定，不再跟随简历姓名 */
  function renameDoc(id, name) {
    const entry = docList.value.find((d) => d.id === id)
    if (!entry) return
    entry.name = String(name || '').trim() || entry.name
    entry.pinned = true
    writeRegistry()
  }

  /**
   * 删除一份简历。至少保留一份；删除当前文档时自动切到列表里的第一份。
   * @returns {boolean} 是否删除成功
   */
  function removeDoc(id) {
    if (docList.value.length <= 1) return false
    const index = docList.value.findIndex((d) => d.id === id)
    if (index === -1) return false

    docList.value.splice(index, 1)

    if (id !== activeDocId.value) {
      localStorage.removeItem(docKey(id))
      writeRegistry()
      return true
    }

    // 删除的是当前文档：载入第一份其它简历顶上，被删内容不留残余
    const next = docList.value[0]
    let data = null
    try {
      const raw = localStorage.getItem(docKey(next.id))
      if (raw) data = JSON.parse(raw)
    } catch {
      data = null
    }
    localStorage.removeItem(docKey(id))
    activeDocId.value = next.id
    if (data) {
      adoptResume(data)
    } else {
      resume.value = createResume()
    }
    history.reset(serializeForHistory())
    syncHistoryFlags()
    writeRegistry()
    save()
    // 新内容已落主键后再清原槽位：中途崩溃最多留下一个重复槽位，不会丢文档
    if (data) localStorage.removeItem(docKey(next.id))
    return true
  }

  /* ---------------- 整包备份 ---------------- */

  /**
   * 汇出本机全部简历与历史版本。头像引用在导出前内联回 dataURL，
   * 这样备份文件拷到任何设备都能完整恢复。
   * @returns {Promise<object>} 整包备份数据（交给调用方下载）
   */
  async function exportAllData() {
    const docs = []
    for (const entry of docList.value) {
      let data = null
      if (entry.id === activeDocId.value) {
        data = clone(resume.value)
      } else {
        try {
          data = JSON.parse(localStorage.getItem(docKey(entry.id)) || 'null')
        } catch {
          /* 槽位损坏按缺失处理，data 保持 null，这份简历跳过 */
        }
      }
      // 槽位损坏的单份简历跳过，不阻断整包备份
      if (!data) continue
      docs.push({
        id: entry.id,
        name: entry.pinned ? entry.name : deriveDocName(data),
        pinned: Boolean(entry.pinned),
        updatedAt: entry.updatedAt,
        data: await inlineAvatarRefs(data, loadAvatar),
      })
    }
    if (!docs.length) throw new Error('没有可备份的简历')

    const snaps = []
    for (const snap of snapshots.value) {
      try {
        snaps.push({
          id: snap.id,
          name: snap.name,
          updatedAt: snap.updatedAt,
          data: await inlineAvatarRefs(JSON.parse(snap.data), loadAvatar),
        })
      } catch {
        /* 单份快照损坏只影响它自己 */
      }
    }

    return buildBackup({ activeId: activeDocId.value, docs, snapshots: snaps })
  }

  /**
   * 用整包备份覆盖本机全部数据：登记表、槽位、快照、当前文档。
   * 结构校验在 parseBackup 里完成，不合法直接抛错，本机数据一个字节都不动。
   * @param {string|object} raw 备份文件内容
   * @returns {number} 恢复的简历份数
   */
  function importAllData(raw) {
    const parsed = parseBackup(raw)

    // 先清掉全部旧槽位，避免 id 不相交时留下孤儿文档占空间
    docList.value.forEach((doc) => {
      if (doc.id !== activeDocId.value) localStorage.removeItem(docKey(doc.id))
    })

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
      try {
        localStorage.setItem(docKey(doc.id), compactForStorage(doc.data))
      } catch {
        failed += 1
      }
    })
    if (failed) {
      storageWarning.value = `整包恢复：${failed} 份简历因本机空间不足未写入，其余已恢复`
    }

    snapshots.value = parsed.snapshots.map((snap) => ({
      id: snap.id,
      name: snap.name,
      updatedAt: snap.updatedAt,
      data: compactForStorage(snap.data),
    }))
    writeSnapshots(snapshots.value)

    activeDocId.value = target.id
    adoptResume(target.data)
    history.reset(serializeForHistory())
    syncHistoryFlags()
    writeRegistry()
    save()
    return parsed.docs.length
  }

  /* ---------------- 撤销 / 重做 ---------------- */

  const serializeForHistory = () => JSON.stringify(resume.value)
  const history = createHistory()

  /** 驱动顶栏撤销/重做按钮的禁用态 */
  const canUndo = shallowRef(false)
  const canRedo = shallowRef(false)
  const syncHistoryFlags = () => {
    canUndo.value = history.canUndo()
    canRedo.value = history.canRedo()
  }

  /**
   * 成组修改（一次输入、一次拖拽、一次增删）停顿后记一笔。
   * 入栈的是修改前的基线：连续敲字只在停顿后产生一条历史。
   */
  const commitHistory = debounce(() => {
    if (history.commit(serializeForHistory())) syncHistoryFlags()
  }, 600)

  watch(resume, commitHistory, { deep: true })

  /** 撤销。先把未满停顿窗口的输入补记入栈，保证当前状态能被「重做」回来 */
  function undo() {
    commitHistory.flush()
    const snapshot = history.undo(serializeForHistory())
    if (!snapshot) return
    resume.value = normalizeResume(JSON.parse(snapshot))
    syncHistoryFlags()
  }

  function redo() {
    const snapshot = history.redo(serializeForHistory())
    if (!snapshot) return
    resume.value = normalizeResume(JSON.parse(snapshot))
    syncHistoryFlags()
  }

  function load() {
    let loaded = false
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        adoptResume(JSON.parse(raw))
        restored.value = true
        loaded = true
      }
    } catch {
      loaded = false
    }

    snapshots.value = readSnapshots()

    // 登记表：老用户只有一份主文档，就地补一条登记，无感升级到多文档
    const existing = readRegistry()
    if (existing) {
      docList.value = existing
      // 恢复上次正在编辑的文档：活跃内容存主键、其余存各自槽位，认错了就会张冠李戴
      let savedActiveId = null
      try {
        savedActiveId = JSON.parse(localStorage.getItem(ACTIVE_DOC_KEY) || 'null')
      } catch {
        savedActiveId = null
      }
      if (
        typeof savedActiveId === 'string' &&
        savedActiveId &&
        existing.some((d) => d.id === savedActiveId)
      ) {
        activeDocId.value = savedActiveId
      } else if (!existing.some((d) => d.id === activeDocId.value)) {
        activeDocId.value = existing[0].id
      }
    } else {
      docList.value = [
        { id: activeDocId.value, name: deriveDocName(), pinned: false, updatedAt: Date.now() },
      ]
      writeRegistry()
    }
    return loaded
  }

  watch(resume, scheduleSave, { deep: true })

  /* ---------------- 定位辅助 ---------------- */

  function findSection(sectionId) {
    return resume.value.sections.find((s) => s.id === sectionId)
  }

  function findById(list, id) {
    return Array.isArray(list) ? list.find((item) => item.id === id) : undefined
  }

  /* ---------------- 主题 ---------------- */

  function setTheme(patch) {
    Object.assign(resume.value.theme, patch)
  }

  function resetTheme() {
    resume.value.theme = { ...DEFAULT_THEME }
  }

  /* ---------------- 基本信息 ---------------- */

  function setBasics(patch) {
    Object.assign(resume.value.basics, patch)
  }

  /**
   * 头像可拖拽范围（毫米，相对模板默认位置）。
   * 由预览区测量头像所在容器后写入，作为拖拽与滑杆共用的唯一边界。
   */
  const avatarLimits = ref({ minDx: -120, maxDx: 120, minDy: -18, maxDy: 35 })

  function setAvatarLimits(next) {
    avatarLimits.value = { ...avatarLimits.value, ...next }
  }

  /** 设置头像偏移，超出已测得边界时会被裁剪到边界值 */
  function setAvatarPos(patch) {
    const current = resume.value.basics.avatarPos || { dx: 0, dy: 0 }
    const limits = avatarLimits.value
    const bounds = (min, max) => (min <= max ? [min, max] : [max, min])

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

  function addBasicsField() {
    resume.value.basics.fields.push(createGridItem({ icon: 'none', label: '字段名', value: '' }))
  }

  function updateBasicsField(id, patch) {
    const field = findById(resume.value.basics.fields, id)
    if (field) Object.assign(field, patch)
  }

  function removeBasicsField(id) {
    const fields = resume.value.basics.fields
    const index = fields.findIndex((f) => f.id === id)
    if (index >= 0) fields.splice(index, 1)
  }

  function moveBasicsField(from, to) {
    resume.value.basics.fields = moveItem(resume.value.basics.fields, from, to)
  }

  /* ---------------- 模块 ---------------- */

  function addSection(type) {
    const section = createSection(type, '新模块')
    resume.value.sections.push(section)
    return section.id
  }

  /**
   * 按常用模块预设新增模块（教育背景、项目经历、荣誉奖项等）。
   * @param {string} key SECTION_PRESETS 中的 key
   */
  function addSectionFromPreset(key) {
    const section = createSectionFromPreset(key)
    resume.value.sections.push(section)
    return section.id
  }

  function removeSection(id) {
    const index = resume.value.sections.findIndex((s) => s.id === id)
    if (index >= 0) resume.value.sections.splice(index, 1)
  }

  function duplicateSection(id) {
    const section = findSection(id)
    if (!section) return
    const copy = clone(section)
    copy.id = uid('sec')
    copy.title = `${section.title} 副本`
    reIdSection(copy)
    const index = resume.value.sections.findIndex((s) => s.id === id)
    resume.value.sections.splice(index + 1, 0, copy)
  }

  /** 深拷贝模块后重新分配所有子项 id */
  function reIdSection(section) {
    if (section.items) section.items.forEach((item) => (item.id = uid('i')))
    if (section.fields) section.fields.forEach((item) => (item.id = uid('i')))
    if (section.type === 'entries') {
      section.items.forEach((entry) => {
        entry.meta.forEach((m) => (m.id = uid('m')))
        entry.bullets.forEach((b) => (b.id = uid('b')))
      })
    }
  }

  function updateSection(id, patch) {
    const section = findSection(id)
    if (section) Object.assign(section, patch)
  }

  /**
   * 更新模块的位置与对齐设置，只覆盖传入的字段。
   * @param {string} id 模块 id
   * @param {object} patch 需要修改的布局项
   */
  function updateSectionLayout(id, patch) {
    const section = findSection(id)
    if (!section) return
    section.layout = { ...DEFAULT_SECTION_LAYOUT, ...(section.layout || {}), ...patch }
  }

  function moveSection(from, to) {
    resume.value.sections = moveItem(resume.value.sections, from, to)
  }

  /**
   * 按给定 id 顺序整体重排模块（纸面框选拖拽排序用）。
   * 传入顺序必须是现有 id 的一个排列，否则忽略，避免拖出残缺数组。
   * @param {string[]} orderedIds 重排后的完整 id 顺序
   */
  function reorderSectionsByIds(orderedIds) {
    const sections = resume.value.sections
    if (!Array.isArray(orderedIds) || orderedIds.length !== sections.length) return
    const byId = new Map(sections.map((s) => [s.id, s]))
    if (orderedIds.some((id) => !byId.has(id))) return
    resume.value.sections = orderedIds.map((id) => byId.get(id))
  }

  /* ---------------- 键值网格 ---------------- */

  function addGridItem(sectionId) {
    findSection(sectionId)?.items.push(createGridItem({ icon: 'none', label: '标签', value: '' }))
  }

  function updateGridItem(sectionId, itemId, patch) {
    const item = findById(findSection(sectionId)?.items, itemId)
    if (item) Object.assign(item, patch)
  }

  function removeGridItem(sectionId, itemId) {
    const items = findSection(sectionId)?.items
    const index = items ? items.findIndex((i) => i.id === itemId) : -1
    if (index >= 0) items.splice(index, 1)
  }

  /* ---------------- 条目列表 ---------------- */

  function addEntry(sectionId) {
    findSection(sectionId)?.items.push(createEntry())
  }

  function updateEntry(sectionId, entryId, patch) {
    const entry = findById(findSection(sectionId)?.items, entryId)
    if (entry) Object.assign(entry, patch)
  }

  function removeEntry(sectionId, entryId) {
    const items = findSection(sectionId)?.items
    const index = items ? items.findIndex((i) => i.id === entryId) : -1
    if (index >= 0) items.splice(index, 1)
  }

  function moveEntry(sectionId, from, to) {
    const section = findSection(sectionId)
    if (section) section.items = moveItem(section.items, from, to)
  }

  function addBullet(sectionId, entryId) {
    findById(findSection(sectionId)?.items, entryId)?.bullets.push(createBullet())
  }

  function updateBullet(sectionId, entryId, bulletId, text) {
    const bullet = findById(findById(findSection(sectionId)?.items, entryId)?.bullets, bulletId)
    if (bullet) bullet.text = text
  }

  function removeBullet(sectionId, entryId, bulletId) {
    const entry = findById(findSection(sectionId)?.items, entryId)
    if (!entry) return
    const index = entry.bullets.findIndex((b) => b.id === bulletId)
    if (index >= 0) entry.bullets.splice(index, 1)
  }

  function addEntryMeta(sectionId, entryId) {
    findById(findSection(sectionId)?.items, entryId)?.meta.push(createMeta('项目', ''))
  }

  function updateEntryMeta(sectionId, entryId, metaId, patch) {
    const meta = findById(findById(findSection(sectionId)?.items, entryId)?.meta, metaId)
    if (meta) Object.assign(meta, patch)
  }

  function removeEntryMeta(sectionId, entryId, metaId) {
    const entry = findById(findSection(sectionId)?.items, entryId)
    if (!entry) return
    const index = entry.meta.findIndex((m) => m.id === metaId)
    if (index >= 0) entry.meta.splice(index, 1)
  }

  /* ---------------- 技能特长 ---------------- */

  function addSkillField(sectionId) {
    findSection(sectionId)?.fields.push(createMeta('技能描述', ''))
  }

  function updateSkillField(sectionId, fieldId, patch) {
    const field = findById(findSection(sectionId)?.fields, fieldId)
    if (field) Object.assign(field, patch)
  }

  function removeSkillField(sectionId, fieldId) {
    const fields = findSection(sectionId)?.fields
    const index = fields ? fields.findIndex((f) => f.id === fieldId) : -1
    if (index >= 0) fields.splice(index, 1)
  }

  function addSkill(sectionId) {
    findSection(sectionId)?.items.push(createSkill({ name: '新技能', level: 80 }))
  }

  function updateSkill(sectionId, skillId, patch) {
    const skill = findById(findSection(sectionId)?.items, skillId)
    if (skill) Object.assign(skill, patch)
  }

  function removeSkill(sectionId, skillId) {
    const items = findSection(sectionId)?.items
    const index = items ? items.findIndex((i) => i.id === skillId) : -1
    if (index >= 0) items.splice(index, 1)
  }

  /* ---------------- 全局操作 ---------------- */

  function resetAll() {
    resume.value = createResume()
    // 重置是「从这里重新数」的边界：清空历史，避免撤销一路回到重置前
    history.reset(serializeForHistory())
    syncHistoryFlags()
  }

  function replaceResume(data) {
    adoptResume(data)
    history.reset(serializeForHistory())
    syncHistoryFlags()
  }

  function toJSON() {
    return JSON.stringify(resume.value, null, 2)
  }

  load()

  // 历史基线以最终载入的数据为准：默认示例 → 已保存内容不算一次「修改」，
  // 否则页面刚打开撤销按钮就是亮的。基线必须在 load() 之后建立。
  history.init(serializeForHistory())

  // 会话起点强制采一份快照：至少每次打开都有一个可回退的时点
  maybeSnapshot(true)

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

    addSection,
    addSectionFromPreset,
    removeSection,
    duplicateSection,
    updateSection,
    updateSectionLayout,
    moveSection,
    reorderSectionsByIds,

    addGridItem,
    updateGridItem,
    removeGridItem,

    addEntry,
    updateEntry,
    removeEntry,
    moveEntry,
    addBullet,
    updateBullet,
    removeBullet,
    addEntryMeta,
    updateEntryMeta,
    removeEntryMeta,

    addSkillField,
    updateSkillField,
    removeSkillField,
    addSkill,
    updateSkill,
    removeSkill,
  }
})
