import { onBeforeUnmount, onMounted, shallowRef, toValue } from 'vue'

import { MM_TO_PX, PAGE } from '@/data/presets'
import { debounce } from '@/utils/helpers'

/** A4 宽度在 96dpi 下的像素值 */
const A4_WIDTH_PX = PAGE.width * MM_TO_PX

/**
 * 预览缩放：自适应窗口、手动加减、恢复自适应。
 *
 * 窗口尺寸变化以 resizeTick 暴露，调用方 watch 它即可触发重新测量，
 * 避免缩放与测量两个 composable 互相依赖。
 *
 * @param {import('vue').Ref<HTMLElement|null>|Function} stageRef 滚动容器
 */
export function usePaperZoom(stageRef) {
  const zoom = shallowRef(1)
  const autoFit = shallowRef(true)
  /** 容器尺寸变化节流后的计数值，供调用方 watch */
  const resizeTick = shallowRef(0)

  /**
   * 按可用宽度换算出不超过 100% 的缩放比。
   * 内边距随断点变化，直接读实际值而不是写死，否则窄屏会多扣一次留白。
   */
  function fit() {
    const el = toValue(stageRef)
    if (!el) return

    const style = getComputedStyle(el)
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const available = el.clientWidth - padding

    zoom.value = Math.max(0.3, Math.min(1, Math.round((available / A4_WIDTH_PX) * 100) / 100))
  }

  function zoomBy(step) {
    autoFit.value = false
    zoom.value = Math.max(0.3, Math.min(1.6, Math.round((zoom.value + step) * 100) / 100))
  }

  function resetFit() {
    autoFit.value = true
    fit()
  }

  const handleResize = debounce(() => {
    if (autoFit.value) fit()
    resizeTick.value += 1
  }, 120)

  /**
   * 观察容器自身尺寸，而不只是窗口。
   *
   * 隐藏/显示编辑面板、窄屏在两栏之间切换，都不会触发 window.resize，
   * 但预览可用宽度已经变了，只靠窗口事件会让缩放停在旧值上。
   * 容器被 v-show 隐藏时宽度变为 0、重新显示时又变回原值，这两种变化
   * 同样会触发这里，调用方借此重新测量页数与头像边界。
   */
  let observedWidth = -1
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          const width = Math.round(entries[0].contentRect.width)
          // 宽度没变就不重算：滚动条出现/消失会让宽度轻微变化，否则会来回抖动
          if (width === observedWidth) return
          observedWidth = width
          if (autoFit.value) fit()
          resizeTick.value += 1
        })
      : null

  onMounted(() => {
    window.addEventListener('resize', handleResize)

    const el = toValue(stageRef)
    if (el && observer) {
      observedWidth = Math.round(el.clientWidth)
      observer.observe(el)
    }
  })

  onBeforeUnmount(() => {
    handleResize.cancel()
    // 只 cancel 防抖而不摘监听会留下悬挂的 window 监听器
    window.removeEventListener('resize', handleResize)
    observer?.disconnect()
  })

  return { zoom, autoFit, resizeTick, fit, zoomBy, resetFit }
}
