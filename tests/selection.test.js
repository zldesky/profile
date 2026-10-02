import { describe, expect, it } from 'vitest'

import {
  applyMemberOrder,
  insertGroupAtVisibleIndex,
  pickIdsInRect,
  rectsIntersect,
  sectionContainerKey,
} from '@/utils/selection'

const rect = (left, top, right, bottom) => ({ left, top, right, bottom })

describe('rectsIntersect', () => {
  it('相交为真', () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(true)
  })

  it('仅贴边也算相交', () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(true)
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(0, 10, 10, 20))).toBe(true)
  })

  it('分离为假', () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(11, 11, 20, 20))).toBe(false)
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(0, 11, 10, 20))).toBe(false)
  })
})

describe('pickIdsInRect', () => {
  const boxes = [
    { id: 'a', rect: rect(0, 0, 100, 40) },
    { id: 'b', rect: rect(0, 50, 100, 90) },
    { id: 'c', rect: rect(0, 100, 100, 140) },
  ]

  it('部分相交即命中，顺序保持候选顺序', () => {
    expect(pickIdsInRect(boxes, rect(90, 30, 200, 95))).toEqual(['a', 'b'])
  })

  it('只擦到一角也算命中', () => {
    // 选框右下角与 c 的左上角（0..100, 100..140）相交
    expect(pickIdsInRect(boxes, rect(90, 30, 200, 110))).toEqual(['a', 'b', 'c'])
  })

  it('都不相交时为空', () => {
    expect(pickIdsInRect(boxes, rect(200, 0, 300, 30))).toEqual([])
  })
})

describe('sectionContainerKey', () => {
  it('单栏模板全部同容器', () => {
    expect(sectionContainerKey('classic', 'grid')).toBe('main')
    expect(sectionContainerKey('timeline', 'entries')).toBe('main')
    expect(sectionContainerKey('minimal', 'text')).toBe('main')
  })

  it('sidebar：键值与技能进左栏，其余进正文栏', () => {
    expect(sectionContainerKey('sidebar', 'grid')).toBe('rail')
    expect(sectionContainerKey('sidebar', 'skills')).toBe('rail')
    expect(sectionContainerKey('sidebar', 'entries')).toBe('body')
    expect(sectionContainerKey('sidebar', 'text')).toBe('body')
  })

  it('twocol：条目进宽栏，其余进窄栏', () => {
    expect(sectionContainerKey('twocol', 'entries')).toBe('wide')
    expect(sectionContainerKey('twocol', 'grid')).toBe('side')
    expect(sectionContainerKey('twocol', 'text')).toBe('side')
  })
})

describe('insertGroupAtVisibleIndex', () => {
  const all = (ids) => new Set(ids)

  it('插入到第 k 个可见成员之前', () => {
    const members = ['a', 'b', 'c', 'd', 'e']
    // 落点之上是 a、b、d 三个成员（k=3）→ 插到第 3 个可见成员 e 之前
    expect(insertGroupAtVisibleIndex(members, ['c'], 3, all(members))).toEqual([
      'a',
      'b',
      'd',
      'c',
      'e',
    ])
    // 落点仍在原位（b、d 之间，k=2）→ 顺序不变
    expect(insertGroupAtVisibleIndex(members, ['c'], 2, all(members))).toEqual(members)
  })

  it('k=0 插到最前，k=可见数 插到末尾', () => {
    const members = ['a', 'b', 'c', 'd']
    expect(insertGroupAtVisibleIndex(members, ['d'], 0, all(members))).toEqual(['d', 'a', 'b', 'c'])
    expect(insertGroupAtVisibleIndex(members, ['a'], 3, all(members))).toEqual(['b', 'c', 'd', 'a'])
  })

  it('越界 k 夹到边界', () => {
    const members = ['a', 'b', 'c']
    expect(insertGroupAtVisibleIndex(members, ['a'], 99, all(members))).toEqual(['b', 'c', 'a'])
    expect(insertGroupAtVisibleIndex(members, ['c'], -5, all(members))).toEqual(['c', 'a', 'b'])
  })

  it('隐藏成员不占可见序位，但保持相对位置', () => {
    // b 隐藏：非成员可见序列为 [c, d]，k=2 表示插到 d 之后（即末尾）
    expect(insertGroupAtVisibleIndex(['a', 'b', 'c', 'd'], ['a'], 2, all(['a', 'c', 'd']))).toEqual(
      ['b', 'c', 'd', 'a'],
    )
  })

  it('整块内部相对顺序保持不变', () => {
    const members = ['a', 'b', 'c', 'd', 'e']
    expect(insertGroupAtVisibleIndex(members, ['b', 'd'], 3, all(members))).toEqual([
      'a',
      'c',
      'e',
      'b',
      'd',
    ])
  })

  it('groupIds 不在容器内时返回副本', () => {
    const members = ['a', 'b']
    const next = insertGroupAtVisibleIndex(members, ['x'], 0, all(members))
    expect(next).toEqual(members)
    expect(next).not.toBe(members)
  })
})

describe('applyMemberOrder', () => {
  it('非成员坑位不动，成员按新顺序回填', () => {
    expect(
      applyMemberOrder(['g1', 'b1', 'g2', 't1', 'g3'], new Set(['g1', 'g2', 'g3']), [
        'g3',
        'g1',
        'g2',
      ]),
    ).toEqual(['g3', 'b1', 'g1', 't1', 'g2'])
  })
})
