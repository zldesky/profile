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
 * 依据「被拖块当前的中点」算出它应插入到第几个可见成员之前。
 *
 * **单一判据，不分方向。** 原先按拖动方向分了两套比较：
 * 往下 `groupBottom > mid`、往上 `groupTop < mid`。向上的那套把方向写反了 ——
 * 它把「中线在被拖块上边缘之下」也计入，于是**位于拖动块下方的所有模块
 * 都被算成已越过**。实测把「项目经历」往上拖到最顶，算出的索引是 2
 * （应为 0），松手后它直接掉到了最后一名。用户的描述是「无法拖到原位置上方」，
 * 正是这个方向错误的表现。
 *
 * 改成「统一比较中点」后，向上 / 向下走同一段代码，方向上不可能再写反；
 * 插入点用整块中点、门槛也仍是半个模块高，与成熟库（SortableJS / dnd-kit）
 * 的直觉一致。
 *
 * @param {{ id: string, top: number, bottom: number }[]} others 其它可见成员的矩形（按当前顺序）
 * @param {number} groupTop 被拖块整块的当前顶部（含拖动位移）
 * @param {number} groupBottom 被拖块整块的当前底部（含拖动位移）
 * @returns {number} 落点索引：第几块之前；0 表示插到最前
 */
export function resolveVisibleInsertIndex(others, groupTop, groupBottom) {
  const groupMid = (groupTop + groupBottom) / 2
  let index = 0
  for (const item of others) {
    const mid = (item.top + item.bottom) / 2
    if (mid < groupMid) index += 1
  }
  return index
}

/**
 * 算出拖动中「其它模块各自要位移多少」，模拟重排后的真实位置。
 *
 * 这是让纸面动效与右侧面板（SortableJS）一致的**核心**：
 * 拖走一个模块后，它原来的位置要**被下面的模块补上**，插入点之后才腾出空位。
 *
 * 原先只做了后半句（插入点之后下移），前半句没做 —— 于是被拖块的原位置
 * 留着一个空洞，下面的模块不会补上来。用户看到的是「拖走一个，底下不动」，
 * 与右侧面板那种"整列跟着流动"的手感完全不同。
 *
 * 正确语义 = 模拟「把整块从原位置摘掉、再插到 targetIndex」之后的相对位移：
 *  - 被拖块**原位置之后、插入点之前**的模块 → 整体**上移**一个块高（补空洞）；
 *  - 插入点**及之后**的模块 → 整体**下移**一个块高（腾空位）；
 *  - 其余不动。
 *
 * @param {string[]} others 其它可见成员 id，按当前视觉顺序
 * @param {number} originIndex 被拖块在 others 中的「原位置」序号：
 *        即它原来排在第几个 other 之前（等于它原来的可见索引，扣掉自身）
 * @param {number} targetIndex 插入点：插到第几个 other 之前
 * @returns {Record<string, -1|0|1>} 每个 id 的位移方向：-1 上移、1 下移、0 不动
 */
export function resolveShiftDirections(others, originIndex, targetIndex) {
  /** @type {Record<string, -1|0|1>} */
  const dirs = {}
  const from = Math.max(0, Math.min(originIndex, others.length))
  const to = Math.max(0, Math.min(targetIndex, others.length))

  others.forEach((id, index) => {
    if (from < to) {
      // 往下拖：原位置之后、插入点之前的补上来（−1）；插入点及之后的让位下移（+1）
      if (index >= from && index < to) dirs[id] = -1
      else if (index >= to) dirs[id] = 1
      else dirs[id] = 0
    } else if (to < from) {
      // 往上拖：插入点到原位置之间的让位下移（+1）；其余不动
      // （原位置之后的模块，上方总高度没变，所以视觉上不动）
      dirs[id] = index >= to && index < from ? 1 : 0
    } else {
      dirs[id] = 0
    }
  })
  return dirs
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
