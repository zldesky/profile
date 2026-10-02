import { nextTick, onBeforeUnmount, onMounted, shallowRef, toValue } from 'vue'

import { useResumeStore } from '@/stores/resume'
import { useSelectionStore } from '@/stores/selection'
import {
  applyMemberOrder,
  insertGroupAtVisibleIndex,
  pickIdsInRect,
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
  const bandRect = shallowRef(null)
  /** 是否正在整组拖拽 */
  const secDragging = shallowRef(false)
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
    paper.setPointerCapture(event.pointerId)

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

    const paper = toValue(paperRef)
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
  }

  function clearDragTransforms(press) {
    for (const el of press.els.values()) el.style.transform = ''
  }

  function finalizeDrag(press) {
    interaction = null
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
    const groupCenterY = (top + bottom) / 2 + press.dyScreen

    const targetIndex = memberIds.reduce((count, id) => {
      if (groupIds.includes(id) || !visibleSet.has(id)) return count
      const rect = press.rects.get(id)
      if (!rect) return count
      return count + ((rect.top + rect.bottom) / 2 < groupCenterY ? 1 : 0)
    }, 0)

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

  return { bandRect, secDragging, toolbarAnchor, onPaperPointerDown, syncToolbar }
}
