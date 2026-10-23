import { describe, expect, it } from 'vitest'

import {
  applyMemberOrder,
  insertGroupAtVisibleIndex,
  pickIdsInRect,
  rectsIntersect,
  resolveShiftDirections,
  resolveVisibleInsertIndex,
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

/*
 * 落点索引：**往上拖的方向正确性**（真实回归）。
 *
 * 这是一条真实的 bug 回归：原先按拖动方向分两套判据，
 * 向下 `groupBottom > mid` 是对的；向上 `groupTop < mid` 把方向写反了 ——
 * 位于拖动块**下方**的所有模块都满足「中线在上边缘之下」，
 * 于是往上拖会算出过大的索引。实测把最末的「自我评价」拖到最顶，
 * 索引算成 2（应为 0），松手后它掉到了中间，用户看到的是
 * 「拖不到原位置上方」。
 *
 * 断言覆盖向上 / 向下 / 原地 / 跨多个四种情形，**任何方向写反都会红**。
 */
describe('resolveVisibleInsertIndex（拖拽落点）', () => {
  // 四个等高、相邻的模块：各 100px 高
  const others = [
    { id: 'A', top: 0, bottom: 100 },
    { id: 'B', top: 100, bottom: 200 },
    { id: 'C', top: 200, bottom: 300 },
    { id: 'D', top: 300, bottom: 400 },
  ]

  it('往上拖到最顶 → 索引 0（这是原先算成 2 的那个 bug）', () => {
    // 被拖块原在 D 之后（400~500），整体上移 450px 到 -50~50
    expect(resolveVisibleInsertIndex(others, -50, 50)).toBe(0)
  })

  it('往上拖一格 → 索引对应该块之后', () => {
    // 被拖块当前 250~350（中点 300）：A(50)/B(150)/C(250) 的中点都在它之上，
    // D 的中点 350 在它之下 → 索引 3（插到 D 之前）
    expect(resolveVisibleInsertIndex(others, 250, 350)).toBe(3)
  })

  it('往下拖一格 → 索引 +1', () => {
    // 原在 A 之前，下移 150px → 150~250，中点 200 越过 B 的中点 150
    expect(resolveVisibleInsertIndex(others, 150, 250)).toBe(2)
  })

  it('往下拖到最底 → 索引 = 其余成员数', () => {
    expect(resolveVisibleInsertIndex(others, 450, 550)).toBe(4)
  })

  it('原地不动 → 保持原索引', () => {
    // B 在 100~200，中点 150；A 的中点 50 在它之前 → 索引 1
    expect(resolveVisibleInsertIndex(others, 100, 200)).toBe(1)
  })

  it('无其他成员时索引为 0', () => {
    expect(resolveVisibleInsertIndex([], 0, 100)).toBe(0)
  })
})

/*
 * 让位方向：拖动中「其它模块各自该往哪边挪」。
 *
 * 这是「纸面动效与右侧面板一致」的核心：拖走一个模块后，
 * 它原来的位置必须被下面的模块补上（上移），插入点之后才腾空位（下移）。
 *
 * 原先只做了后半句，前半句没做 —— 被拖块原位置留着一个空洞、下面不补，
 * 用户看到的是「拖走一个、底下不动」。
 */
describe('resolveShiftDirections（拖动让位）', () => {
  const others = ['A', 'B', 'C', 'D']

  it('往下拖：原位置到插入点之间的补上来，插入点之后的让位', () => {
    // 被拖块原在 A 之前(origin=0)，拖到 C 之前(target=2)
    expect(resolveShiftDirections(others, 0, 2)).toEqual({
      A: -1,
      B: -1,
      C: 1,
      D: 1,
    })
  })

  it('往上拖：插入点到原位置之间的让位，其余不动', () => {
    // 被拖块原在 C 之前(origin=2)，拖到 A 之前(target=0)
    expect(resolveShiftDirections(others, 2, 0)).toEqual({
      A: 1,
      B: 1,
      C: 0,
      D: 0,
    })
  })

  it('往下拖到最末：后面所有模块都补上来', () => {
    expect(resolveShiftDirections(others, 1, 4)).toEqual({
      A: 0,
      B: -1,
      C: -1,
      D: -1,
    })
  })

  it('往上拖到最前：前面所有模块都让位', () => {
    expect(resolveShiftDirections(others, 3, 0)).toEqual({
      A: 1,
      B: 1,
      C: 1,
      D: 0,
    })
  })

  it('原地不动：谁都不动', () => {
    expect(resolveShiftDirections(others, 2, 2)).toEqual({ A: 0, B: 0, C: 0, D: 0 })
  })

  it('越界的索引被夹住，不产生无效方向', () => {
    expect(resolveShiftDirections(others, -5, 99)).toEqual({ A: -1, B: -1, C: -1, D: -1 })
  })

  it('空列表返回空对象', () => {
    expect(resolveShiftDirections([], 0, 1)).toEqual({})
  })
})
