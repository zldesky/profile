import { beforeEach, describe, expect, it } from 'vitest'

import { usePaperJump } from '../src/composables/usePaperJump.ts'

/**
 * 纸面 → 编辑卡片跳转的请求状态。
 *
 * 这里只测得到请求这一半（真正滚动与闪烁要 DOM，属端到端范畴），
 * 但恰好是最容易写错的一半：响应方按「序号」而不是「id」触发，
 * 因为连点同一个模块时 id 不变。
 */
describe('usePaperJump', () => {
  let jump

  beforeEach(() => {
    // 模块级单例，逐个用例先清干净，避免相互影响
    jump = usePaperJump()
    jump.consume()
    jump.requestSeq.value = 0
  })

  it('发起跳转后带上目标 id 并递增序号', () => {
    jump.focusSection('sec-1')

    expect(jump.targetId.value).toBe('sec-1')
    expect(jump.requestSeq.value).toBe(1)
  })

  it('连点同一个模块时序号仍递增（否则响应方不会再次滚动）', () => {
    jump.focusSection('sec-1')
    const first = jump.requestSeq.value
    jump.consume()

    jump.focusSection('sec-1')

    expect(jump.requestSeq.value).toBe(first + 1)
    expect(jump.targetId.value).toBe('sec-1')
  })

  it('连点不同模块时 id 跟着换', () => {
    jump.focusSection('sec-1')
    jump.focusSection('sec-2')

    expect(jump.targetId.value).toBe('sec-2')
    expect(jump.requestSeq.value).toBe(2)
  })

  it('consume 清掉目标，避免同一请求被重复响应', () => {
    jump.focusSection('sec-1')
    jump.consume()

    expect(jump.targetId.value).toBe('')
    // 序号保留：watch 的触发依据是它，清掉会导致下次请求序号回退
    expect(jump.requestSeq.value).toBe(1)
  })

  it('每次调用取到的是同一份单例状态', () => {
    const a = usePaperJump()
    const b = usePaperJump()

    a.focusSection('sec-9')

    expect(b.targetId.value).toBe('sec-9')
    expect(b.requestSeq.value).toBe(a.requestSeq.value)
  })
})
