import { toValue } from 'vue'
import type { Ref } from 'vue'

import { useResumeStore } from '@/stores/resume'
import { useFieldSelectionStore } from '@/stores/fieldSelection'
import { clampAxis, getFieldLayout, ZERO_FIELD_LAYOUT } from '@/utils/fieldLayout'
import { FIELD_LABELS } from '@/composables/useInlineEdit'
import type { FieldLayout } from '@/types/resume'

/** 位移超过该阈值才算「拖动」，否则算单击（点选字段），避免手抖把字段挪歪（屏幕 px） */
const DRAG_THRESHOLD = 3

/**
 * 字段直接拖拽微调（drawio 手感）。
 *
 * 按住一个字段拖动，元素实时跟手；松手把「水平和垂直位移」落成该字段的间距：
 *  - 水平位移 → 左缩进 indent（往右拖 = 左缩进增大，文字右移）；
 *  - 垂直位移 → 上方间距 extraGap（往下拖 = 上方间距增大，整体下移）。
 *
 * 为什么不用 WASD：键盘调位置和「抓住一块东西拖」的直觉差太远，而且方向键/WASD
 * 在中文输入与浏览器滚动下经常被吃掉。鼠标直接拖拽所见即所得，和 drawio 一致。
 *
 * 与模块整组拖拽的分工：按在**带 data-field-key 的元素**上时由本模块接管，
 * 并告知调用方不要再进入模块拖拽（否则整个模块会被拖走）。按在板块其它地方
 * 仍走原来的整组拖拽 / 框选。
 *
 * 拖动过程只改元素的 transform（纯视觉），松手才写 store：这样撤销/重做把
 * 一次拖动记成一笔，且拖动途中不会因数据频繁变更触发重排。
 *
 * @param {import('vue').Ref<HTMLElement|null>} paperRef 纸张元素
 * @param {import('vue').Ref<number>} zoom 当前缩放比
 */
export function useFieldDrag(paperRef: Ref<HTMLElement | null>, zoom: Ref<number>) {
  const resumeStore = useResumeStore()
  const fieldSelection = useFieldSelectionStore()

  const scale = () => toValue(zoom) || 1

  /**
   * 按下纸面。命中字段则接管并返回 true（调用方据此跳过模块拖拽），否则返回 false。
   */
  function onFieldPointerDown(event: PointerEvent): boolean {
    if (event.button !== 0) return false
    if (event.pointerType === 'touch') {
      // 触屏轻点即选中，靠原生滚动；不在这里启用拖拽，避免抢走滚动
      return false
    }
    const target = event.target
    if (!(target instanceof Element)) return false
    const el = target.closest<HTMLElement>('[data-field-key]')
    if (!el) return false

    const sectionEl = el.closest<HTMLElement>('[data-sec-id]')
    const sectionId = sectionEl?.dataset.secId || ''
    const fieldKey = el.dataset.fieldKey || ''
    const field = el.dataset.field || ''
    if (!sectionId || !fieldKey) return false

    // 按下即选中该字段（高亮 + 浮条），单击不拖时也能停留在「选中」状态
    fieldSelection.select({
      sectionId,
      fieldKey,
      field,
      label: FIELD_LABELS[field] || '字段',
    })

    /*
     * 阻止从纸面发起的原生文字选择：拖动时整片文字被反选既难看，
     * 也会让 mouseup 落在别的文本节点上。纸张内没有可聚焦控件，无副作用。
     */
    event.preventDefault()

    const paper = toValue(paperRef)
    if (!paper) return true

    const startX = event.clientX
    const startY = event.clientY
    const section = resumeStore.sections.find((s) => s.id === sectionId)
    const base: FieldLayout = section ? getFieldLayout(section, fieldKey) : { ...ZERO_FIELD_LAYOUT }

    let active = false
    let lastDx = 0
    let lastDy = 0

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        active = true
        el.classList.add('is-field-dragging')
        paper.setPointerCapture?.(event.pointerId)
      }
      lastDx = dx
      lastDy = dy
      // 元素跟手（除以缩放，换算回 CSS px）
      el.style.transform = `translate(${dx / scale()}px, ${dy / scale()}px)`
    }

    const finish = (upEvent: PointerEvent) => {
      paper.removeEventListener('pointermove', onMove)
      paper.removeEventListener('pointerup', finish)
      paper.removeEventListener('pointercancel', finish)
      if (paper.hasPointerCapture?.(event.pointerId)) {
        paper.releasePointerCapture(event.pointerId)
      }
      el.classList.remove('is-field-dragging')
      el.style.transform = ''
      if (!active || upEvent?.type === 'pointercancel') return

      // 屏幕位移 / 缩放 = CSS px；水平并入左缩进、垂直并入上方间距
      const cssDx = Math.round(lastDx / scale())
      const cssDy = Math.round(lastDy / scale())
      if (!cssDx && !cssDy) return

      const nextIndent = clampAxis(field, 'indent', base.indent + cssDx)
      const nextGap = clampAxis(field, 'extraGap', base.extraGap + cssDy)
      const patch: Partial<FieldLayout> = {}
      if (nextIndent !== base.indent) patch.indent = nextIndent
      if (nextGap !== base.extraGap) patch.extraGap = nextGap
      if (Object.keys(patch).length) {
        resumeStore.updateFieldLayout(sectionId, fieldKey, patch)
      }
    }

    paper.addEventListener('pointermove', onMove)
    paper.addEventListener('pointerup', finish)
    paper.addEventListener('pointercancel', finish)
    return true
  }

  return { onFieldPointerDown }
}
