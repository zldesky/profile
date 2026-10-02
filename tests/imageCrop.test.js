import { describe, expect, it } from 'vitest'

import { aspectMatches, clampPan, computeSourceRect, coverScale } from '../src/utils/imageCrop.js'

describe('coverScale：铺满裁剪框的最小缩放', () => {
  it('竖图入竖框由宽度决定，横图入竖框由高度决定', () => {
    expect(coverScale(100, 200, 100, 100)).toBe(1)
    expect(coverScale(400, 200, 100, 100)).toBe(0.5)
  })
})

describe('clampPan：平移边界收敛', () => {
  it('平移不得把图片左上角拖进框内，也不得露出框的右下', () => {
    // 图片 200×200，缩放 1，框 100×100 → 可平移范围 [-100, 0]
    expect(clampPan(10, -5, 200, 200, 1, 100, 100)).toEqual({ dx: 0, dy: -5 })
    expect(clampPan(-150, -50, 200, 200, 1, 100, 100)).toEqual({ dx: -100, dy: -50 })
  })

  it('恰好 cover 时不可平移', () => {
    expect(clampPan(-1, -1, 100, 100, 1, 100, 100)).toEqual({ dx: 0, dy: 0 })
  })
})

describe('aspectMatches：比例一致性（1% 相对容差）', () => {
  it('1 寸照片扫描件与 25×35 视为一致', () => {
    expect(aspectMatches(590, 826, 25, 35)).toBe(true)
  })

  it('横图与竖框比例差异明显，需要裁剪', () => {
    expect(aspectMatches(400, 260, 25, 35)).toBe(false)
  })

  it('容差内的轻微偏差不弹裁剪', () => {
    expect(aspectMatches(101, 100, 25, 25, 0.05)).toBe(true)
  })
})

describe('computeSourceRect：可视区换算为原图取样矩形', () => {
  it('居中平移下取样矩形落在原图中央', () => {
    // 框 100×100，图 200×200，scale 1 → cover 后可平移 [-100, 0]，居中即 (-50, -50)
    const rect = computeSourceRect(200, 200, 1, -50, -50, 100, 100)
    expect(rect).toEqual({ sx: 50, sy: 50, sw: 100, sh: 100 })
  })

  it('放大后取样矩形变小，坐标随之收敛到合法区间', () => {
    // 框 100×100，图 200×200，scale 2 → 渲染 400×400，可平移 [-300, 0]
    const rect = computeSourceRect(200, 200, 2, -150, -150, 100, 100)
    expect(rect).toEqual({ sx: 75, sy: 75, sw: 50, sh: 50 })
  })
})
