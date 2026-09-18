import { nextTick, shallowRef, toValue } from 'vue'

import { MM_TO_PX, PAGE } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

/**
 * 纸张页数估算。
 *
 * getBoundingClientRect 返回缩放后的视觉尺寸，需除以缩放比还原为布局尺寸；
 * 页面可用高度等于 A4 高度减去上下留白。
 *
 * @param {import('vue').Ref<HTMLElement|null>|Function} paperRef 纸张元素
 * @param {import('vue').Ref<number>|Function} zoom 当前缩放比
 */
export function usePageMetrics(paperRef, zoom) {
  const store = useResumeStore()
  const pageCount = shallowRef(1)

  /** 连续变更时只保留最后一次测量，避免反复强制同步布局 */
  let token = 0

  function measure() {
    const el = toValue(paperRef)
    if (!el) return 1

    const layoutHeight = el.getBoundingClientRect().height / (toValue(zoom) || 1)
    const verticalPadding = store.theme.mv * MM_TO_PX * 2
    const usableHeight = PAGE.height * MM_TO_PX - verticalPadding
    if (usableHeight <= 0) return 1

    // 减去极小量，避免恰好一页时因浮点误差被判成两页
    return Math.max(1, Math.ceil((layoutHeight - verticalPadding) / usableHeight - 0.001))
  }

  /** 等 DOM 更新后再测量；若期间又触发了新的刷新，本次结果直接丢弃 */
  async function refresh() {
    const current = ++token
    await nextTick()
    if (current !== token) return
    pageCount.value = measure()
  }

  return { pageCount, measure, refresh }
}
