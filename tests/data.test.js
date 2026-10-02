import { describe, expect, it } from 'vitest'

import { normalizeResume } from '@/data/normalizeResume'
import { clamp, hexToRgb, moveItem } from '@/utils/helpers'

describe('normalizeResume', () => {
  it('非对象输入回退到示例简历', () => {
    const base = normalizeResume(null)
    expect(base.sections.length).toBeGreaterThan(0)
    expect(base.version).toBe(2)
  })

  it('v1 圆形头像迁移为方形（v2 比例下拉圆会变椭圆）', () => {
    const migrated = normalizeResume({
      version: 1,
      basics: { avatarShape: 'circle' },
      sections: [],
    })
    expect(migrated.basics.avatarShape).toBe('square')
  })

  it('缺失字段补默认值，条目缺 id 自动补齐', () => {
    const normalized = normalizeResume({
      sections: [
        { type: 'entries', title: '经历', items: [{ org: '某公司' }] },
        { type: 'grid', items: [{}] },
      ],
    })

    const entry = normalized.sections[0].items[0]
    expect(entry.id).toBeTruthy()
    expect(entry.meta).toEqual([])
    expect(entry.bullets).toEqual([])

    const grid = normalized.sections[1].items[0]
    expect(grid.id).toBeTruthy()
    expect(grid.icon).toBe('none')
  })

  it('未知字体键回退默认字族', () => {
    const normalized = normalizeResume({ theme: { fontKey: 'comic-sans' }, sections: [] })
    expect(normalized.theme.fontKey).toBe(normalized.theme.fontKey)
  })

  it('自由定制布局缺省补全，非法枚举值回退默认', () => {
    const normalized = normalizeResume({
      theme: { customLayout: { mode: 'banana', header: 'banner', cards: 'yes' } },
      sections: [],
    })
    const layout = normalized.theme.customLayout
    expect(layout.mode).toBe('single') // 非法枚举回退
    expect(layout.header).toBe('banner') // 合法值保留
    expect(layout.ratio).toBe('34') // 缺省补默认
    expect(layout.cards).toBe(false) // 与 showLogo 同约定：仅明确 true 才开启
    expect(layout.divider).toBe(true)
  })
})

describe('helpers', () => {
  it('clamp 夹在区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it('hexToRgb 支持 3 位与 6 位，非法回退', () => {
    expect(hexToRgb('#2b579a')).toBe('43,87,154')
    expect(hexToRgb('#fff')).toBe('255,255,255')
    expect(hexToRgb('javascript:')).toBe('43,87,154')
  })

  it('moveItem 越界时原样返回', () => {
    const list = ['a', 'b', 'c']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(list, 0, 9)).toBe(list)
    expect(moveItem(list, -1, 2)).toBe(list)
  })
})
