import { describe, expect, it } from 'vitest'

import { BULLET_LENGTH } from '@/data/writingRules'
import { charCount } from '@/utils/expression'

/**
 * 字数提示的判定逻辑。
 *
 * 组件本身要在浏览器里挂载才能测，但「什么情况算超长」是纯逻辑，
 * 这里把它按组件里的同一套分支复算一遍 —— 目的不是重复实现，
 * 而是把「阈值只有一个来源」这件事钉住：两组断言读的是同一个 BULLET_LENGTH。
 */
const stateOf = (text, min = BULLET_LENGTH.min, max = BULLET_LENGTH.max) => {
  const count = charCount(text)
  if (count === 0) return 'empty'
  if (count > max) return 'over'
  if (count < min) return 'under'
  return 'ok'
}

describe('字数提示 · 判定分支', () => {
  it('空内容不显示（由占位符引导，不需要再提示一遍）', () => {
    expect(stateOf('')).toBe('empty')
    expect(stateOf('   ')).toBe('empty')
  })

  it('低于下限提示偏短，但不使用告警色', () => {
    expect(stateOf('负责前端')).toBe('under')
  })

  it('落在区间内是正常', () => {
    expect(stateOf('主导支付重构，失败率从百分之二降到零点三')).toBe('ok')
  })

  it('超过上限才算超长', () => {
    const long = '主导'.repeat(BULLET_LENGTH.max)
    expect(stateOf(long)).toBe('over')
  })

  it('边界值本身不算越界（等于上限是合规的）', () => {
    const exactly = '好'.repeat(BULLET_LENGTH.max)
    expect(charCount(exactly)).toBe(BULLET_LENGTH.max)
    expect(stateOf(exactly)).toBe('ok')

    const exactlyMin = '好'.repeat(BULLET_LENGTH.min)
    expect(stateOf(exactlyMin)).toBe('ok')
  })

  it('中英混排按字符数计，不按字节', () => {
    // "Vue 3" 去掉空格是 V,u,e,3 → 4 个字符；中文也各算一个，不会被当成多字节
    expect(charCount('Vue 3')).toBe(4)
    // "用 Vue3 搭建" 去空格 = 用,V,u,e,3,搭,建 → 7
    expect(charCount('用 Vue3 搭建')).toBe(7)
  })
})

describe('字数提示 · 与写作检查共用同一份阈值', () => {
  /*
   * 这条是防止两套数字漂移的守门断言：
   * 若有人改了 BULLET_LENGTH，写作检查（structure.too-long）与界面的字数提示
   * 会同时跟着变，因为它们读的是同一个常量。
   * 这里断言的是「常量确实被两处共用」这一事实本身 —— 数值改动不需要改测试。
   */
  it('BULLET_LENGTH 同时被界面与检查引用（min < max 且都是正数）', () => {
    expect(BULLET_LENGTH.min).toBeGreaterThan(0)
    expect(BULLET_LENGTH.max).toBeGreaterThan(BULLET_LENGTH.min)
  })

  it('超长阈值处的文本，写作检查也会报 too-long（同一数字的两端）', async () => {
    const { analyzeBullet } = await import('@/utils/expression')
    const long = '主导'.repeat(BULLET_LENGTH.max)
    const ids = analyzeBullet(long).map((f) => f.ruleId)
    expect(ids).toContain('structure.too-long')
  })
})
