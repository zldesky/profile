import { describe, expect, it } from 'vitest'

import {
  boldSpans,
  isRangeInsideBold,
  parseBoldSegments,
  stripBoldMarkers,
  toggleBoldRange,
} from '../src/utils/richText.ts'

describe('parseBoldSegments', () => {
  it('无标记时返回单个普通片段', () => {
    expect(parseBoldSegments('负责核心业务')).toEqual([{ text: '负责核心业务', bold: false }])
  })

  it('拆出加粗片段，普通文字与粗体按原顺序排列', () => {
    expect(parseBoldSegments('负责**核心业务**的设计与迭代')).toEqual([
      { text: '负责', bold: false },
      { text: '核心业务', bold: true },
      { text: '的设计与迭代', bold: false },
    ])
  })

  it('整段加粗', () => {
    expect(parseBoldSegments('**全部加粗**')).toEqual([{ text: '全部加粗', bold: true }])
  })

  it('未闭合的 ** 按普通文字处理，不吞内容', () => {
    expect(parseBoldSegments('价格是 **99 元')).toEqual([{ text: '价格是 **99 元', bold: false }])
    expect(parseBoldSegments('**只有开头的标记')).toEqual([
      { text: '**只有开头的标记', bold: false },
    ])
  })

  it('粗体内容里的单个星号使标记不成立（窄语法），原文原样显示', () => {
    expect(parseBoldSegments('**a*b**')).toEqual([{ text: '**a*b**', bold: false }])
  })

  it('多个加粗段相邻排列', () => {
    expect(parseBoldSegments('**a**与**b**')).toEqual([
      { text: 'a', bold: true },
      { text: '与', bold: false },
      { text: 'b', bold: true },
    ])
  })

  it('空字符串返回空数组', () => {
    expect(parseBoldSegments('')).toEqual([])
  })
})

describe('isRangeInsideBold', () => {
  const raw = '前缀**加粗内容**后缀' // 加粗内容位于 [4, 8)

  it('选区在粗体内容内（含贴边）返回 true', () => {
    expect(isRangeInsideBold(raw, 4, 8)).toBe(true)
    expect(isRangeInsideBold(raw, 5, 7)).toBe(true)
    expect(isRangeInsideBold(raw, 4, 5)).toBe(true)
  })

  it('选区越过粗体边界或落在普通文字上返回 false', () => {
    expect(isRangeInsideBold(raw, 3, 8)).toBe(false)
    expect(isRangeInsideBold(raw, 4, 9)).toBe(false)
    expect(isRangeInsideBold(raw, 0, 2)).toBe(false)
  })

  it('空选区恒为 false', () => {
    expect(isRangeInsideBold(raw, 5, 5)).toBe(false)
  })
})

describe('toggleBoldRange — 加粗', () => {
  it('普通选区包上 **，选区恢复到内容本身', () => {
    const raw = '负责核心业务模块的设计'
    const r = toggleBoldRange(raw, 2, 6)
    expect(r.text).toBe('负责**核心业务**模块的设计')
    expect(r.selectionStart).toBe(4)
    expect(r.selectionEnd).toBe(8)
  })

  it('再按一次（选区不变）即取消加粗 —— 幂等往返', () => {
    const first = toggleBoldRange('负责核心业务模块', 2, 6)
    const second = toggleBoldRange(first.text, first.selectionStart, first.selectionEnd)
    expect(second.text).toBe('负责核心业务模块')
    expect(second.selectionStart).toBe(2)
    expect(second.selectionEnd).toBe(6)
  })

  it('部分选中一个已有粗体（含其标记）时，选区内容重新加粗', () => {
    // **核心**业务：粗体 [2,4)，选中 [3,6) = 「心」+ 收尾 '**'
    const r = toggleBoldRange('**核心**业务', 3, 6)
    expect(r.text).toBe('核**心**业务')
    expect(r.selectionStart).toBe(3)
    expect(r.selectionEnd).toBe(4)
  })

  it('选区盖住整对标记时先剥标记再包（不出现 ****）', () => {
    // 选中 "a**b**"（含标记），结果是整块加粗的 "ab"
    const r = toggleBoldRange('a**b**c', 0, 6)
    expect(r.text).toBe('**ab**c')
    expect(r.text.includes('****')).toBe(false)
  })

  it('只选中某对标记的一半时整段去粗，不会产出空粗体', () => {
    const r = toggleBoldRange('**ab**', 0, 2)
    expect(r.text).toBe('ab')
    expect(r.text.includes('****')).toBe(false)
  })

  it('加粗范围盖住两个已有粗体段时合并为一层', () => {
    const r = toggleBoldRange('**a**和**b**', 0, 11)
    expect(r.text).toBe('**a和b**')
  })

  it('空选区原样返回', () => {
    expect(toggleBoldRange('abc', 2, 2)).toEqual({
      text: 'abc',
      selectionStart: 2,
      selectionEnd: 2,
    })
  })
})

describe('toggleBoldRange — 取消加粗', () => {
  it('选区在粗体内容内：整对标记被移除，选区收回到纯文本位置', () => {
    const r = toggleBoldRange('负责**核心业务**模块', 4, 8)
    expect(r.text).toBe('负责核心业务模块')
    expect(r.selectionStart).toBe(2)
    expect(r.selectionEnd).toBe(6)
  })

  it('只选中粗体内容的一部分也整段去粗（标记模型不支持半段）', () => {
    const r = toggleBoldRange('**核心业务**', 3, 5)
    expect(r.text).toBe('核心业务')
    expect(r.selectionStart).toBe(1)
    expect(r.selectionEnd).toBe(3)
  })
})

describe('boldSpans', () => {
  it('返回不含标记的内容区间', () => {
    expect(boldSpans('a**bc**d**ef**')).toEqual([
      { start: 3, end: 5 },
      { start: 10, end: 12 },
    ])
  })

  it('无标记返回空数组', () => {
    expect(boldSpans('普通文本')).toEqual([])
  })
})

describe('stripBoldMarkers', () => {
  it('剥掉标记保留内容', () => {
    expect(stripBoldMarkers('负责**核心业务**的设计')).toBe('负责核心业务的设计')
  })

  it('未配对的星号原样保留（不能吞用户的普通文字）', () => {
    expect(stripBoldMarkers('乘号写作 ** 或 *')).toBe('乘号写作 ** 或 *')
  })
})
