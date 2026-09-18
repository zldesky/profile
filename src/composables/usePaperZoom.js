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
  /** 窗口变化节流后的计数值，供调用方 watch */
  const resizeTick = shallowRef(0)

  /** 按可用宽度换算出不超过 100% 的缩放比 */
  function fit() {
    const el = toValue(stageRef)
    if (!el) return
    const available = el.clientWidth - 56
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

  onMounted(() => window.addEventListener('resize', handleResize))
  onBeforeUnmount(() => handleResize.cancel())

  return { zoom, autoFit, resizeTick, fit, zoomBy, resetFit }
}
