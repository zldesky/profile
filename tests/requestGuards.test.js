import { describe, expect, it, vi } from 'vitest'

import { createRequestGuards, BEARER_SUBJECT, GLOBAL_SUBJECT } from '../server/requestGuards.ts'

/**
 * 请求守卫的单测。
 *
 * 这些逻辑原先内联在 index.js 里，只靠起真服务间接验证。它们恰是本服务的安全边界：
 * 来源校验（CSRF / DNS rebinding）、会话解析（伪造与吊销）、双层配额（成本兜底），
 * 因此值得把每种拒绝路径都钉住 —— 尤其是「不该放行时到底放行了没有」。
 */

/** 构造一个最小请求对象 */
function makeReq({ cookies = '', authorization = '', origin, path, method = 'GET', secure } = {}) {
  return {
    method,
    path,
    secure,
    get(name) {
      const key = String(name).toLowerCase()
      if (key === 'cookie') return cookies || undefined
      if (key === 'authorization') return authorization || undefined
      if (key === 'origin') return origin
      return undefined
    },
  }
}

/** 构造一个最小响应对象，记录状态码与响应体 */
function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    cookies: [],
    cleared: [],
    status(code) {
      res.statusCode = code
      return res
    },
    json(payload) {
      res.body = payload
      return res
    },
    cookie(name, value, options) {
      res.cookies.push({ name, value, options })
      return res
    },
    clearCookie(name, options) {
      res.cleared.push({ name, options })
      return res
    },
    on() {
      return res
    },
  }
  return res
}

/** 建一套守卫；db 默认是「没有任何会话、配额全空」的替身 */
function makeGuards(overrides = {}) {
  const db = {
    findSession: () => null,
    isAdminUser: () => false,
    quotaUsed: () => 0,
    quotaDaysUsed: () => 0,
    quotaConsume: vi.fn(),
    quotaRefund: vi.fn(),
    ...overrides.db,
  }
  const guard = {
    enabled: false,
    verify: () => 'missing',
    lockedMs: () => 0,
    ...overrides.guard,
  }
  const guards = createRequestGuards({
    db,
    guard,
    allowedOrigins: overrides.allowedOrigins ?? ['http://localhost:3001'],
    userDailyLimit: overrides.userDailyLimit ?? 10,
    globalDailyLimit: overrides.globalDailyLimit ?? 100,
    todayKey: overrides.todayKey ?? (() => '2026-01-01'),
    log: overrides.log ?? (() => {}),
  })
  return { guards, db, guard }
}

/** 跑一个中间件，返回是否调用了 next */
function run(middleware, req, res) {
  let nexted = false
  middleware(req, res, () => {
    nexted = true
  })
  return nexted
}

describe('checkOrigin（CSRF / DNS rebinding 防线）', () => {
  it('放行允许的来源', () => {
    const { guards } = makeGuards()
    const res = makeRes()

    expect(run(guards.checkOrigin, makeReq({ origin: 'http://localhost:3001' }), res)).toBe(true)
    expect(res.statusCode).toBe(200)
  })

  it('拒绝未知来源（403）', () => {
    const { guards } = makeGuards()
    const res = makeRes()

    expect(run(guards.checkOrigin, makeReq({ origin: 'http://evil.example' }), res)).toBe(false)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ ok: false })
  })

  it('不带 Origin 的请求放行（curl / 脚本 / 服务内部调用）', () => {
    const { guards } = makeGuards()
    const res = makeRes()

    expect(run(guards.checkOrigin, makeReq({}), res)).toBe(true)
  })

  it('来源比对是精确匹配，不做前缀或子域放宽', () => {
    const { guards } = makeGuards({ allowedOrigins: ['https://resume.example'] })

    // 典型绕过尝试：多一段路径、换协议、加子域，都必须拒绝
    for (const origin of [
      'https://resume.example.evil.com',
      'http://resume.example',
      'https://sub.resume.example',
      'https://resume.example/',
    ]) {
      const res = makeRes()
      expect(run(guards.checkOrigin, makeReq({ origin }), res)).toBe(false)
      expect(res.statusCode).toBe(403)
    }
  })

  it('只放行显式加入的来源，不因为端口相同而放宽', () => {
    const { guards } = makeGuards({ allowedOrigins: ['http://127.0.0.1:5173'] })

    expect(run(guards.checkOrigin, makeReq({ origin: 'http://127.0.0.1:5173' }), makeRes())).toBe(
      true,
    )
    const res = makeRes()
    expect(run(guards.checkOrigin, makeReq({ origin: 'http://127.0.0.1:3001' }), res)).toBe(false)
    expect(res.statusCode).toBe(403)
  })
})

describe('会话 Cookie', () => {
  it('写入 httpOnly + lax + path=/ 且带 maxAge', () => {
    const { guards } = makeGuards()
    const res = makeRes()

    guards.setSessionCookie(makeReq({ secure: true }), res, 'tok-1')

    expect(res.cookies).toHaveLength(1)
    const [cookie] = res.cookies
    expect(cookie.name).toBe('rs_session')
    expect(cookie.value).toBe('tok-1')
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
    })
    expect(cookie.options.maxAge).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('Secure 跟随实际协议：明文连接下不设 secure（否则本地 http 登录会失败）', () => {
    const { guards } = makeGuards()
    const res = makeRes()

    guards.setSessionCookie(makeReq({ secure: false }), res, 'tok-1')

    expect(res.cookies[0].options.secure).toBe(false)
  })

  it('清除 Cookie 时带同样 path，避免留下无法覆盖的残留', () => {
    const { guards } = makeGuards()
    const res = makeRes()

    guards.clearSessionCookie(res)

    expect(res.cleared).toEqual([{ name: 'rs_session', options: { path: '/' } }])
  })
})

describe('readSessionUser（伪造与吊销都视为未登录）', () => {
  it('没有 Cookie 返回 null', () => {
    const { guards } = makeGuards()
    expect(guards.readSessionUser(makeReq({}))).toBeNull()
  })

  it('Cookie 里的令牌查不到会话时返回 null（伪造 / 已吊销 / 已过期）', () => {
    const { guards } = makeGuards({ db: { findSession: () => null } })

    expect(guards.readSessionUser(makeReq({ cookies: 'rs_session=fake' }))).toBeNull()
  })

  it('令牌有效时带出 userId 与配额主体', () => {
    const { guards } = makeGuards({ db: { findSession: () => ({ user_id: 7 }) } })

    const user = guards.readSessionUser(makeReq({ cookies: 'rs_session=tok' }))

    expect(user).toMatchObject({ kind: 'session', token: 'tok', userId: 7, subject: 'user:7' })
  })

  it('在多个 Cookie 中挑出会话那个，不受顺序影响', () => {
    const db = { findSession: vi.fn(() => ({ user_id: 3 })) }
    const { guards } = makeGuards({ db })

    guards.readSessionUser(makeReq({ cookies: 'theme=dark; rs_session=abc; lang=zh' }))

    expect(db.findSession).toHaveBeenCalledWith('abc')
  })

  it('Cookie 值经过 URL 解码', () => {
    const db = { findSession: vi.fn(() => ({ user_id: 3 })) }
    const { guards } = makeGuards({ db })

    guards.readSessionUser(makeReq({ cookies: 'rs_session=a%2Bb' }))

    expect(db.findSession).toHaveBeenCalledWith('a+b')
  })

  it('编码非法的 Cookie 视为没有，而不是抛错', () => {
    const { guards } = makeGuards()

    expect(() => guards.readSessionUser(makeReq({ cookies: 'rs_session=%E0%A4%A' }))).not.toThrow()
    expect(guards.readSessionUser(makeReq({ cookies: 'rs_session=%E0%A4%A' }))).toBeNull()
  })

  it('名字相近的 Cookie 不会被误当成会话', () => {
    const db = { findSession: vi.fn(() => null) }
    const { guards } = makeGuards({ db })

    guards.readSessionUser(makeReq({ cookies: 'xrs_session=abc; rs_session_old=def' }))

    expect(db.findSession).not.toHaveBeenCalled()
  })
})

describe('requireAuth', () => {
  it('有有效会话时放行并写入 req.auth', () => {
    const { guards } = makeGuards({ db: { findSession: () => ({ user_id: 5 }) } })
    const req = makeReq({ cookies: 'rs_session=tok' })
    const res = makeRes()

    expect(run(guards.requireAuth, req, res)).toBe(true)
    expect(req.auth).toMatchObject({ kind: 'session', userId: 5, subject: 'user:5' })
  })

  it('未登录且未启用口令时返回 401 且带 loginRequired（前端据此弹登录框）', () => {
    const { guards } = makeGuards({ guard: { enabled: false } })
    const res = makeRes()

    expect(run(guards.requireAuth, makeReq({}), res)).toBe(false)
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ ok: false, loginRequired: true })
  })

  it('未启用口令时，带了任意 Bearer 也不能放行（否则匿名请求会冒充脚本）', () => {
    const verify = vi.fn(() => 'ok')
    const { guards } = makeGuards({ guard: { enabled: false, verify } })
    const res = makeRes()

    expect(run(guards.requireAuth, makeReq({ authorization: 'Bearer anything' }), res)).toBe(false)
    expect(res.statusCode).toBe(401)
    // 关键：未启用时根本不该去校验口令
    expect(verify).not.toHaveBeenCalled()
  })

  it('启用口令且口令正确时以 bearer 主体放行', () => {
    const { guards } = makeGuards({ guard: { enabled: true, verify: () => 'ok' } })
    const req = makeReq({ authorization: 'Bearer secret' })
    const res = makeRes()

    expect(run(guards.requireAuth, req, res)).toBe(true)
    expect(req.auth).toMatchObject({ kind: 'bearer', userId: null, subject: BEARER_SUBJECT })
  })

  it('口令错误返回 401 且不提示 loginRequired（与「需要登录」区分开）', () => {
    const { guards } = makeGuards({ guard: { enabled: true, verify: () => 'bad' } })
    const res = makeRes()

    expect(run(guards.requireAuth, makeReq({ authorization: 'Bearer wrong' }), res)).toBe(false)
    expect(res.statusCode).toBe(401)
    expect(res.body).toMatchObject({ message: '访问口令不正确' })
    expect(res.body.loginRequired).toBeUndefined()
  })

  it('口令被锁定时返回 429 并给出剩余分钟数', () => {
    const { guards } = makeGuards({
      guard: { enabled: true, verify: () => 'locked', lockedMs: () => 119000 },
    })
    const res = makeRes()

    expect(run(guards.requireAuth, makeReq({ authorization: 'Bearer x' }), res)).toBe(false)
    expect(res.statusCode).toBe(429)
    expect(res.body.message).toContain('2 分钟')
  })

  it('锁定剩余不足一分钟时至少提示 1 分钟，不显示 0', () => {
    const { guards } = makeGuards({
      guard: { enabled: true, verify: () => 'locked', lockedMs: () => 1000 },
    })
    const res = makeRes()

    run(guards.requireAuth, makeReq({ authorization: 'Bearer x' }), res)

    expect(res.body.message).toContain('1 分钟')
  })

  it('未带口令（missing）走「需要登录」分支而不是「口令错误」', () => {
    const { guards } = makeGuards({ guard: { enabled: true, verify: () => 'missing' } })
    const res = makeRes()

    run(guards.requireAuth, makeReq({}), res)

    expect(res.statusCode).toBe(401)
    expect(res.body.loginRequired).toBe(true)
  })

  it('会话优先于口令：同时带上时按会话身份处理', () => {
    const verify = vi.fn(() => 'ok')
    const { guards } = makeGuards({
      db: { findSession: () => ({ user_id: 9 }) },
      guard: { enabled: true, verify },
    })
    const req = makeReq({ cookies: 'rs_session=tok', authorization: 'Bearer secret' })

    run(guards.requireAuth, req, makeRes())

    expect(req.auth).toMatchObject({ kind: 'session', userId: 9 })
    expect(verify).not.toHaveBeenCalled()
  })
})

describe('requireAdmin', () => {
  it('会话登录且 role=admin 时放行', () => {
    const { guards } = makeGuards({ db: { isAdminUser: () => true } })
    const req = makeReq()
    req.auth = { kind: 'session', userId: 1, subject: 'user:1' }

    expect(run(guards.requireAdmin, req, makeRes())).toBe(true)
  })

  it('普通用户返回 403', () => {
    const { guards } = makeGuards({ db: { isAdminUser: () => false } })
    const req = makeReq()
    req.auth = { kind: 'session', userId: 2, subject: 'user:2' }
    const res = makeRes()

    expect(run(guards.requireAdmin, req, res)).toBe(false)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ adminRequired: true })
  })

  it('脚本口令通道不算管理员（它没有角色）', () => {
    const isAdminUser = vi.fn(() => true)
    const { guards } = makeGuards({ db: { isAdminUser } })
    const req = makeReq()
    req.auth = { kind: 'bearer', userId: null, subject: BEARER_SUBJECT }
    const res = makeRes()

    expect(run(guards.requireAdmin, req, res)).toBe(false)
    expect(res.statusCode).toBe(403)
    // 关键：bearer 不该去查角色，否则等于给脚本通道开了管理员权限
    expect(isAdminUser).not.toHaveBeenCalled()
  })

  it('未认证时返回 403（该中间件总是跟在 requireAuth 之后）', () => {
    const { guards } = makeGuards()
    const res = makeRes()

    expect(run(guards.requireAdmin, makeReq(), res)).toBe(false)
    expect(res.statusCode).toBe(403)
  })
})

describe('双层配额', () => {
  it('普通主体用单用户上限', () => {
    const { guards } = makeGuards({ userDailyLimit: 10, globalDailyLimit: 100 })

    expect(guards.quotaStatus('user:1')).toMatchObject({ limit: 10, day: '2026-01-01' })
  })

  it('全站主体用全站上限，并读全站当日总量', () => {
    const quotaUsed = vi.fn(() => 3)
    const quotaDaysUsed = vi.fn(() => 42)
    const { guards } = makeGuards({
      userDailyLimit: 10,
      globalDailyLimit: 100,
      db: { quotaUsed, quotaDaysUsed },
    })

    const status = guards.quotaStatus(GLOBAL_SUBJECT)

    expect(status).toMatchObject({ limit: 100, used: 42, remaining: 58 })
    expect(quotaDaysUsed).toHaveBeenCalledWith('2026-01-01')
    expect(quotaUsed).not.toHaveBeenCalled()
  })

  it('剩余量不会为负（超发时显示 0 而不是负数）', () => {
    const { guards } = makeGuards({ userDailyLimit: 10, db: { quotaUsed: () => 15 } })

    expect(guards.quotaStatus('user:1').remaining).toBe(0)
  })

  it('恰好用完时剩余为 0', () => {
    const { guards } = makeGuards({ userDailyLimit: 10, db: { quotaUsed: () => 10 } })

    expect(guards.quotaStatus('user:1')).toMatchObject({ used: 10, remaining: 0 })
  })

  it('consume / refund 都按当天记账', () => {
    const { guards, db } = makeGuards({ todayKey: () => '2026-02-03' })

    guards.quotaConsume('user:1')
    guards.quotaRefund('user:1')

    expect(db.quotaConsume).toHaveBeenCalledWith('user:1', '2026-02-03')
    expect(db.quotaRefund).toHaveBeenCalledWith('user:1', '2026-02-03')
  })

  it('跨天后不再计入（day 直接参与查询键）', () => {
    let day = '2026-01-01'
    const { guards } = makeGuards({ todayKey: () => day })

    expect(guards.quotaStatus('user:1').day).toBe('2026-01-01')
    day = '2026-01-02'
    expect(guards.quotaStatus('user:1').day).toBe('2026-01-02')
  })

  it('默认 todayKey 产出本机时区的 YYYY-MM-DD', () => {
    const { guards } = makeGuards({ todayKey: undefined })
    // 覆盖掉注入值：直接重建一个用默认实现的守卫
    const real = createRequestGuards({
      db: {
        findSession: () => null,
        isAdminUser: () => false,
        quotaUsed: () => 0,
        quotaDaysUsed: () => 0,
        quotaConsume: () => {},
        quotaRefund: () => {},
      },
      guard: { enabled: false, verify: () => 'missing', lockedMs: () => 0 },
      allowedOrigins: [],
      userDailyLimit: 1,
      globalDailyLimit: 1,
      log: () => {},
    })

    expect(real.todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(guards.quotaStatus('user:1').day).toBe('2026-01-01')
  })
})

describe('requestLogger', () => {
  it('非 /api 路径不记录也不阻断', () => {
    const log = vi.fn()
    const { guards } = makeGuards({ log })

    expect(run(guards.requestLogger, makeReq({ path: '/assets/app.js' }), makeRes())).toBe(true)
    expect(log).not.toHaveBeenCalled()
  })

  it('/api 请求在响应结束时记一行 JSON', () => {
    const log = vi.fn()
    const { guards } = makeGuards({ log })
    const req = makeReq({ path: '/api/resume' })
    const res = makeRes()
    // makeRes 的 on 是空实现，这里补一个能立即触发的版本
    res.on = (event, handler) => {
      if (event === 'finish') handler()
      return res
    }

    run(guards.requestLogger, req, res)

    expect(log).toHaveBeenCalledTimes(1)
    const line = JSON.parse(log.mock.calls[0][0])
    expect(line).toMatchObject({ path: '/api/resume', method: 'GET', status: 200 })
    expect(typeof line.ms).toBe('number')
  })

  it('/api/health 不记录（探活太频繁，刷屏且无排查价值）', () => {
    const log = vi.fn()
    const { guards } = makeGuards({ log })
    const res = makeRes()
    res.on = (event, handler) => {
      if (event === 'finish') handler()
      return res
    }

    run(guards.requestLogger, makeReq({ path: '/api/health' }), res)

    expect(log).not.toHaveBeenCalled()
  })
})
