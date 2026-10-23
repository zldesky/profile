import { nextTick, onBeforeUnmount, onMounted, shallowRef, toValue } from 'vue'

import { useResumeStore } from '@/stores/resume'
import { useSelectionStore } from '@/stores/selection'
import {
  applyMemberOrder,
  insertGroupAtVisibleIndex,
  pickIdsInRect,
  resolveShiftDirections,
  resolveVisibleInsertIndex,
  sectionContainerKey,
} from '@/utils/selection'

/** 位移超过该阈值才算拖拽 / 框选，原地单击不会误触发（px） */
const DRAG_THRESHOLD = 4
/** 悬浮工具条与选中区上缘的间距及其自身高度估值（px） */
const TOOLBAR_GAP = 8
const TOOLBAR_HEIGHT = 36
/** 工具条按中心点定位时的半宽估值，用于夹住左右边缘（px） */
const TOOLBAR_HALF_WIDTH = 170
const VIEWPORT_EDGE = 8

/**
 * 纸面模块的框选、多选与整组拖拽排序。
 *
 * 交互约定：
 *  - 空白处按下拖动 = 框选，松手时与选框相交的模块整体选中，空白单击 = 清空选择；
 *  - 单击模块 = 只选它；Ctrl/Cmd + 单击 = 加选 / 去选；Esc = 取消选择；
 *  - 按住已选中的模块竖向拖动 = 整组移动，松手后按落点重排数组；
 *  - 触屏只保留轻点选中，框选与拖拽让位给原生滚动。
 *
 * 拖拽过程只做视觉位移（transform），松手才改数据，撤销/重做天然把一次拖拽记为一笔。
 * sidebar / twocol 模板把模块拆进两栏，整组拖拽只在按住模块所在的栏内重排。
 *
 * @param {import('vue').Ref<HTMLElement|null>} paperRef 纸张元素
 * @param {import('vue').Ref<HTMLElement|null>} scrollRef 预览滚动容器
 * @param {import('vue').Ref<number>} zoom 当前缩放比
 */
export function usePaperSelection(paperRef, scrollRef, zoom) {
  const resumeStore = useResumeStore()
  const selection = useSelectionStore()

  /** 框选矩形的视口坐标，渲染选框 overlay 用 */
  /**
   * 框选矩形（视口坐标，相对舞台滚动容器）。
   * 用 JSDoc 标注：`shallowRef(null)` 在 TS 下会推成 `Ref<null>`，
   * 调用方读 `.value.left` 就被收窄成 `never`。标注后调用方拿到真类型，
   * 而本文件仍保持 JS（见文件顶部说明）。
   * @type {import('vue').ShallowRef<{ left: number, top: number, right: number, bottom: number } | null>}
   */
  const bandRect = shallowRef(null)
  /** 是否正在整组拖拽 */
  const secDragging = shallowRef(false)
  /**
   * 落点指示线的位置（视口坐标 { top, left, width }）。
   *
   * 为什么需要它：拖拽门槛即使降到半个模块高，用户仍然只能靠"猜"——
   * 模块跟着手在动，但**看不出松手会插到哪里**。没有这条线时，
   * 「拖了没换位」与「拖了但没拖够」在视觉上是同一件事，用户就会觉得"拖不动"。
   * 有了它，松手之前就能看到结果。
   *
   * @type {import('vue').ShallowRef<{ top: number, left: number, width: number } | null>}
   */
  const dropLine = shallowRef(null)
  /** 悬浮工具条的视口坐标 { left, top }，null 表示隐藏 */
  const toolbarAnchor = shallowRef(null)

  /** 当前指针交互 { type: 'band' | 'drag', ... }，pointerup 时收尾 */
  let interaction = null

  const scale = () => toValue(zoom) || 1

  const containerKeyOf = (section) =>
    sectionContainerKey(resumeStore.resume.template, section?.type)

  function findSectionEl(id) {
    return toValue(paperRef)?.querySelector(`.r-sec[data-sec-id="${CSS.escape(id)}"]`) || null
  }

  /** 收集纸上全部模块的视口边界框，供框选命中测试 */
  function collectSectionRects() {
    const paper = toValue(paperRef)
    if (!paper) return []
    return Array.from(paper.querySelectorAll('.r-sec[data-sec-id]')).map((el) => {
      const rect = el.getBoundingClientRect()
      return {
        id: el.dataset.secId,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      }
    })
  }

  /* ---------------- 指针交互 ---------------- */

  function onPaperPointerDown(event) {
    if (event.button !== 0) return
    if (event.target.closest?.('.r-avatar')) return // 头像有自己的拖拽逻辑

    const paper = toValue(paperRef)
    if (!paper) return

    const secEl = event.target.closest?.('.r-sec[data-sec-id]')

    /*
     * 页头字段（姓名 / 职位 / 联系方式）**不在任何 .r-sec 里** ——
     * 实测祖先链是 `p.r-job → div.who → header.head → div.tpl-classic → .paper`。
     * 它们既没有模块可选中、也没有东西可拖动，所以这里直接交还给就地编辑；
     * 若放行到 startBand，那会 `preventDefault()` + `setPointerCapture()`，
     * 把后续的 click 吃掉，「点页头文字就地修改」就失效了。
     */
    if (!secEl && event.target.closest?.('[data-field]')) return

    /*
     * 按在**模块文字**上时不再早退，而是照常进入 pressSection。
     *
     * 早先版本在这里对 `[data-field]` 一律早退 —— 那是为了修就地编辑失效，
     * 但当时真正的元凶是 pressSection 里的 `paper.setPointerCapture()`：
     * 指针被 paper 捕获后 click 的目标被重定向，onPaperClick 收不到。
     * 捕获已经推迟到**拖拽真正激活时**（见 activateDrag），
     * 所以现在点击能正常落到文字上，两个行为可以共存：
     *
     *   - 按下不动 → click → 就地编辑（openInlineEdit 优先）
     *   - 按下并移动超过阈值 → 整组拖拽换序
     *
     * 这正是「选中文字后拖拽位置」想要的：文字既是编辑入口，也是拖动把手。
     */
    if (secEl) pressSection(event, secEl, paper)
    else startBand(event, paper)
  }

  /**
   * 按在模块上：先落选中，再视位移决定是否进入整组拖拽。
   */
  function pressSection(event, secEl, paper) {
    const id = secEl.dataset.secId

    if (event.pointerType === 'touch') {
      // 触屏不抢占滚动：轻点命中未选中的只选它，已选中的保持整组
      if (!selection.has(id)) selection.replace([id])
      return
    }

    // 阻止从纸面发起的原生文字选择；纸张内没有可聚焦控件，无副作用
    event.preventDefault()

    if (event.ctrlKey || event.metaKey) {
      // 加选 / 去选不进入拖拽，避免按住 Ctrl 观察时误拖整组
      selection.toggle(id)
      return
    }

    if (!selection.has(id)) selection.replace([id])

    const section = resumeStore.sections.find((s) => s.id === id)
    if (!section) return

    const press = {
      type: 'drag',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      /** 累计纵向位移（视口 px），横向位移在流式布局里没有意义，忽略 */
      dyScreen: 0,
      active: false,
      cancelled: false,
      grabbedId: id,
      containerKey: containerKeyOf(section),
      /** groupId -> 元素；只含与按住模块同容器的选中模块 */
      els: new Map(),
      /** 拖拽激活瞬间全部模块的纵向边界（视口 px），滚动后不再更新，保证落点计算自洽 */
      rects: new Map(),
    }
    interaction = press

    /*
     * 捕获指针**推迟到拖拽真正激活时**（见 activateDrag），不在这里做。
     *
     * 原来在 pointerdown 就无条件 `paper.setPointerCapture(...)`，而拖拽要等
     * 位移超过 DRAG_THRESHOLD 才开始 —— 于是「按一下模块上的文字」这种最常见操作
     * 也会被捕获：指针被 paper 抓住后，后续 click 的事件目标被重定向到 paper 本身，
     * PreviewPane 的 `onPaperClick` 拿到的 target 不再是那个 [data-field] 元素，
     * **「点文字就地编辑」整个失效**（实测：真实鼠标点击无浮层，而直接给元素派发
     * click 却能正常弹出，差别就在这行捕获）。
     *
     * 这段代码写在就地编辑之前，两者从未一起验证过。
     * 捕获推迟后：左键单击不再抢指针（就地编辑恢复），一旦真的拖动起来会补上捕获，
     * 拖出纸面也不丢事件 —— stopPress 里的释放本来就带 hasPointerCapture 判断，
     * 没捕获过时是无操作，所以推迟是安全的。
     */

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== press.pointerId) return
      const dx = moveEvent.clientX - press.startX
      const dy = moveEvent.clientY - press.startY
      if (!press.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        activateDrag(press)
      }
      press.dyScreen = dy
      applyDragTransforms(press)
    }

    const onUp = (upEvent) => {
      if (upEvent.pointerId !== press.pointerId) return
      stopPress(paper, press.pointerId, onMove, onUp, onKey)
      if (upEvent.type === 'pointercancel') press.cancelled = true
      finalizeDrag(press)
    }

    const onKey = (keyEvent) => {
      if (keyEvent.key !== 'Escape') return
      stopPress(paper, press.pointerId, onMove, onUp, onKey)
      press.cancelled = true
      finalizeDrag(press)
    }

    paper.addEventListener('pointermove', onMove)
    paper.addEventListener('pointerup', onUp)
    paper.addEventListener('pointercancel', onUp)
    document.addEventListener('keydown', onKey)
  }

  function stopPress(paper, pointerId, onMove, onUp, onKey) {
    paper.removeEventListener('pointermove', onMove)
    paper.removeEventListener('pointerup', onUp)
    paper.removeEventListener('pointercancel', onUp)
    document.removeEventListener('keydown', onKey)
    if (paper.hasPointerCapture?.(pointerId)) paper.releasePointerCapture(pointerId)
  }

  /** 拖拽激活：记录此刻全部模块的基础位置，并圈出与按住模块同容器的整组成员 */
  function activateDrag(press) {
    press.active = true
    secDragging.value = true
    toolbarAnchor.value = null

    /*
     * 到这里才真正是拖拽，此时再捕获指针。
     * 放在 pointerdown 会让「按一下」也被捕获，从而吃掉后续 click 的目标元素
     * （详见 pressSection 里的说明）。
     */
    const paper = toValue(paperRef)
    if (paper && !paper.hasPointerCapture?.(press.pointerId)) {
      paper.setPointerCapture?.(press.pointerId)
    }
    for (const el of paper?.querySelectorAll('.r-sec[data-sec-id]') || []) {
      const id = el.dataset.secId
      const rect = el.getBoundingClientRect()
      press.rects.set(id, { top: rect.top, bottom: rect.bottom })
      const section = resumeStore.sections.find((s) => s.id === id)
      if (section && selection.has(id) && containerKeyOf(section) === press.containerKey) {
        press.els.set(id, el)
      }
    }
  }

  function applyDragTransforms(press) {
    const cssDy = press.dyScreen / scale()
    for (const el of press.els.values()) {
      el.style.transform = cssDy ? `translateY(${cssDy}px)` : ''
    }
    const resolved = resolveDropTarget(press)
    syncDropLine(press, resolved)
    applyDropShift(press, resolved)
  }

  /**
   * 解析当前落点：把「会插到哪个位置」算成一份数据，供**指示线**与**让位**共用。
   *
   * 两处各算一套判据的话，线画在一个地方、松手却落在另一个地方 —— 那比没有还糟。
   */
  function resolveDropTarget(press) {
    if (!press.active) return null
    const paper = toValue(paperRef)
    if (!paper) return null

    const sections = resumeStore.sections
    const byId = new Map(sections.map((s) => [s.id, s]))
    const memberIds = sections
      .map((s) => s.id)
      .filter((id) => containerKeyOf(byId.get(id)) === press.containerKey)
    const groupIds = memberIds.filter((id) => selection.has(id))
    if (!groupIds.length) return null

    let top = Infinity
    let bottom = -Infinity
    for (const id of groupIds) {
      const rect = press.rects.get(id)
      if (!rect) continue
      top = Math.min(top, rect.top)
      bottom = Math.max(bottom, rect.bottom)
    }
    if (top === Infinity) return null

    const visibleSet = new Set(memberIds.filter((id) => byId.get(id)?.visible))
    const groupTop = top + press.dyScreen
    const groupBottom = bottom + press.dyScreen

    /*
     * 落点用统一的「中点比较」算出（见 resolveVisibleInsertIndex 的说明）：
     * 原先按方向分两套判据，向上的那套写反了，会把下方模块全算成已越过。
     */
    const others = memberIds.filter((id) => !groupIds.includes(id) && visibleSet.has(id))
    const rectsOfOthers = others
      .map((id) => ({ id, rect: press.rects.get(id) }))
      .filter((item) => item.rect)
      .map((item) => ({ id: item.id, top: item.rect.top, bottom: item.rect.bottom }))
    const targetIndex = resolveVisibleInsertIndex(rectsOfOthers, groupTop, groupBottom)

    /*
     * originIndex = 被拖块**原本**排在第几个 other 之前，也就是「第一个被拖成员之前
     * 有几个可见的其它成员」。这是「补空洞」的基准：有了它才能分出哪些模块该上移、
     * 哪些该下移。必须按原顺序（memberIds）数，不能按当前视觉顺序 ——
     * 后者会随拖动过程变化，导致位移来回抖动。
     */
    const firstGroupPos = memberIds.findIndex((id) => groupIds.includes(id))
    const originIndex = memberIds
      .slice(0, Math.max(0, firstGroupPos))
      .filter((id) => !groupIds.includes(id) && visibleSet.has(id)).length

    return {
      memberIds,
      groupIds,
      others,
      originIndex,
      targetIndex,
      visibleSet,
      groupHeight: bottom - top,
    }
  }

  /**
   * 实时让位：模拟「把整块摘走、再插到落点」之后每个模块的真实位置。
   *
   * 与右侧面板（SortableJS）的动效保持一致 —— 拖走一个模块后，
   * **它原来的位置要被下面的模块补上**，插入点之后才腾出空位。
   *
   * 原先只做了后半句（插入点之后整体下移），前半句没做，于是被拖块的
   * 原位置留着一个空洞、下面的模块不补上来。用户看到的是「拖走一个、底下不动」，
   * 与右侧那种整列跟着流动的手感完全不同。
   *
   * 位移方向由 resolveShiftDirections 统一算出（纯函数，有单测），
   * 这里只负责把方向 × 一个块高换算成像素并写到 transform。
   * 距离用**被拖块自己的高度 + 与相邻块的间距**，因此不同高度的模块也能对上。
   */
  function applyDropShift(press, resolved) {
    if (!resolved) return
    const { others, originIndex, targetIndex, groupHeight } = resolved

    const gap = 8
    const step = (groupHeight + gap) / scale()
    const dirs = resolveShiftDirections(others, originIndex, targetIndex)

    for (const id of others) {
      const el = findSectionEl(id)
      if (!el) continue
      const dir = dirs[id] ?? 0
      el.style.transform = dir ? `translateY(${dir * step}px)` : ''
    }
  }

  /**
   * 把「松手会插到哪里」画成一条横线。
   *
   * 位置取插入点相邻那个模块的上边缘（插到末尾时取最后一个模块的下边缘），
   * 与 computeReorder 用的是**同一套判据**，所以线在哪、松手就落在哪。
   * 不这么做的话，指示线与实际结果各算一套，比没有还糟。
   */
  function syncDropLine(press, resolved) {
    if (!resolved) {
      dropLine.value = null
      return
    }
    const { others, targetIndex } = resolved

    // 插入点：第 targetIndex 个"其余可见模块"的上边缘；越界则取最后一个的下边缘
    let lineY = null
    let refEl = null
    if (targetIndex < others.length) {
      const nextId = others[targetIndex]
      const rect = press.rects.get(nextId)
      if (rect) {
        lineY = rect.top
        refEl = findSectionEl(nextId)
      }
    } else if (others.length) {
      const lastId = others[others.length - 1]
      const rect = press.rects.get(lastId)
      if (rect) {
        lineY = rect.bottom
        refEl = findSectionEl(lastId)
      }
    }

    if (lineY === null || !refEl) {
      dropLine.value = null
      return
    }

    const box = refEl.getBoundingClientRect()
    dropLine.value = { top: lineY, left: box.left, width: box.width }
  }

  function clearDragTransforms(press) {
    // 除了被拖的模块，让位时还动过**其他**模块，必须一并复位，
    // 否则松手后会有一批模块停在偏移位置上（看起来像排版坏了）
    for (const el of press.els.values()) el.style.transform = ''
    const paper = toValue(paperRef)
    for (const el of paper?.querySelectorAll('.r-sec[data-sec-id]') || []) {
      if (!press.els.has(el.dataset.secId)) el.style.transform = ''
    }
  }

  function finalizeDrag(press) {
    interaction = null
    dropLine.value = null
    if (!press.active) {
      // 原地单击：pointerdown 时的选中变化会被「交互中」挂起工具条，松手后补一次定位
      nextTick(syncToolbar)
      return
    }

    const order = computeReorder(press)
    clearDragTransforms(press)
    secDragging.value = false

    if (order) resumeStore.reorderSectionsByIds(order)
    // 重排引发的 DOM 变化稳定后，再把工具条贴回新的选中区
    nextTick(syncToolbar)
  }

  /**
   * 依据落点计算重排后的完整模块顺序；无需移动时返回 null。
   * 落点 = 拖动整块的最终视觉中心越过了几个其余可见成员的纵向中点。
   */
  function computeReorder(press) {
    if (press.cancelled || !press.dyScreen) return null

    const sections = resumeStore.sections
    const byId = new Map(sections.map((s) => [s.id, s]))
    const fullIds = sections.map((s) => s.id)
    const memberIds = fullIds.filter((id) => containerKeyOf(byId.get(id)) === press.containerKey)
    const groupIds = fullIds.filter(
      (id) => selection.has(id) && containerKeyOf(byId.get(id)) === press.containerKey,
    )

    // 整块占满容器时重排无意义
    if (!groupIds.length || groupIds.length === memberIds.length) return null

    const visibleSet = new Set(memberIds.filter((id) => byId.get(id)?.visible))

    let top = Infinity
    let bottom = -Infinity
    for (const id of groupIds) {
      const rect = press.rects.get(id)
      if (!rect) continue
      top = Math.min(top, rect.top)
      bottom = Math.max(bottom, rect.bottom)
    }
    if (top === Infinity) return null

    /*
     * 落点判据：**统一比较中点**，不再按拖动方向分两套。
     *
     * 原先往下用 `groupBottom > mid`、往上用 `groupTop < mid`。
     * 向下那套是对的；向上那套把方向写反了 —— 它把「中线在被拖块上边缘之下」
     * 也算作「已越过」，而拖动块下方的所有模块都满足这个条件，
     * 于是往上拖会算出过大的索引：实测把「项目经历」拖到最顶，索引算出 2
     * （应为 0），松手后它掉到了最后一名。用户说的「无法拖到原位置上方」就是它。
     *
     * 现在两处（指示线 + 实际落点）都走 resolveVisibleInsertIndex，
     * 同一个函数、同一个判据，不可能再出现「线在一处、落在另一处」。
     */
    const groupTop = top + press.dyScreen
    const groupBottom = bottom + press.dyScreen

    const others = memberIds.filter((id) => !groupIds.includes(id) && visibleSet.has(id))
    const rectsOfOthers = others
      .map((id) => ({ id, rect: press.rects.get(id) }))
      .filter((item) => item.rect)
      .map((item) => ({ id: item.id, top: item.rect.top, bottom: item.rect.bottom }))

    const targetIndex = resolveVisibleInsertIndex(rectsOfOthers, groupTop, groupBottom)

    const newMemberOrder = insertGroupAtVisibleIndex(memberIds, groupIds, targetIndex, visibleSet)
    if (newMemberOrder.every((id, index) => id === memberIds[index])) return null

    return applyMemberOrder(fullIds, new Set(memberIds), newMemberOrder)
  }

  /* ---------------- 框选 ---------------- */

  function startBand(event, paper) {
    if (event.pointerType === 'touch') return // 触屏拖空白 = 滚动

    const band = {
      type: 'band',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    }
    interaction = band
    event.preventDefault()
    paper.setPointerCapture(event.pointerId)

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== band.pointerId) return
      band.currentX = moveEvent.clientX
      band.currentY = moveEvent.clientY
      syncBandRect(band)
    }

    const onUp = (upEvent) => {
      if (upEvent.pointerId !== band.pointerId) return
      stopBand(paper, band.pointerId, onMove, onUp)
      interaction = null
      const rect = bandRect.value
      bandRect.value = null
      if (upEvent.type === 'pointercancel') return

      if (
        !rect ||
        rect.right - rect.left < DRAG_THRESHOLD ||
        rect.bottom - rect.top < DRAG_THRESHOLD
      ) {
        // 原地单击空白：清空选择
        selection.clear()
        return
      }
      selection.replace(pickIdsInRect(collectSectionRects(), rect))
      nextTick(syncToolbar)
    }

    paper.addEventListener('pointermove', onMove)
    paper.addEventListener('pointerup', onUp)
    paper.addEventListener('pointercancel', onUp)
  }

  function stopBand(paper, pointerId, onMove, onUp) {
    paper.removeEventListener('pointermove', onMove)
    paper.removeEventListener('pointerup', onUp)
    paper.removeEventListener('pointercancel', onUp)
    if (paper.hasPointerCapture?.(pointerId)) paper.releasePointerCapture(pointerId)
  }

  /**
   * 框选矩形以滚动内容为基准计算，拖动途中滚动页面时选框跟随内容；
   * 渲染 overlay 与命中测试统一使用视口坐标。
   */
  function syncBandRect(band) {
    const scrollEl = toValue(scrollRef)
    if (!scrollEl) return
    const box = scrollEl.getBoundingClientRect()
    const toContentX = (x) => x - box.left + scrollEl.scrollLeft
    const toContentY = (y) => y - box.top + scrollEl.scrollTop

    const left = Math.min(toContentX(band.startX), toContentX(band.currentX))
    const right = Math.max(toContentX(band.startX), toContentX(band.currentX))
    const top = Math.min(toContentY(band.startY), toContentY(band.currentY))
    const bottom = Math.max(toContentY(band.startY), toContentY(band.currentY))

    bandRect.value = {
      left: left - scrollEl.scrollLeft + box.left,
      right: right - scrollEl.scrollLeft + box.left,
      top: top - scrollEl.scrollTop + box.top,
      bottom: bottom - scrollEl.scrollTop + box.top,
    }
  }

  /* ---------------- 悬浮工具条定位 ---------------- */

  /**
   * 依据当前选中集重算工具条位置：水平居中于选中区的几何中心并夹住视口边缘，
   * 默认悬在选中区上方，顶部放不下时落到下方。无选中或交互中则隐藏。
   */
  function syncToolbar() {
    if (interaction || !selection.count) {
      toolbarAnchor.value = null
      return
    }

    let top = Infinity
    let bottom = -Infinity
    let centerX = 0
    let found = 0
    for (const id of selection.ids) {
      const el = findSectionEl(id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (!rect.width && !rect.height) continue
      top = Math.min(top, rect.top)
      bottom = Math.max(bottom, rect.bottom)
      centerX += rect.left + rect.width / 2
      found += 1
    }
    if (!found) {
      toolbarAnchor.value = null
      return
    }

    centerX /= found
    const left = Math.min(
      Math.max(centerX, TOOLBAR_HALF_WIDTH + VIEWPORT_EDGE),
      window.innerWidth - TOOLBAR_HALF_WIDTH - VIEWPORT_EDGE,
    )
    let anchorTop = top - TOOLBAR_HEIGHT - TOOLBAR_GAP
    if (anchorTop < VIEWPORT_EDGE) anchorTop = bottom + TOOLBAR_GAP
    toolbarAnchor.value = { left, top: anchorTop }
  }

  /* ---------------- 全局监听 ---------------- */

  const onScroll = () => {
    if (!interaction) syncToolbar()
  }

  const onGlobalKey = (event) => {
    // 拖拽中的 Esc 由 press 自己的 onKey 处理（取消拖拽）
    if (event.key === 'Escape' && !interaction) selection.clear()
  }

  onMounted(() => {
    toValue(scrollRef)?.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('keydown', onGlobalKey)
  })

  onBeforeUnmount(() => {
    toValue(scrollRef)?.removeEventListener('scroll', onScroll)
    document.removeEventListener('keydown', onGlobalKey)
  })

  return { bandRect, dropLine, secDragging, toolbarAnchor, onPaperPointerDown, syncToolbar }
}
