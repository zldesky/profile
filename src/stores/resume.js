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
import { FONTS, PAGE } from '@/data/presets'
import { createHistory } from '@/utils/history'
import { clamp, clone, debounce, hexToRgb, moveItem, uid } from '@/utils/helpers'

const STORAGE_KEY = 'resume-studio-v1'
/** localStorage 单域名容量约 5MB，预留安全余量 */
const STORAGE_LIMIT = 4.5 * 1024 * 1024

export const useResumeStore = defineStore('resume', () => {
  // 简历对象整体会被替换（重置、导入），因此用 ref 保持深层响应
  const resume = ref(createResume())
  // 以下都是原始值，用 shallowRef 避免无谓的深层代理
  const savedAt = shallowRef(0)
  const storageWarning = shallowRef('')
  const restored = shallowRef(false)

  /* ---------------- 派生数据 ---------------- */

  const theme = computed(() => resume.value.theme)
  const basics = computed(() => resume.value.basics)
  const sections = computed(() => resume.value.sections)
  const visibleSections = computed(() => resume.value.sections.filter((s) => s.visible))

  /** 纸张内容区宽度（毫米），用于换算头像的避让内边距 */
  const contentWidthMm = computed(() => PAGE.width - resume.value.theme.mh * 2)

  /**
   * 头像当前偏在哪一侧，决定正文从哪边避让。
   * 头像默认贴右，其左边缘越过纸张中线即视为已移到左侧。
   */
  const avatarSide = computed(() => {
    const width = Number(resume.value.basics.avatarWidth) || 0
    const dx = Number(resume.value.basics.avatarPos?.dx) || 0
    const containerWidth = contentWidthMm.value
    const left = containerWidth - width + dx
    return left >= containerWidth / 2 ? 'right' : 'left'
  })

  /**
   * 头像被拖离原位后，正文与联系方式需要避让的内边距。
   * 头像绝对定位、不占横向空间，因此这里的值就是它占据的宽度，
   * 正文可用宽度 = 纸张内容宽 - 该内边距。
   */
  const avatarPad = computed(() => {
    const width = Number(resume.value.basics.avatarWidth) || 0
    const dx = Number(resume.value.basics.avatarPos?.dx) || 0
    const containerWidth = contentWidthMm.value
    const gap = 4
    const left = containerWidth - width + dx

    if (avatarSide.value === 'right') {
      return { left: 0, right: Math.max(0, containerWidth - left + gap) }
    }
    return { left: Math.max(0, left + width + gap), right: 0 }
  })

  /**
   * 正文实际可用宽度（毫米）= 纸张内容宽 - 头像占位。
   * 头像被拖到页面中部时占位最大，正文会被压到 60mm 上下，
   * 联系方式的两列网格在那时会互相压住，需要据此退回单列。
   */
  const bodyWidthMm = computed(
    () => contentWidthMm.value - avatarPad.value.left - avatarPad.value.right,
  )

  /** 纸张与主题相关的 CSS 变量 */
  const pageStyle = computed(() => {
    const t = resume.value.theme

    // 底边线按百分比长度换算起始偏移：居中和右对齐时需扣除自身长度
    const lineWidth = clamp(Number(t.titleBottomWidth) || 0, 10, 100)
    const lineLeft =
      t.titleBottomAlign === 'center'
        ? `${(100 - lineWidth) / 2}%`
        : t.titleBottomAlign === 'right'
          ? `${100 - lineWidth}%`
          : '0%'

    return {
      '--accent': t.accent,
      '--accent-rgb': hexToRgb(t.accent),
      '--text': t.text,
      '--font': FONTS[t.fontKey]?.stack || FONTS.yahei.stack,
      '--fs': t.fs,
      '--lh': t.lh,
      '--gap': t.gap,
      '--mv': `${t.mv}mm`,
      '--mh': `${t.mh}mm`,
      '--avatar-w': `${resume.value.basics.avatarWidth}mm`,
      '--avatar-h': `${resume.value.basics.avatarHeight}mm`,
      '--avatar-dx': `${Number(resume.value.basics.avatarPos?.dx) || 0}mm`,
      '--avatar-dy': `${Number(resume.value.basics.avatarPos?.dy) || 0}mm`,
      // 向下拖拽时撑开页头高度，避免压到下方模块
      '--avatar-extra-h': `${Math.max(0, Number(resume.value.basics.avatarPos?.dy) || 0)}mm`,
      '--avatar-pad-left': `${avatarPad.value.left}mm`,
      '--avatar-pad-right': `${avatarPad.value.right}mm`,
      // 正文被头像挤到不足 120mm 时，联系方式退回单列而不是两列硬挤
      '--contact-cols': bodyWidthMm.value < 120 ? '1' : '2',

      '--title-gap': `${t.titleGap}em`,
      '--title-margin': `${t.titleMargin}em`,
      '--title-line-w': `${lineWidth}%`,
      '--title-line-left': lineLeft,
      '--title-line-size': `${t.titleBottomThickness}px`,
      '--title-line-gap': `${t.titleBottomGap}px`,
    }
  })

  /** 打印页边距，注入到 document 的 @page 规则 */
  const printCss = computed(() => {
    const t = resume.value.theme
    return `@page{size:A4;margin:${t.mv}mm ${t.mh}mm;}`
  })

  /* ---------------- 持久化 ---------------- */

  function save() {
    try {
      const serialized = JSON.stringify(resume.value)
      if (serialized.length > STORAGE_LIMIT) {
        storageWarning.value = '内容体积过大，可能无法自动保存，建议压缩头像图片或导出 JSON 备份'
        return
      }
      localStorage.setItem(STORAGE_KEY, serialized)
      savedAt.value = Date.now()
      storageWarning.value = ''
    } catch (error) {
      storageWarning.value = `自动保存失败：${error.message}`
    }
  }

  const scheduleSave = debounce(save, 400)

  // 关页/切后台前把防抖窗口里的改动立即落盘，最后的输入不丢
  const flushSave = () => {
    scheduleSave.cancel()
    save()
  }
  window.addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave()
  })

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
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      resume.value = normalizeResume(JSON.parse(raw))
      restored.value = true
      return true
    } catch {
      return false
    }
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
    resume.value = normalizeResume(data)
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

  return {
    resume,
    theme,
    basics,
    sections,
    contentWidthMm,
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
