import { describe, expect, it } from 'vitest'

import { createCaptcha, VIEW_HEIGHT, VIEW_WIDTH } from '../server/captcha.js'

/** 固定缺口的实例：x/y 注入为确定值，测试才能算出「正确答案」 */
function fixedCaptcha(overrides = {}) {
  return createCaptcha({
    secret: 'test-secret',
    randomX: () => 100,
    randomY: () => 60,
    ...overrides,
  })
}

describe('滑块验证码', () => {
  it('挑战返回图形与尺寸，不泄露缺口横坐标', () => {
    const captcha = fixedCaptcha()
    const challenge = captcha.challenge()

    expect(challenge.id).toBeTruthy()
    expect(challenge.width).toBe(VIEW_WIDTH)
    expect(challenge.height).toBe(VIEW_HEIGHT)
    expect(challenge.pieceY).toBe(60)
    expect(challenge.background).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(challenge.piece).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(challenge).not.toHaveProperty('x')
  })

  it('拖动结果落在容差内才通过，通过令牌一次性', () => {
    const captcha = fixedCaptcha()

    // 差得太远：失败，且挑战随之作废（同一 id 不能试第二次）
    const first = captcha.challenge()
    expect(captcha.verify(first.id, 100 + 20)).toEqual({ ok: false, reason: 'mismatch' })
    expect(captcha.verify(first.id, 100)).toEqual({ ok: false, reason: 'invalid' })

    // 容差内：通过，令牌可消费且只能消费一次
    const second = captcha.challenge()
    const good = captcha.verify(second.id, 100 + 5)
    expect(good.ok).toBe(true)
    expect(typeof good.token).toBe('string')

    expect(captcha.consume(good.token)).toBe(true)
    expect(captcha.consume(good.token)).toBe(false)
  })

  it('过期挑战与过期令牌都过不去', () => {
    const captcha = fixedCaptcha({ ttlMs: -1 })
    const { id } = captcha.challenge()
    expect(captcha.verify(id, 100)).toEqual({ ok: false, reason: 'expired' })

    const passed = fixedCaptcha({ passTtlMs: -1 })
    const token = passed.verify(passed.challenge().id, 100).token
    expect(passed.consume(token)).toBe(false)
  })

  it('签名不符（伪造/异密钥）的令牌被拒', () => {
    const a = fixedCaptcha({ secret: 'a' })
    const b = fixedCaptcha({ secret: 'b' })

    expect(a.consume('abc.123.not-the-signature')).toBe(false)

    const token = a.verify(a.challenge().id, 100).token
    expect(b.consume(token)).toBe(false)
    expect(a.consume(token)).toBe(true)
  })

  it('拼图块 SVG 自带渐变定义，不悬空引用背景的 defs', () => {
    const challenge = fixedCaptcha().challenge()
    const svg = Buffer.from(challenge.piece.split(',')[1], 'base64').toString('utf8')
    // 块是独立 <img> 文档：渐变必须定义在自己内部，否则整块底色不渲染（隐形）
    expect(svg).toContain('<linearGradient')
    expect(svg).toContain('<clipPath')
    // 描边让块在拖动中可见
    expect(svg).toContain('stroke=')
  })

  it('未完成挑战超过内存上限时淘汰最早的', () => {
    const captcha = fixedCaptcha({ maxPending: 2 })

    const evicted = captcha.challenge()
    captcha.challenge()
    captcha.challenge() // 挤掉第一张

    expect(captcha.verify(evicted.id, 100)).toEqual({ ok: false, reason: 'invalid' })
  })
})
