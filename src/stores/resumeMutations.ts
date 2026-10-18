/**
 * 简历模块树的纯操作。
 *
 * 这些函数只读写传入的 resume 对象，不碰 localStorage、不碰响应式、不认识 store：
 * 输入输出都落在简历数据结构上，因此可以脱离浏览器环境直接单测。
 * 持久化、撤销重做、云端同步都由调用方（stores/resume）负责编排。
 *
 * 约定：找不到目标时一律安静返回（不抛错）。编辑器的交互里「点了已删除的模块」
 * 是正常时序，抛错会把一次误触升级成白屏。
 */

import {
  DEFAULT_SECTION_LAYOUT,
  createBullet,
  createEntry,
  createGridItem,
  createMeta,
  createSection,
  createSectionFromPreset,
  createSkill,
} from '@/data/defaultResume'
import { clone, moveItem, uid } from '@/utils/helpers'
import type { GridItem, Resume, Section, SectionType } from '@/types/resume'

/** 各 mutation 的 patch 参数：模块内容按类型差异很大，逐一建模收益低 */
export type Patch = Record<string, unknown>

/** 按 id 定位模块；给了 type 就要求类型也匹配（哪种模块才有 items 写进签名里） */
export function findSection(resume: Resume, id: string): Section | undefined
export function findSection<T extends SectionType>(
  resume: Resume,
  id: string,
  type: T,
): Extract<Section, { type: T }> | undefined
export function findSection(resume: Resume, id: string, type?: SectionType): Section | undefined {
  const section = resume.sections.find((s) => s.id === id)
  if (!section) return undefined
  if (type && section.type !== type) return undefined
  return section
}

/** 在任意带 id 的列表里定位一项（列表可能因上层找不到模块而是 undefined） */
export function findById<T extends { id: string }>(
  list: T[] | undefined,
  id: string,
): T | undefined {
  return Array.isArray(list) ? list.find((item) => item.id === id) : undefined
}

/* ---------------- 基本信息字段 ---------------- */

/** 新增一个基本信息键值字段（联系方式、求职意向等） */
export function createBasicsField(): GridItem {
  return createGridItem({ icon: 'none', label: '字段名', value: '' })
}

/* ---------------- 模块 ---------------- */

export function addSection(resume: Resume, type: SectionType): string {
  const section = createSection(type, '新模块')
  resume.sections.push(section)
  return section.id
}

/** 按常用模块预设新增模块（教育背景、项目经历、荣誉奖项等） */
export function addSectionFromPreset(resume: Resume, key: string): string {
  const section = createSectionFromPreset(key)
  resume.sections.push(section)
  return section.id
}

export function removeSection(resume: Resume, id: string): void {
  const index = resume.sections.findIndex((s) => s.id === id)
  if (index >= 0) resume.sections.splice(index, 1)
}

/** 复制模块并插在原模块之后；深拷贝后重新分配所有子项 id，改副本不会影响原件 */
export function duplicateSection(resume: Resume, id: string): void {
  const section = findSection(resume, id)
  if (!section) return
  const copy = clone(section)
  copy.id = uid('sec')
  copy.title = `${section.title} 副本`
  reIdSection(copy)
  const index = resume.sections.findIndex((s) => s.id === id)
  resume.sections.splice(index + 1, 0, copy)
}

/** 深拷贝模块后重新分配所有子项 id */
function reIdSection(section: Section): void {
  // 用 in 收窄而不是真值判断：Section 是联合类型，直接取 .items 无法通过类型检查
  if ('items' in section) section.items.forEach((item) => (item.id = uid('i')))
  if ('fields' in section) section.fields.forEach((item) => (item.id = uid('i')))
  if (section.type === 'entries') {
    section.items.forEach((entry) => {
      entry.meta.forEach((m) => (m.id = uid('m')))
      entry.bullets.forEach((b) => (b.id = uid('b')))
    })
  }
}

export function updateSection(resume: Resume, id: string, patch: Patch): void {
  const section = findSection(resume, id)
  if (section) Object.assign(section, patch)
}

/** 更新模块的位置与对齐设置，只覆盖传入的字段 */
export function updateSectionLayout(
  resume: Resume,
  id: string,
  patch: Partial<Section['layout']>,
): void {
  const section = findSection(resume, id)
  if (!section) return
  section.layout = { ...DEFAULT_SECTION_LAYOUT, ...(section.layout || {}), ...patch }
}

export function moveSection(resume: Resume, from: number, to: number): void {
  resume.sections = moveItem(resume.sections, from, to)
}

/**
 * 按给定 id 顺序整体重排模块（纸面框选拖拽排序用）。
 * 传入顺序必须是现有 id 的一个排列，否则忽略，避免拖出残缺数组。
 */
export function reorderSectionsByIds(resume: Resume, orderedIds: string[]): void {
  const sections = resume.sections
  if (!Array.isArray(orderedIds) || orderedIds.length !== sections.length) return
  const byId = new Map(sections.map((s) => [s.id, s]))
  if (orderedIds.some((id) => !byId.has(id))) return
  // 上面的 has 校验已保证每个 id 都存在，这里断言只是把该前提写给类型系统
  resume.sections = orderedIds.map((id) => byId.get(id)!)
}

/* ---------------- 键值网格 ---------------- */

export function addGridItem(resume: Resume, sectionId: string): void {
  findSection(resume, sectionId, 'grid')?.items.push(
    createGridItem({ icon: 'none', label: '标签', value: '' }),
  )
}

export function updateGridItem(
  resume: Resume,
  sectionId: string,
  itemId: string,
  patch: Partial<GridItem>,
): void {
  const item = findById(findSection(resume, sectionId, 'grid')?.items, itemId)
  if (item) Object.assign(item, patch)
}

export function removeGridItem(resume: Resume, sectionId: string, itemId: string): void {
  const items = findSection(resume, sectionId, 'grid')?.items
  const index = items ? items.findIndex((i) => i.id === itemId) : -1
  if (items && index >= 0) items.splice(index, 1)
}

/** 按 id 顺序重排某个键值网格模块的字段 */
export function reorderGridItemsByIds(
  resume: Resume,
  sectionId: string,
  orderedIds: string[],
): void {
  const section = findSection(resume, sectionId, 'grid')
  if (!section) return
  const next = reorderByIds(section.items, orderedIds)
  if (next) section.items = next
}

/* ---------------- 条目列表 ---------------- */

export function addEntry(resume: Resume, sectionId: string): void {
  findSection(resume, sectionId, 'entries')?.items.push(createEntry())
}

export function updateEntry(
  resume: Resume,
  sectionId: string,
  entryId: string,
  patch: Patch,
): void {
  const entry = findById(findSection(resume, sectionId, 'entries')?.items, entryId)
  if (entry) Object.assign(entry, patch)
}

export function removeEntry(resume: Resume, sectionId: string, entryId: string): void {
  const items = findSection(resume, sectionId, 'entries')?.items
  const index = items ? items.findIndex((i) => i.id === entryId) : -1
  if (items && index >= 0) items.splice(index, 1)
}

export function moveEntry(resume: Resume, sectionId: string, from: number, to: number): void {
  const section = findSection(resume, sectionId, 'entries')
  if (section) section.items = moveItem(section.items, from, to)
}

/**
 * 按给定 id 顺序整体重排一个数组。
 *
 * 与 reorderSectionsByIds 同一套校验：传入顺序必须是现有 id 的一个排列，
 * 否则安静忽略 —— 拖拽组件偶尔会在增删的中间态给出残缺数组，
 * 那时宁可不换序，也不能把数组改成缺项的样子。
 *
 * 单独抽出来是因为条目 / 网格项 / 技能三处都要用，
 * 而已有的 reorderSectionsByIds 直接写在 resume.sections 上、无法复用。
 */
function reorderByIds<T extends { id: string }>(list: T[], orderedIds: string[]): T[] | null {
  if (!Array.isArray(orderedIds) || orderedIds.length !== list.length) return null
  const byId = new Map(list.map((item) => [item.id, item]))
  if (orderedIds.some((id) => !byId.has(id))) return null
  // 上面的 has 校验已保证每个 id 都存在，这里断言只是把该前提写给类型系统
  return orderedIds.map((id) => byId.get(id)!)
}

/** 按 id 顺序重排某个经历模块的条目 */
export function reorderEntriesByIds(resume: Resume, sectionId: string, orderedIds: string[]): void {
  const section = findSection(resume, sectionId, 'entries')
  if (!section) return
  const next = reorderByIds(section.items, orderedIds)
  if (next) section.items = next
}

export function addBullet(resume: Resume, sectionId: string, entryId: string): void {
  findById(findSection(resume, sectionId, 'entries')?.items, entryId)?.bullets.push(createBullet())
}

export function updateBullet(
  resume: Resume,
  sectionId: string,
  entryId: string,
  bulletId: string,
  text: string,
): void {
  const bullet = findById(
    findById(findSection(resume, sectionId, 'entries')?.items, entryId)?.bullets,
    bulletId,
  )
  if (bullet) bullet.text = text
}

export function removeBullet(
  resume: Resume,
  sectionId: string,
  entryId: string,
  bulletId: string,
): void {
  const entry = findById(findSection(resume, sectionId, 'entries')?.items, entryId)
  if (!entry) return
  const index = entry.bullets.findIndex((b) => b.id === bulletId)
  if (index >= 0) entry.bullets.splice(index, 1)
}

export function addEntryMeta(resume: Resume, sectionId: string, entryId: string): void {
  findById(findSection(resume, sectionId, 'entries')?.items, entryId)?.meta.push(
    createMeta('项目', ''),
  )
}

export function updateEntryMeta(
  resume: Resume,
  sectionId: string,
  entryId: string,
  metaId: string,
  patch: Patch,
): void {
  const meta = findById(
    findById(findSection(resume, sectionId, 'entries')?.items, entryId)?.meta,
    metaId,
  )
  if (meta) Object.assign(meta, patch)
}

export function removeEntryMeta(
  resume: Resume,
  sectionId: string,
  entryId: string,
  metaId: string,
): void {
  const entry = findById(findSection(resume, sectionId, 'entries')?.items, entryId)
  if (!entry) return
  const index = entry.meta.findIndex((m) => m.id === metaId)
  if (index >= 0) entry.meta.splice(index, 1)
}

/* ---------------- 技能特长 ---------------- */

export function addSkillField(resume: Resume, sectionId: string): void {
  findSection(resume, sectionId, 'skills')?.fields.push(createMeta('技能描述', ''))
}

export function updateSkillField(
  resume: Resume,
  sectionId: string,
  fieldId: string,
  patch: Patch,
): void {
  const field = findById(findSection(resume, sectionId, 'skills')?.fields, fieldId)
  if (field) Object.assign(field, patch)
}

export function removeSkillField(resume: Resume, sectionId: string, fieldId: string): void {
  const fields = findSection(resume, sectionId, 'skills')?.fields
  const index = fields ? fields.findIndex((f) => f.id === fieldId) : -1
  if (fields && index >= 0) fields.splice(index, 1)
}

export function addSkill(resume: Resume, sectionId: string): void {
  findSection(resume, sectionId, 'skills')?.items.push(createSkill({ name: '新技能', level: 80 }))
}

export function updateSkill(
  resume: Resume,
  sectionId: string,
  skillId: string,
  patch: Patch,
): void {
  const skill = findById(findSection(resume, sectionId, 'skills')?.items, skillId)
  if (skill) Object.assign(skill, patch)
}

export function removeSkill(resume: Resume, sectionId: string, skillId: string): void {
  const items = findSection(resume, sectionId, 'skills')?.items
  const index = items ? items.findIndex((i) => i.id === skillId) : -1
  if (items && index >= 0) items.splice(index, 1)
}

/** 按 id 顺序重排技能模块的「文字描述」字段 */
export function reorderSkillFieldsByIds(
  resume: Resume,
  sectionId: string,
  orderedIds: string[],
): void {
  const section = findSection(resume, sectionId, 'skills')
  if (!section) return
  const next = reorderByIds(section.fields, orderedIds)
  if (next) section.fields = next
}

/** 按 id 顺序重排技能模块的技能条目 */
export function reorderSkillsByIds(resume: Resume, sectionId: string, orderedIds: string[]): void {
  const section = findSection(resume, sectionId, 'skills')
  if (!section) return
  const next = reorderByIds(section.items, orderedIds)
  if (next) section.items = next
}
