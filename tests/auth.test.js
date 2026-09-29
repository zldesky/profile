import { describe, expect, it, vi } from 'vitest'

import {
  createLoginGuard,
  createSlidingWindowCounter,
  hashPassword,
  parseCookies,
  validateCredentials,
  verifyPassword,
} from '../server/auth.js'

describe('口令摘要', () => {
  it('正确密码通过，错误密码与畸形摘要一律拒绝', () => {
    const hash = hashPassword('correct-horse-battery')
    expect(verifyPassword('correct-horse-battery', hash)).toBe(true)
    expect(verifyPassword('wrong-password', hash)).toBe(false)
    expect(verifyPassword('', hash)).toBe(false)
    expect(verifyPassword('x', 'garbage')).toBe(false)
    expect(verifyPassword('x', 'md5$1$2$3$4$5')).toBe(false)
  })

  it('同一密码每次摘要不同（随机盐），但都能校验通过', () => {
    const a = hashPassword('same-password')
    const b = hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(verifyPassword('same-password', a)).toBe(true)
    expect(verifyPassword('same-password', b)).toBe(true)
  })

  it('摘要自带参数，弱参数的旧摘要仍可校验（升级兼容）', () => {
    // 手工构造一个参数不同的合法摘要
    const legacy = `scrypt$1024$4$1$${Buffer.from('salt').toString('base64url')}$${Buffer.from(
      'not-a-real-hash',
    )
      .toString('base64url')
      .repeat(4)}`
    // 哈希内容不匹配应返回 false，而不是因为参数解析崩溃
    expect(verifyPassword('anything', legacy)).toBe(false)
  })
})

describe('凭证校验', () => {
  it('用户名长度与字符集', () => {
    expect(validateCredentials('ab', '12345678')).toBe('')
    expect(validateCredentials('张三_1', '12345678')).toBe('')
    expect(validateCredentials('a', '12345678')).toContain('用户名')
    expect(validateCredentials('has space', '12345678')).toContain('用户名')
    expect(validateCredentials('x'.repeat(33), '12345678')).toContain('用户名')
  })

  it('密码长度下限与上限', () => {
    expect(validateCredentials('user', '1234567')).toContain('至少 8 位')
    expect(validateCredentials('user', 'x'.repeat(73))).toContain('最长 72')
    expect(validateCredentials('user', '12345678')).toBe('')
  })
})

describe('登录失败锁定', () => {
  it('连续失败达到上限后锁定，只影响同一 IP+用户名', () => {
    const guard = createLoginGuard({ maxFailures: 3, windowMs: 60000, lockMs: 60000 })

    guard.noteFailure('1.1.1.1', 'alice')
    guard.noteFailure('1.1.1.1', 'alice')
    expect(guard.lockedMs('1.1.1.1', 'alice')).toBe(0)

    guard.noteFailure('1.1.1.1', 'alice')
    expect(guard.lockedMs('1.1.1.1', 'alice')).toBeGreaterThan(0)

    // 其他用户名、其他 IP 不受牵连
    expect(guard.lockedMs('1.1.1.1', 'bob')).toBe(0)
    expect(guard.lockedMs('2.2.2.2', 'alice')).toBe(0)
  })

  it('成功登录清空失败记录', () => {
    const guard = createLoginGuard({ maxFailures: 2, windowMs: 60000, lockMs: 60000 })
    guard.noteFailure('1.1.1.1', 'alice')
    guard.reset('1.1.1.1', 'alice')
    guard.noteFailure('1.1.1.1', 'alice')
    expect(guard.lockedMs('1.1.1.1', 'alice')).toBe(0)
  })

  it('大小写不同的用户名视为同一锁定目标', () => {
    const guard = createLoginGuard({ maxFailures: 1, windowMs: 60000, lockMs: 60000 })
    guard.noteFailure('1.1.1.1', 'Alice')
    expect(guard.lockedMs('1.1.1.1', 'alice')).toBeGreaterThan(0)
  })
})

describe('注册滑动窗口限频', () => {
  it('窗口内放行 max 次，之后拒绝', () => {
    const counter = createSlidingWindowCounter({ max: 3, windowMs: 1000 })
    expect(counter.tryTake('1.1.1.1')).toBe(true)
    expect(counter.tryTake('1.1.1.1')).toBe(true)
    expect(counter.tryTake('1.1.1.1')).toBe(true)
    expect(counter.tryTake('1.1.1.1')).toBe(false)
  })

  it('窗口滑过后恢复放行', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const counter = createSlidingWindowCounter({ max: 1, windowMs: 1000 })
      expect(counter.tryTake('1.1.1.1')).toBe(true)
      expect(counter.tryTake('1.1.1.1')).toBe(false)

      vi.setSystemTime(1001)
      expect(counter.tryTake('1.1.1.1')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Cookie 解析', () => {
  it('解析多对键值并容忍空格', () => {
    expect(parseCookies('a=1; b = 2 ;rs_session=tok')).toEqual({
      a: '1',
      b: '2',
      rs_session: 'tok',
    })
  })

  it('空头与非法编码安全返回', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('bad=%zz')).toEqual({})
  })
})
