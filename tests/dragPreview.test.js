import { describe, expect, it } from 'vitest'

import { reorderSectionsByPreview } from '@/composables/useDragPreview'

/**
 * 拖动中的「草稿顺序」重排。
 *
 * 这个函数是纸面实时预览的核心，且它有几条**必须成立的保底行为**：
 * 拖拽组件在增删的中间态偶尔会给出不完整的数组，若直接拿来重排，
 * 纸面会瞬间少掉几个模块（用户看到「模块消失了」），比不预览还糟。
 *
 * 注：测试文件是 .js，不能写 `import type`（那是 TS 语法，rolldown 会解析失败）；
 * 类型只在 TS 侧需要，运行时已被擦除，所以这里直接省略。
 */

/** 造一份只关心 id / title 的最小 Section 列表 */
function makeSections(...ids) {
  return ids.map((id) => ({
    id,
    type: 'text',
    title: id.toUpperCase(),
    visible: true,
    content: '',
  }))
}

const idsOf = (list) => list.map((s) => s.id)

describe('reorderSectionsByPreview', () => {
  it('按草稿顺序重排', () => {
    const sections = makeSections('a', 'b', 'c')
    expect(idsOf(reorderSectionsByPreview(sections, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b'])
  })

  it('草稿为 null 时原样返回（不在拖动中）', () => {
    const sections = makeSections('a', 'b', 'c')
    // 同一个引用 —— 调用方（PreviewPane）靠它判断「无需重渲染」
    expect(reorderSectionsByPreview(sections, null)).toBe(sections)
  })

  it('草稿为空数组时原样返回', () => {
    const sections = makeSections('a', 'b')
    expect(reorderSectionsByPreview(sections, [])).toBe(sections)
  })

  /*
   * 这条是保命逻辑：拖拽中间态给了残缺草稿（只有 a），
   * 未列出的 b/c 必须留在末尾，不能因为草稿没提到就把它们丢掉。
   * 如果这条坏了，用户拖一次会看到两个模块凭空消失。
   */
  it('草稿不完整时不丢模块，未列出的按原顺序附在末尾', () => {
    const sections = makeSections('a', 'b', 'c')
    const result = reorderSectionsByPreview(sections, ['c'])
    expect(idsOf(result)).toEqual(['c', 'a', 'b'])
    expect(result).toHaveLength(3)
  })

  it('草稿里含不存在的 id 时忽略它，不产生幽灵模块', () => {
    const sections = makeSections('a', 'b')
    const result = reorderSectionsByPreview(sections, ['ghost', 'b', 'a'])
    expect(idsOf(result)).toEqual(['b', 'a'])
    expect(result).toHaveLength(2)
  })

  it('草稿重复同一 id 时不会重复渲染', () => {
    const sections = makeSections('a', 'b')
    const result = reorderSectionsByPreview(sections, ['a', 'a', 'b'])
    expect(idsOf(result)).toEqual(['a', 'b'])
  })

  it('不修改传入的数组（纯函数）', () => {
    const sections = makeSections('a', 'b', 'c')
    const copy = [...sections]
    reorderSectionsByPreview(sections, ['c', 'b', 'a'])
    expect(sections).toEqual(copy)
  })
})
