import { describe, expect, it } from 'vitest'

import { createHistory } from '@/utils/history'

/** 快照用短字符串即可，字节预算的裁剪逻辑用大串验证 */
describe('createHistory', () => {
  it('commit 后可撤销，撤销后可重做，新修改会丢弃重做分支', () => {
    const history = createHistory()
    history.init('v0')

    history.commit('v1')
    history.commit('v2')
    expect(history.canUndo()).toBe(true)
    expect(history.undo('v2')).toBe('v1')
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(true)

    // 连续撤销两步后，重做链仍完整：v1 → v2
    expect(history.undo('v1')).toBe('v0')
    expect(history.redo('v0')).toBe('v1')
    expect(history.redo('v1')).toBe('v2')

    // 但撤销后一旦产生新修改，重做分支即被丢弃
    history.undo('v2') // 回到 v1
    history.commit('v1-new')
    expect(history.canRedo()).toBe(false)
  })

  it('重做后撤销能回到来路', () => {
    const history = createHistory()
    history.init('v0')
    history.commit('v1')

    expect(history.undo('v1')).toBe('v0')
    expect(history.redo('v0')).toBe('v1')
    expect(history.undo('v1')).toBe('v0')
  })

  it('撤销前未提交的当前状态会先补记，保证能重做回来', () => {
    const history = createHistory()
    history.init('v0')
    history.commit('v1')

    // 调用方已经改到 v1.5 但还没 commit（对应打字途中按 Ctrl+Z）
    expect(history.undo('v1.5')).toBe('v1')
    expect(history.redo('v1')).toBe('v1.5')
  })

  it('与基线相同的 commit 是空操作', () => {
    const history = createHistory()
    history.init('v0')
    history.commit('v1')
    expect(history.commit('v1')).toBe(false)
    expect(history.undo('v1')).toBe('v0')
    expect(history.undo('v0')).toBeNull()
  })

  it('reset 清空历史（重置简历/导入替换的边界）', () => {
    const history = createHistory()
    history.init('v0')
    history.commit('v1')

    history.reset('fresh')
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
    expect(history.undo('fresh')).toBeNull()
  })

  it('条数超限丢最旧的', () => {
    const history = createHistory({ maxEntries: 3 })
    history.init('v0')
    for (const v of ['v1', 'v2', 'v3', 'v4']) history.commit(v)

    // v0 已被挤出预算：连续撤销最多回到 v1
    expect(history.undo('v4')).toBe('v3')
    expect(history.undo('v3')).toBe('v2')
    expect(history.undo('v2')).toBe('v1')
    expect(history.undo('v1')).toBeNull()
  })

  it('字节预算超限同样从最旧丢弃，且至少保留一条', () => {
    const big = 'x'.repeat(100)
    const history = createHistory({ maxEntries: 10, maxBytes: 250 })
    history.init(big) // 基线 100
    history.commit(big + '1') // 101
    history.commit(big + '12') // 102
    history.commit(big + '123') // 103 → 总量 306 超预算，丢基线

    expect(history.size()).toBeLessThan(3)
    // 撤销链仍然可用，只是丢掉了最早的历史
    expect(history.undo(big + '123')).not.toBeNull()
  })

  it('undo/redo 的交换遵循同一字节预算', () => {
    const history = createHistory({ maxEntries: 10, maxBytes: 250 })
    const big = 'x'.repeat(100)
    history.init(big)
    history.commit(big + 'a')

    const target = history.undo(big + 'a')
    expect(target).toBe(big)
  })
})
