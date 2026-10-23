import { describe, expect, it } from 'vitest'

import {
  clampAxis,
  fieldLayoutKey,
  fieldLayoutStyle,
  getFieldLayout,
  rangeForField,
  ZERO_FIELD_LAYOUT,
} from '../src/utils/fieldLayout.ts'
import { updateFieldLayout } from '../src/stores/resumeMutations.ts'

/**
 * 字段级间距微调。
 *
 * 重点验证三件事：
 *  1. fieldLayoutKey 逐条区分（同种 field 不同 itemId 各记各的）；
 *  2. fieldLayoutStyle 零值不输出（与 sectionLayoutStyle 同理，避免锁死默认样式）；
 *  3. 每类字段各有自己的范围（rangeForField），clampAxis 按范围钳制。
 */
describe('fieldLayoutKey', () => {
  it('同种字段不同条目得到不同的键', () => {
    expect(fieldLayoutKey('bulletText', 'b1')).toBe('bulletText:b1')
    expect(fieldLayoutKey('bulletText', 'b2')).toBe('bulletText:b2')
    expect(fieldLayoutKey('bulletText', 'b1')).not.toBe(fieldLayoutKey('bulletText', 'b2'))
  })

  it('没有 itemId 的整段字段只用品类作键', () => {
    expect(fieldLayoutKey('content')).toBe('content')
  })
})

describe('rangeForField：每个字段有自己的范围', () => {
  it('正文/要点类允许更大的缩进范围', () => {
    const range = rangeForField('bulletText')
    expect(range.indent.max).toBeGreaterThan(rangeForField('entryTime').indent.max)
  })

  it('未知字段回落到默认范围', () => {
    expect(rangeForField('gridValue')).toEqual(rangeForField('__unknown__'))
  })
})

describe('clampAxis', () => {
  it('按该字段的范围钳制上下界', () => {
    const range = rangeForField('entryTime') // 短标签，indent 上界 48
    expect(clampAxis('entryTime', 'indent', 9999)).toBe(range.indent.max)
    expect(clampAxis('entryTime', 'indent', -9999)).toBe(range.indent.min)
  })

  it('取整到整数像素', () => {
    expect(clampAxis('content', 'indent', 12.7)).toBe(13)
  })
})

describe('fieldLayoutStyle', () => {
  it('全零时返回空对象', () => {
    expect(fieldLayoutStyle(ZERO_FIELD_LAYOUT)).toEqual({})
    expect(fieldLayoutStyle(undefined)).toEqual({})
  })

  it('各轴映射到对应 margin', () => {
    const style = fieldLayoutStyle({ indent: 8, indentRight: -4, extraGap: 6, extraGapBottom: 3 })
    expect(style).toEqual({
      marginLeft: '8px',
      marginRight: '-4px',
      marginTop: '6px',
      marginBottom: '3px',
    })
  })
})

describe('updateFieldLayout：写回与归零清理', () => {
  function resumeWithSection() {
    return {
      sections: [
        { id: 's1', type: 'entries', title: '经历', visible: true, layout: {}, items: [] },
      ],
    }
  }

  it('只覆盖传入的轴，其余保留', () => {
    const resume = resumeWithSection()
    updateFieldLayout(resume, 's1', 'bulletText:b1', { indent: 10 })
    updateFieldLayout(resume, 's1', 'bulletText:b1', { extraGap: 5 })
    expect(getFieldLayout(resume.sections[0], 'bulletText:b1')).toEqual({
      indent: 10,
      indentRight: 0,
      extraGap: 5,
      extraGapBottom: 0,
    })
  })

  it('四个轴都归零后删掉该字段（不留死数据）', () => {
    const resume = resumeWithSection()
    updateFieldLayout(resume, 's1', 'content', { indent: 10 })
    expect(resume.sections[0].fieldLayouts.content).toBeTruthy()
    updateFieldLayout(resume, 's1', 'content', { indent: 0 })
    expect(resume.sections[0].fieldLayouts).toBeUndefined()
  })
})
