/**
 * 纸面框选与多选拖拽的纯逻辑，与 DOM 解耦，可在 Node 环境下直接单测。
 *
 * 术语约定：
 *  - rect 均为 { left, top, right, bottom }；
 *  - 「容器」指模块在模板里所在的栏：单栏模板只有 main，
 *    sidebar / twocol 会把模块按类型拆进两栏，整组拖拽只重排同一栏内的模块。
 */

/** 两矩形是否相交，贴边视为相交（框选时擦边即可命中） */
export function rectsIntersect(a, b) {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
}

/**
 * 从候选里挑出与选框相交的 id，保持候选顺序。
 * @param {{ id: string, rect: object }[]} boxes 各模块的边界框
 * @param {object} band 框选矩形
 * @returns {string[]}
 */
export function pickIdsInRect(boxes, band) {
  return boxes.filter((box) => rectsIntersect(box.rect, band)).map((box) => box.id)
}

/**
 * 模块在当前模板下所属的容器列。映射需与各模板的拆栏逻辑保持一致：
 *  - sidebar：键值网格与技能进左栏，其余进正文栏；
 *  - twocol：经历条目进宽栏，其余进窄栏。
 * @param {string} templateId 模板 id
 * @param {string} sectionType 模块类型
 * @returns {'main'|'rail'|'body'|'wide'|'side'}
 */
export function sectionContainerKey(templateId, sectionType) {
  if (templateId === 'sidebar') return ['grid', 'skills'].includes(sectionType) ? 'rail' : 'body'
  if (templateId === 'twocol') return sectionType === 'entries' ? 'wide' : 'side'
  return 'main'
}

/**
 * 把 groupIds 作为整块插回容器成员序列，落点为「第 targetVisibleIndex 个可见成员之前」。
 *
 * 隐藏模块不渲染、没有视觉位置，不占可见序位，但保留其在序列中的相对位置：
 * 插入点对齐到第 k 个可见成员的实际下标，k 越界时夹到 [0, 可见成员数]。
 *
 * @param {string[]} memberIds 容器成员的当前顺序（含隐藏模块）
 * @param {string[]} groupIds 被拖动的整块，必须是 memberIds 的子序列
 * @param {number} targetVisibleIndex 落点：第 k 个可见成员之前
 * @param {Set<string>} visibleSet 可见成员集合
 * @returns {string[]} 新的容器成员顺序；groupIds 为空时返回副本
 */
export function insertGroupAtVisibleIndex(memberIds, groupIds, targetVisibleIndex, visibleSet) {
  const group = memberIds.filter((id) => groupIds.includes(id))
  if (!group.length) return memberIds.slice()

  const rest = memberIds.filter((id) => !groupIds.includes(id))
  const visibleCount = rest.filter((id) => visibleSet.has(id)).length
  const k = Math.max(0, Math.min(targetVisibleIndex, visibleCount))

  // 第 k 个可见成员的下标即插入点；可见成员不足 k 个时追加到末尾
  let anchor = rest.length
  let seen = 0
  for (let i = 0; i < rest.length; i += 1) {
    if (!visibleSet.has(rest[i])) continue
    if (seen === k) {
      anchor = i
      break
    }
    seen += 1
  }

  const next = rest.slice()
  next.splice(anchor, 0, ...group)
  return next
}

/**
 * 把容器成员的新顺序写回完整模块序列：非成员的坑位不动，成员按新顺序依次回填。
 * @param {string[]} fullIds 完整模块顺序（含其它容器的成员与隐藏模块）
 * @param {Set<string>} memberIds 容器成员 id 集合
 * @param {string[]} newMemberOrder memberIds 的一个排列
 * @returns {string[]}
 */
export function applyMemberOrder(fullIds, memberIds, newMemberOrder) {
  const queue = newMemberOrder.slice()
  return fullIds.map((id) => (memberIds.has(id) ? queue.shift() : id))
}
