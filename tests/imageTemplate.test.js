import { describe, expect, it } from 'vitest'

import { analyzeResumeImage } from '../src/utils/imageTemplate.js'

/** 构造纯色矩形填充到 RGBA 像素 buffer 上 */
function fillRect(data, width, x0, y0, x1, y1, [r, g, b]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
    }
  }
}

function makeImage(width, height) {
  // 白底起步，fill(255) 同时保证 alpha 为不透明
  return new Uint8ClampedArray(width * height * 4).fill(255)
}

describe('analyzeResumeImage：版式骨架与主色推断', () => {
  it('顶部纯色带识别为通栏页头，主色取自色带', () => {
    const width = 200
    const height = 280
    const data = makeImage(width, height)
    fillRect(data, width, 0, 0, width, 46, [43, 87, 154])

    const result = analyzeResumeImage(data, width, height)
    expect(result.header).toBe('banner')
    expect(result.accent).toBe('#2b579a')
    expect(result.mode).toBeNull()
  })

  it('典型高度的色带（约 12% 页高）混入白色姓名文字仍能识别', () => {
    const width = 240
    const height = 340
    const data = makeImage(width, height)
    fillRect(data, width, 0, 0, width, 40, [43, 87, 154])
    // 在色带内撒白色「文字」像素：文字只是少数，不该影响识别
    for (let y = 8; y < 32; y += 2) {
      for (let x = 20; x < 150; x += 8) {
        fillRect(data, width, x, y, x + 2, y + 1, [255, 255, 255])
      }
    }

    const result = analyzeResumeImage(data, width, height)
    expect(result.header).toBe('banner')
    expect(result.accent).toBe('#2b579a')
  })

  it('过窄的顶部色条（不足 8% 页高）不误判为页头', () => {
    const width = 240
    const height = 340
    const data = makeImage(width, height)
    fillRect(data, width, 0, 0, width, 20, [43, 87, 154])

    const result = analyzeResumeImage(data, width, height)
    expect(result.header).toBeNull()
  })

  it('左侧纯色竖栏识别为左侧栏', () => {
    const width = 200
    const height = 280
    const data = makeImage(width, height)
    fillRect(data, width, 0, 0, 60, height, [31, 111, 92])

    const result = analyzeResumeImage(data, width, height)
    expect(result.mode).toBe('railLeft')
    expect(result.accent).toBe('#1f6f5c')
    expect(result.header).toBeNull()
  })

  it('右侧纯色竖栏识别为右侧栏', () => {
    const width = 200
    const height = 280
    const data = makeImage(width, height)
    fillRect(data, width, 140, 0, width, height, [139, 23, 77])

    const result = analyzeResumeImage(data, width, height)
    expect(result.mode).toBe('railRight')
    expect(result.accent).toBe('#8b174d')
  })

  it('正文纵向留白沟识别为双栏，比例就近取档', () => {
    const width = 200
    const height = 280
    const data = makeImage(width, height)
    // 左右两栏浅灰内容块，64~76 列留白成沟
    fillRect(data, width, 10, 80, 64, 250, [225, 228, 233])
    fillRect(data, width, 76, 80, 190, 250, [225, 228, 233])

    const result = analyzeResumeImage(data, width, height)
    expect(result.mode).toBe('split')
    // 沟起点 32%，就近取 34 档
    expect(result.ratio).toBe('34')
    expect(result.header).toBeNull()
  })

  it('纯白图什么都不改，全部返回 null', () => {
    const data = makeImage(200, 280)
    const result = analyzeResumeImage(data, 200, 280)
    expect(result.mode).toBeNull()
    expect(result.header).toBeNull()
    expect(result.ratio).toBeNull()
    expect(result.accent).toBeNull()
    expect(result.findings.length).toBeGreaterThan(0)
  })

  it('单栏版式中间的空白列不会误判为双栏（右侧是页边距，无内容）', () => {
    const width = 200
    const height = 280
    const data = makeImage(width, height)
    // 只在左侧 15%~45% 放内容，右侧大片留白
    fillRect(data, width, 30, 80, 90, 250, [225, 228, 233])

    const result = analyzeResumeImage(data, width, height)
    expect(result.mode).toBeNull()
  })
})
