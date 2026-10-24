import { describe, expect, it } from 'vitest'

import {
  decideExportAction,
  isExpectedLimit,
  shouldClearPassword,
  shouldKeepPasswordDialog,
} from '@/utils/exportFlow'

/** 默认上下文：已登录、无口令通道、有额度、不在导出中 */
const base = {
  auth: 'authed',
  authRequired: false,
  hasPassword: false,
  quotaExhausted: false,
  exporting: false,
}

describe('decideExportAction · 阻断优先', () => {
  it('正在导出时什么都不做（避免重复提交）', () => {
    expect(decideExportAction({ ...base, exporting: true })).toBe('noop')
  })

  it('额度用完时什么都不做（点了也只会失败）', () => {
    expect(decideExportAction({ ...base, quotaExhausted: true })).toBe('noop')
  })

  it('两种阻断同时存在时仍然是 noop', () => {
    expect(decideExportAction({ ...base, exporting: true, quotaExhausted: true })).toBe('noop')
  })

  it('阻断优先于「需要登录」：不该先让用户登录再告诉他额度没了', () => {
    expect(decideExportAction({ ...base, auth: 'anon', quotaExhausted: true })).toBe('noop')
  })
})

describe('decideExportAction · 口令通道', () => {
  it('服务要口令、本地没有 → 弹口令框', () => {
    expect(decideExportAction({ ...base, authRequired: true, hasPassword: false })).toBe(
      'ask-password',
    )
  })

  it('服务要口令、本地已有 → 直接导出', () => {
    expect(decideExportAction({ ...base, authRequired: true, hasPassword: true })).toBe('export')
  })

  it('口令优先于登录：两者都缺时先要口令（本地弹窗，不打断编辑）', () => {
    expect(
      decideExportAction({ ...base, auth: 'anon', authRequired: true, hasPassword: false }),
    ).toBe('ask-password')
  })

  it('匿名但已填口令 → 直接导出（脚本通道不需要登录）', () => {
    expect(decideExportAction({ ...base, auth: 'anon', hasPassword: true })).toBe('export')
  })
})

describe('decideExportAction · 登录', () => {
  it('匿名、无口令、服务不要求口令 → 弹登录', () => {
    expect(decideExportAction({ ...base, auth: 'anon' })).toBe('ask-login')
  })

  it('已登录 → 直接导出', () => {
    expect(decideExportAction({ ...base, auth: 'authed' })).toBe('export')
  })

  it('登录态未知时不主动弹登录（避免误判为未登录而打断已登录用户）', () => {
    expect(decideExportAction({ ...base, auth: 'unknown' })).toBe('export')
  })
})

describe('shouldClearPassword', () => {
  it('只有口令错误与被锁定才清（这两类清掉后重输有意义）', () => {
    expect(shouldClearPassword('AUTH_FAILED')).toBe(true)
    expect(shouldClearPassword('AUTH_LOCKED')).toBe(true)
  })

  it('额度、网络、服务未启动等一律不清 —— 清了也没用，只会让用户重输一遍', () => {
    for (const code of ['QUOTA', 'NETWORK', 'AUTH_REQUIRED', undefined, '']) {
      expect(shouldClearPassword(code)).toBe(false)
    }
  })
})

describe('shouldKeepPasswordDialog', () => {
  it('口令错误时保持打开，方便直接重输', () => {
    expect(shouldKeepPasswordDialog('AUTH_FAILED')).toBe(true)
  })

  it('被锁定时关闭（继续重试只会延长锁定）', () => {
    expect(shouldKeepPasswordDialog('AUTH_LOCKED')).toBe(false)
  })
})

describe('isExpectedLimit', () => {
  it('额度与来源两类属于可预期限制', () => {
    expect(isExpectedLimit('服务今日导出总额度已用完')).toBe(true)
    expect(isExpectedLimit('请求来源不被允许')).toBe(true)
  })

  it('其它错误不算（提示里不该乱加「改用打印导出」）', () => {
    expect(isExpectedLimit('渲染服务未响应')).toBe(false)
    expect(isExpectedLimit('')).toBe(false)
    expect(isExpectedLimit(undefined)).toBe(false)
  })
})
