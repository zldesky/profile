/**
 * 末页留白分析（纯函数）。
 *
 * 解决的问题很具体：长简历很容易出现「最后一页只有两三行」——
 * 招聘方翻到第二页看到两行字，观感比一页排满差得多，还会显得内容不够。
 * 用户自己很难发现：编辑器里是连续滚动的，不做分页就看不出来。
 *
 * 判定需要「每块在第几页、占多少高度」，这些几何数据 usePageMetrics 已经算过一遍，
 * 这里只做纯粹的分配计算，不碰 DOM —— 这样可以脱离浏览器单测，
 * 也能被验证脚本用同一套逻辑复核。
 */

export interface LayoutBlock {
  /** 相对纸张内容盒顶部的偏移（布局像素） */
  top: number
  height: number
}

export interface PageSlice {
  /** 第几页，从 1 开始 */
  page: number
  /** 这一页上所有块占的高度合计 */
  used: number
}

export interface PageFillReport {
  pages: PageSlice[]
  /** 总页数 */
  pageCount: number
  /** 可用高度（单页内容区高度） */
  usableHeight: number
  /** 末页已用高度 */
  lastPageUsed: number
  /** 末页填充率 0–1 */
  lastPageRatio: number
  /**
   * 是否值得提示「末页太空」。
   * 阈值 0.15：低于这个值意味着末页只有两三行 —— 读者会觉得「翻过去就为看这么点」。
   * 设太高（如 0.3）会把正常的两页简历也标出来，那提示就废了。
   */
  sparseLastPage: boolean
}

/** 末页填充率低于这个值就算「太空」 */
export const SPARSE_LAST_PAGE_RATIO = 0.15

/**
 * 按不可分割的块贪心分页，并统计每页占用。
 *
 * 必须与 usePageMetrics 的 measure 采用**同一套规则**（块放不下就整块挪页、
 * 超页的块继续占满后续页），否则会出现「页数说 2 页、这里算出 3 页」的矛盾。
 * 两处的规则一致是刻意的：算法都很短，重复一份比抽出一个共享函数更容易读懂，
 * 但**必须一起改** —— 所以这段注释在两边都写了。
 */
export function analyzePageFill(blocks: LayoutBlock[], usableHeight: number): PageFillReport {
  const list = Array.isArray(blocks) ? blocks : []
  const usable = Number(usableHeight)

  if (!list.length || !Number.isFinite(usable) || usable <= 0) {
    return {
      pages: [{ page: 1, used: 0 }],
      pageCount: 1,
      usableHeight: Number.isFinite(usable) && usable > 0 ? usable : 0,
      lastPageUsed: 0,
      lastPageRatio: 0,
      sparseLastPage: false,
    }
  }

  const EPS = 0.5
  let offset = 0
  let pageEnd = usable
  /** 每页已用高度（相对该页起点），索引 0 对应第 1 页 */
  const used: number[] = [0]

  for (const block of list) {
    let top = block.top + offset
    let bottom = top + block.height

    /*
     * 放不下时先判断「是不是页面还空着」。
     *
     * 一个 1200 高的块落在空白的第 1 页上时，它当然「放不下」，
     * 但不该把整个第 1 页跳过 —— 浏览器会从这一页的顶部开始画，
     * 只是画到页底就断，剩下的接着下一页。
     *
     * 原先无条件先 `pageEnd += usable`，于是空页被浪费，
     * 1500 高的块会被算成占 3 页（实际是 2 页）。这个 bug 是测试抓出来的。
     */
    const pageStart = pageEnd - usable
    const isPageEmpty = top <= pageStart + EPS

    if (bottom > pageEnd + EPS && !isPageEmpty) {
      offset += Math.max(0, pageEnd - top)
      top = block.top + offset
      bottom = top + block.height
      pageEnd += usable
      used.push(0)
    }

    // 块比剩余空间高时继续占满后续整页（浏览器也只能把它拆开）
    while (bottom > pageEnd + EPS) {
      pageEnd += usable
      used.push(0)
    }

    /*
     * 统计这个块在**每一页**上占了多少高度。
     *
     * 为什么按「逐页求交集」而不是「记到落点那一页」：
     * 一个比一页还高的块（长经历段）会被浏览器拆开、横跨两三页。
     * 如果只把它记到「落点所在页」，后面那几页就永远是 0 ——
     * 于是「末页太空」的判断会把「真的只剩一行」误判成「页是空的、但不提示」，
     * 或者反过来把占用算到错误的页上。
     *
     * 逐页求交集是唯一不会算错的口径，代价只是一层无关紧要的循环。
     */
    const firstPage = Math.max(0, Math.floor(top / usable))
    const lastPageOfBlock = Math.floor(Math.max(top, bottom - EPS) / usable)
    for (let p = firstPage; p <= lastPageOfBlock && p < used.length; p += 1) {
      const start = p * usable
      const end = start + usable
      const occupied = Math.min(bottom, end) - Math.max(top, start)
      if (occupied > 0) used[p] += occupied
    }
  }

  const lastPageUsed = used[used.length - 1] ?? 0
  const lastPageRatio = Math.min(1, Math.max(0, lastPageUsed / usable))

  return {
    pages: used.map((value, index) => ({ page: index + 1, used: Math.round(value) })),
    pageCount: used.length,
    usableHeight: Math.round(usable),
    lastPageUsed: Math.round(lastPageUsed),
    lastPageRatio,
    // 只有一页时不提示：单页简历的「末页」就是全部内容，说它太空没有意义
    sparseLastPage: used.length > 1 && lastPageRatio < SPARSE_LAST_PAGE_RATIO,
  }
}

/**
 * 给用户看的一句话建议。
 *
 * 刻意写得短：这句话要挤在预览工具条里，和缩放、页数、「压缩到一页」并排。
 * 第一版写成「第 2 页只用了 9%，删掉一两条要点或稍微收紧字号，可能就回到 1 页了」，
 * 实测在工具条里被截成「…删掉一两条要点或稍…」—— 后半句正是最有用的建议，反而被切掉。
 *
 * 现在的写法把「怎么改」放在前面、结论放在后面，截断时也先保住动作。
 * 完整的解释放在 title 属性里（悬停可见）。
 *
 * @returns 无需提示时返回空串（调用方据此不渲染任何东西）
 */
export function sparsePageHint(report: PageFillReport): string {
  if (!report.sparseLastPage) return ''
  const percent = Math.round(report.lastPageRatio * 100)
  return `末页只占 ${percent}%，可精简到 ${report.pageCount - 1} 页`
}

/**
 * 悬停时显示的完整解释（比工具条上那句更长，但仍是同一件事）。
 */
export function sparsePageDetail(report: PageFillReport): string {
  if (!report.sparseLastPage) return ''
  const percent = Math.round(report.lastPageRatio * 100)
  return `第 ${report.pageCount} 页只用了 ${percent}%：删掉一两条要点，或把字号收紧一点，可能就回到 ${report.pageCount - 1} 页`
}
