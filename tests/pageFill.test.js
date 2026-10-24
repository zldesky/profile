import { describe, expect, it } from 'vitest'

import {
  SPARSE_LAST_PAGE_RATIO,
  analyzePageFill,
  sparsePageDetail,
  sparsePageHint,
} from '@/utils/pageFill'

/** 造一批等高的块，便于算清「哪一页装了哪些」 */
const blocks = (heights) => {
  let top = 0
  return heights.map((height) => {
    const block = { top, height }
    top += height
    return block
  })
}

describe('analyzePageFill · 基本分页', () => {
  it('单页内容时只有一页，且不会提示末页太空', () => {
    const report = analyzePageFill(blocks([200, 300]), 1000)
    expect(report.pageCount).toBe(1)
    expect(report.sparseLastPage).toBe(false)
  })

  it('放不下就整块挪页，页数正确', () => {
    // 600 + 600 = 1200 > 1000 → 第二块挪到第 2 页
    const report = analyzePageFill(blocks([600, 600]), 1000)
    expect(report.pageCount).toBe(2)
  })

  it('恰好放下时不多算一页（浮点容忍）', () => {
    const report = analyzePageFill(blocks([500, 500]), 1000)
    expect(report.pageCount).toBe(1)
  })

  it('比一页还高的块会跨页', () => {
    const report = analyzePageFill(blocks([2500]), 1000)
    expect(report.pageCount).toBeGreaterThanOrEqual(3)
  })
})

describe('analyzePageFill · 末页占用', () => {
  it('末页只有一点点内容时，标记为稀疏', () => {
    /*
     * 造数据要注意：块是**整块挪页**的，所以第二块 900 会自己也占满第 2 页。
     * 想让「末页只剩 50」，第一页必须装得下前两块（各 400），
     * 第三块 50 才落到第 2 页 —— 这正是「把内容删到刚好溢出一点点」的真实形态。
     */
    const report = analyzePageFill(blocks([400, 400, 250]), 1000)
    expect(report.pageCount).toBe(2)
    expect(report.lastPageUsed).toBe(250)
    expect(report.lastPageRatio).toBeCloseTo(0.25, 5)
    expect(report.sparseLastPage).toBe(false)
  })

  it('末页只剩极少（<15%）时标记为稀疏', () => {
    // 第 1 页装满 1000，第 2 页只剩 50（5%）
    const report = analyzePageFill(blocks([500, 500, 50]), 1000)
    expect(report.pageCount).toBe(2)
    expect(report.lastPageUsed).toBe(50)
    expect(report.sparseLastPage).toBe(true)
  })

  it('末页内容正常时不标记', () => {
    // 第 1 页 600，第 2 页 600 → 末页 60%
    const report = analyzePageFill(blocks([600, 600]), 1000)
    expect(report.lastPageRatio).toBeGreaterThan(0.5)
    expect(report.sparseLastPage).toBe(false)
  })

  it('末页恰好等于阈值时不提示（边界取「小于」）', () => {
    // 第 1 页装 1000，第 2 页恰好 150 → 15%
    const report = analyzePageFill(blocks([500, 500, 150]), 1000)
    expect(report.pageCount).toBe(2)
    expect(report.lastPageUsed).toBe(150)
    expect(report.lastPageRatio).toBeCloseTo(SPARSE_LAST_PAGE_RATIO, 5)
    expect(report.sparseLastPage).toBe(false)
  })

  it('跨页的块按每页实际占用分别统计，不会把末页算大', () => {
    /*
     * 一个 1200 高的块在 1000 高的页上会占满第 1 页 + 第 2 页 200。
     * 若直接把 block.height 加到「当前页」，末页会被算成 1200（>100%），
     * 于是「末页太空」永远测不出来。
     */
    const report = analyzePageFill(blocks([1200]), 1000)
    expect(report.pageCount).toBe(2)
    expect(report.lastPageUsed).toBeLessThanOrEqual(1000)
    expect(report.lastPageUsed).toBe(200)
  })
})

describe('analyzePageFill · 异常输入', () => {
  it('空块列表返回单页且不提示', () => {
    const report = analyzePageFill([], 1000)
    expect(report.pageCount).toBe(1)
    expect(report.sparseLastPage).toBe(false)
    expect(sparsePageHint(report)).toBe('')
  })

  it('可用高度非法时不抛错', () => {
    for (const usable of [0, -100, NaN, Infinity, undefined]) {
      const report = analyzePageFill(blocks([100]), usable)
      expect(report.pageCount).toBe(1)
      expect(report.sparseLastPage).toBe(false)
    }
  })

  it('非数组输入安全', () => {
    expect(analyzePageFill(null, 1000).pageCount).toBe(1)
    expect(analyzePageFill(undefined, 1000).pageCount).toBe(1)
  })
})

describe('sparsePageHint', () => {
  it('稀疏时给出可执行的建议，并带上真实百分比', () => {
    const report = analyzePageFill(blocks([500, 500, 50]), 1000)
    const hint = sparsePageHint(report)
    expect(hint).toContain('末页')
    expect(hint).toContain('5%')
    expect(hint).toContain('1 页')
  })

  it('工具条上那句要短（长了会被截断，最有用的建议反而被切掉）', () => {
    const report = analyzePageFill(blocks([500, 500, 50]), 1000)
    // 30 字以内才放得进预览工具条，与缩放/页数/压缩按钮并排
    expect(sparsePageHint(report).length).toBeLessThanOrEqual(30)
  })

  it('不稀疏时返回空串（调用方据此不渲染）', () => {
    expect(sparsePageHint(analyzePageFill(blocks([200]), 1000))).toBe('')
  })
})

describe('sparsePageDetail', () => {
  it('悬停解释比工具条那句更长，且说清怎么改', () => {
    const report = analyzePageFill(blocks([500, 500, 50]), 1000)
    const detail = sparsePageDetail(report)
    expect(detail.length).toBeGreaterThan(sparsePageHint(report).length)
    expect(detail).toContain('删掉')
    expect(detail).toContain('字号')
  })

  it('不稀疏时返回空串', () => {
    expect(sparsePageDetail(analyzePageFill(blocks([200]), 1000))).toBe('')
  })
})
