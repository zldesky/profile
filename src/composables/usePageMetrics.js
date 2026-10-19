import { nextTick, shallowRef, toValue } from 'vue'

import { MM_TO_PX, PAGE } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

/**
 * 纸张页数估算。
 *
 * ── 为什么要「模拟分页」而不是「总高度 ÷ 页高」 ──────────────────────
 *
 * 早先的写法是 `ceil(内容高度 / 可用高度)`，也就是只看总量。
 * 但真实分页不是这么切的：`.r-sec` 带 `break-inside: avoid`
 * （见 styles/paper.css），一个模块在页底剩余空间里放不下时，
 * 会**整块挪到下一页**，于是页底留下一段空白 —— 真实页数因此可能**多于**按总量算的结果。
 *
 * 实测（tools/verify-page-count-agreement.mjs，用真实导出的 PDF 页数对照）：
 * 只看总量时，把经历条目加到 6 条以上，编辑器一直显示 2 页，而导出是 3 页；
 * 加到 14 条时显示 3 页、导出 4 页 —— **稳定少报一页**。
 * 用户看到「编辑器说 2 页、导出 3 页」，会以为导出坏了。
 *
 * 现在的做法与浏览器一致：按**不可分割的块**顺序贪心填充，
 * 放不下就整块挪到下一页。块的粒度与 CSS 一致：
 *  - `.r-sec`（break-inside: avoid）是原子块；
 *  - 页头（第一个模块之前的部分）也是一块；
 *  - 比一页还高的块照旧会跨页（浏览器也只能这么做）——不会被误判成占一页。
 *
 * ── 已知的近似 ────────────────────────────────────────────────────
 *
 * 这仍然是估算：字体的最终度量、浏览器对 `break-*` 的具体实现都可能带来一页之差。
 * 所以断言用的是**与真实产物对照**（见上面那个工具），而不是"公式看起来对"。
 *
 * @param {import('vue').Ref<HTMLElement|null>|Function} paperRef 纸张元素
 * @param {import('vue').Ref<number>|Function} zoom 当前缩放比
 */
export function usePageMetrics(paperRef, zoom) {
  const store = useResumeStore()
  const pageCount = shallowRef(1)

  /** 连续变更时只保留最后一次测量，避免反复强制同步布局 */
  let token = 0

  /**
   * 收集不可分割的块：返回按视觉顺序排列的 { top, height }（布局像素，已还原缩放）。
   *
   * 位置用相对纸张内容顶部的偏移，这样块之间的间距也被算进去 ——
   * 只累加高度会漏掉模块间距，页数会被系统性少算。
   */
  function collectBlocks(el, zoomValue) {
    /*
     * 基准是纸面的**内容盒**顶部，不是边框盒顶部。
     *
     * 屏幕上那段内边距（theme.mv）与打印时 page.pdf() 的页边距是同一份留白，
     * 只是位置不同：屏幕在纸面内，打印在纸面外（打印时 .paper 的 padding 被归零）。
     * 若从边框盒量，内边距会被重复计入一次 —— 实测默认简历因此被误判成 2 页
     * （末块 bottom 1049 > 可用 1032，扣掉 45px 内边距后是 1004，本来就放得下）。
     *
     * 顺带说明为什么内容区宽度不用担心：屏幕上是 A4 宽 794px 减去左右内边距 53px×2 = 688px，
     * 打印时是 A4 宽 210mm 减去左右页边距 14mm×2 = 182mm ≈ 688px —— **两者一致**，
     * 所以换行与高度在两种布局下是同一套。
     */
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const toLayout = (px) => px / zoomValue
    const contentTop = rect.top + parseFloat(cs.paddingTop)
    const contentBottom = rect.bottom - parseFloat(cs.paddingBottom)

    const sections = [...el.querySelectorAll('.r-sec')]
    const blocks = []

    // 页头：从内容盒顶部到第一个模块顶部
    const firstTop = sections.length
      ? toLayout(sections[0].getBoundingClientRect().top - contentTop)
      : toLayout(contentBottom - contentTop)
    if (firstTop > 0) blocks.push({ top: 0, height: firstTop })

    for (const section of sections) {
      const sr = section.getBoundingClientRect()
      const top = toLayout(sr.top - contentTop)
      const height = toLayout(sr.height)

      /*
       * 模块整体是不可分割的一块，**不要**再去拆它的子块。
       *
       * 我一度按 `.r-entry` 把高模块拆开，理由是"拆开能把页底填满"——
       * 那是基于误判的过度设计。实测（tools/verify-page-count-agreement.mjs）
       * 拆开之后 8 条经历时算出 2 页、真实导出是 3 页，反而更不准。
       *
       * 真实规则是：`.r-sec` 带 break-inside: avoid，一个模块在剩余空间里放不下时
       * **整块另起一页**；即使它比一整页还高，也是先另起一页、再在内部断开。
       * 所以只要在这一块放不下时加一页即可（measure 里对超页的块会继续加页）。
       */
      blocks.push({ top, height })
    }
    return blocks
  }

  function measure() {
    const el = toValue(paperRef)
    if (!el) return 1

    const zoomValue = toValue(zoom) || 1
    const verticalPadding = store.theme.mv * MM_TO_PX * 2
    const usableHeight = PAGE.height * MM_TO_PX - verticalPadding
    if (usableHeight <= 0) return 1

    const blocks = collectBlocks(el, zoomValue)
    if (!blocks.length) return 1

    /*
     * 贪心填充。
     *
     * `offset` 是"后续内容被整体顶下去的量"：一块因为放不下而挪到下一页时，
     * 它前面那段页底留白就成了净增高度，后面所有块都要跟着下移这么多。
     *
     * **方向不能弄反。** 我第一版写成 `block.top - shift`（把块往上挪），
     * 结果后面的内容越算越靠上，长简历被系统性少算一页
     * （实测 6 条经历时编辑器报 2 页、导出 3 页）。正确答案是**下移**。
     *
     * EPS 容忍浮点误差，避免恰好放下时被判成放不下。
     */
    const EPS = 0.5
    let pages = 1
    let offset = 0
    let pageEnd = usableHeight

    for (const block of blocks) {
      let top = block.top + offset
      let bottom = top + block.height

      if (bottom > pageEnd + EPS) {
        // 放不下：本页底部剩下的空间被浪费掉，后续内容整体下移
        offset += Math.max(0, pageEnd - top)
        top = block.top + offset
        bottom = top + block.height
        pages += 1
        pageEnd += usableHeight

        // 块本身比一页还高时（浏览器也只能把它拆开），继续占满后续整页
        while (bottom > pageEnd + EPS) {
          pages += 1
          pageEnd += usableHeight
        }
      }
    }

    return Math.max(1, pages)
  }

  /** 等 DOM 更新后再测量；若期间又触发了新的刷新，本次结果直接丢弃 */
  async function refresh() {
    const current = ++token
    await nextTick()
    if (current !== token) return
    pageCount.value = measure()
  }

  /**
   * 把估算过程暴露出来，供验证脚本核对。
   *
   * 这个估算必须与**真实导出的页数**对齐，而两者不一致时最难判断的是
   * 「是我的公式错了，还是块几何取错了」。只给一个页数无法区分，
   * 所以把块列表一起交出来 —— 验证脚本可以直接看到估算器认为每一块在哪、有多高。
   * 不参与渲染，也不影响 measure 的行为。
   */
  function debugBlocks() {
    const el = toValue(paperRef)
    if (!el) return null
    const zoomValue = toValue(zoom) || 1
    const verticalPadding = store.theme.mv * MM_TO_PX * 2
    const usableHeight = PAGE.height * MM_TO_PX - verticalPadding
    return {
      usableHeight: Math.round(usableHeight),
      blocks: collectBlocks(el, zoomValue).map((b) => ({
        top: Math.round(b.top),
        height: Math.round(b.height),
      })),
    }
  }

  return { pageCount, measure, refresh, debugBlocks }
}
