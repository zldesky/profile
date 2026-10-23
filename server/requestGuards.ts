/**
 * 请求层的认证、来源校验与配额。
 *
 * 这些逻辑原先内联在 index.ts 里，只能靠起真服务间接验证；抽成工厂后依赖全部注入，
 * 因此不需要监听端口、不碰真实数据库即可直测 —— 而它们恰好是本服务的安全边界：
 * 来源校验（CSRF / DNS rebinding）、会话解析（伪造与吊销）、双层配额（成本兜底）。
 *
 * 约定：所有中间件都遵循 Express 的 (req, res, next) 形状；
 * 拒绝时直接写响应，不再调用 next()。
 */

import { randomUUID } from 'node:crypto'

import { readPassword } from './auth.ts'

/** 会话 Cookie 名。只放随机令牌，真正的内容在服务端会话表里 */
export const SESSION_COOKIE = 'rs_session'
export const SESSION_TTL_DAYS = 30

/** 脚本口令（Bearer）使用者的配额主体 */
export const BEARER_SUBJECT = 'bearer'
/** 全站配额在配额表里的主体键 */
export const GLOBAL_SUBJECT = '__global__'

/** 请求对象中我们真正用到的部分：避免为此引入 express 类型依赖 */
export interface MinimalRequest {
  method?: string
  path?: string
  secure?: boolean
  get: (name: string) => unknown
  /** 由 requireAuth 写入的登录态 */
  auth?: AuthInfo
}

export interface MinimalResponse {
  status: (code: number) => MinimalResponse
  json: (body: unknown) => unknown
  cookie: (name: string, value: string, options: Record<string, unknown>) => unknown
  clearCookie: (name: string, options: Record<string, unknown>) => unknown
  on?: (event: string, handler: () => void) => unknown
  statusCode?: number
  setHeader?: (name: string, value: string) => unknown
}

export type NextFn = () => void

/**
 * 登录态。
 *
 * 刻意写成可辨识联合而不是 `{ kind: 'session' | 'bearer'; userId: number | null }`：
 * 后者在任何地方取 userId 都要额外判空，而「会话通道必有 userId、脚本口令通道必无」
 * 本来就是类型已知的事实。写成联合后，`req.auth.kind === 'session'` 一处判断即可让
 * 后续的 userId 收窄为 number，路由里那些手写的收窄判断也才有类型上的意义。
 */
export type AuthInfo =
  | { kind: 'session'; token: string; userId: number; subject: string }
  | { kind: 'bearer'; userId: null; subject: string }

/** 会话守卫与配额只需要数据库的这几个方法 */
export interface GuardDb {
  findSession: (token: string) => { user_id: number } | null
  isAdminUser: (userId: number) => boolean
  quotaUsed: (subject: string, day: string) => number
  quotaDaysUsed: (day: string) => number
  quotaConsume: (subject: string, day: string) => void
  quotaRefund: (subject: string, day: string) => void
}

export interface PasswordGuardLike {
  enabled: boolean
  verify: (input: unknown) => 'ok' | 'missing' | 'bad' | 'locked'
  lockedMs: () => number
}

export interface RequestGuardOptions {
  db: GuardDb
  /** 访问口令守卫；未启用时 Bearer 通道整体不存在 */
  guard: PasswordGuardLike
  /** 允许的请求来源；集合之外一律 403 */
  allowedOrigins: Iterable<string>
  /** 单用户每日导出上限 */
  userDailyLimit: number
  /** 全站每日上限（成本兜底） */
  globalDailyLimit: number
  /** Cookie 的 Secure 判定所需；代理场景由 TRUST_PROXY 决定 req.secure */
  sessionTtlDays?: number
  sessionCookieName?: string
  /** 生成「今天」的键，默认按本机时区自然日 */
  todayKey?: () => string
  /** 请求日志出口，默认 console.log（测试可注入以断言或静音） */
  log?: (line: string) => void
}

export interface QuotaStatus {
  day: string
  limit: number
  used: number
  remaining: number
}

export interface RequestGuards {
  checkOrigin: (req: MinimalRequest, res: MinimalResponse, next: NextFn) => void
  setSessionCookie: (req: MinimalRequest, res: MinimalResponse, token: string) => void
  clearSessionCookie: (res: MinimalResponse) => void
  readSessionUser: (req: MinimalRequest) => AuthInfo | null
  requireAuth: (req: MinimalRequest, res: MinimalResponse, next: NextFn) => void
  requireAdmin: (req: MinimalRequest, res: MinimalResponse, next: NextFn) => void
  requestLogger: (req: MinimalRequest, res: MinimalResponse, next: NextFn) => void
  todayKey: () => string
  quotaStatus: (subject: string) => QuotaStatus
  quotaConsume: (subject: string) => void
  quotaRefund: (subject: string) => void
}

function defaultTodayKey(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function createRequestGuards(options: RequestGuardOptions): RequestGuards {
  const {
    db,
    guard,
    allowedOrigins,
    userDailyLimit,
    globalDailyLimit,
    sessionTtlDays = SESSION_TTL_DAYS,
    sessionCookieName = SESSION_COOKIE,
    todayKey = defaultTodayKey,
    log = (line: string) => console.log(line),
  } = options

  const allowed = new Set(allowedOrigins)

  /**
   * 来源校验。
   *
   * 浏览器发起的跨站请求一定会带 Origin，因此拒绝未知来源即可阻断恶意页面
   * 调用本服务，也能挡住把域名解析到 127.0.0.1 的 DNS rebinding 攻击。
   * 不带 Origin 的请求（curl、脚本、服务内部调用）放行。
   */
  function checkOrigin(req: MinimalRequest, res: MinimalResponse, next: NextFn): void {
    const origin = req.get('origin')
    const originText = typeof origin === 'string' ? origin : ''
    if (!originText || allowed.has(originText)) return next()
    res.status(403).json({ ok: false, message: '请求来源不被允许' })
  }

  /** 为响应设置会话 Cookie。Secure 跟随实际协议，代理场景需 TRUST_PROXY=1 */
  function setSessionCookie(req: MinimalRequest, res: MinimalResponse, token: string): void {
    res.cookie(sessionCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(req.secure),
      path: '/',
      maxAge: sessionTtlDays * 24 * 60 * 60 * 1000,
    })
  }

  function clearSessionCookie(res: MinimalResponse): void {
    res.clearCookie(sessionCookieName, { path: '/' })
  }

  /**
   * 从请求解析登录态。Cookie 里的令牌只对应服务端会话，
   * 库里查不到（过期、被吊销、伪造）一律视为未登录。
   */
  function readSessionUser(req: MinimalRequest): AuthInfo | null {
    const cookieHeader = req.get('cookie')
    const token = parseCookieToken(typeof cookieHeader === 'string' ? cookieHeader : undefined)
    if (!token) return null
    const session = db.findSession(token)
    if (!session) return null
    return {
      kind: 'session',
      token,
      userId: session.user_id,
      subject: `user:${session.user_id}`,
    }
  }

  /** 只取需要的那个 Cookie，避免为一个解析器引入 cookie-parser */
  function parseCookieToken(header: string | undefined): string {
    if (!header) return ''
    for (const part of header.split(';')) {
      const index = part.indexOf('=')
      if (index < 0) continue
      if (part.slice(0, index).trim() !== sessionCookieName) continue
      try {
        return decodeURIComponent(part.slice(index + 1).trim())
      } catch {
        /* 编码非法的 Cookie 视为没有 */
        return ''
      }
    }
    return ''
  }

  /**
   * 统一认证中间件：会话 Cookie 或脚本口令（Bearer）二选一。
   * 都不成立时区分「需要登录」与「口令错误」，前端按此分流处理。
   */
  function requireAuth(req: MinimalRequest, res: MinimalResponse, next: NextFn): void {
    const session = readSessionUser(req)
    if (session) {
      req.auth = session
      return next()
    }

    // Bearer 是给脚本用的备用通道：只在显式设置口令时存在，
    // 否则未设口令的 verify 会恒返回 ok，匿名请求就会全部冒充成脚本放行
    if (guard.enabled) {
      const result = guard.verify(
        readPassword(req as { get: (name: string) => string | undefined }),
      )
      if (result === 'ok') {
        req.auth = { kind: 'bearer', userId: null, subject: BEARER_SUBJECT }
        return next()
      }

      if (result === 'locked') {
        const minutes = Math.max(1, Math.ceil(guard.lockedMs() / 60000))
        res.status(429).json({ ok: false, message: `口令连续错误过多，请 ${minutes} 分钟后再试` })
        return
      }

      if (result === 'bad') {
        res.status(401).json({ ok: false, message: '访问口令不正确' })
        return
      }
    }

    res.status(401).json({ ok: false, loginRequired: true, message: '请先登录后使用' })
  }

  /** 管理员专用中间件：必须是会话登录且用户行 role = admin（脚本口令通道无角色） */
  function requireAdmin(req: MinimalRequest, res: MinimalResponse, next: NextFn): void {
    if (
      req.auth?.kind === 'session' &&
      req.auth.userId !== null &&
      db.isAdminUser(req.auth.userId)
    ) {
      return next()
    }
    res.status(403).json({ ok: false, adminRequired: true, message: '该操作仅限管理员账号' })
  }

  /**
   * 请求日志：一行 JSON，只记 /api（静态资源没有排查价值还刷屏）。
   *
   * 每条响应都带一个 `X-Request-Id`，并原样记进日志。
   * 起因是「用户说某次导出失败了」这种报障：日志里只有一条条匿名记录，
   * 无法和用户遇到的那一次对应上。有了请求 ID，让用户从浏览器网络面板里复制一个值，
   * 就能在几百行日志里精确找到那一条 —— 也就能看到耗时、状态码、是不是配额用尽。
   *
   * 用 `crypto.randomUUID()` 而不用计数器：多实例部署时计数器会撞车，
   * 而撞车的 ID 比没有 ID 更糟（会指向错误的请求）。
   */
  function requestLogger(req: MinimalRequest, res: MinimalResponse, next: NextFn): void {
    if (!String(req.path || '').startsWith('/api')) return next()

    const requestId = randomUUID()
    res.setHeader?.('X-Request-Id', requestId)

    const startedAt = Date.now()
    res.on?.('finish', () => {
      if (req.path === '/api/health') return
      log(
        JSON.stringify({
          t: new Date().toISOString(),
          rid: requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - startedAt,
        }),
      )
    })
    next()
  }

  /** 取当前主体的配额状态 */
  function quotaStatus(subject: string): QuotaStatus {
    const day = todayKey()
    const isGlobal = subject === GLOBAL_SUBJECT
    const limit = isGlobal ? globalDailyLimit : userDailyLimit
    const used = isGlobal ? db.quotaDaysUsed(day) : db.quotaUsed(subject, day)
    return { day, limit, used, remaining: Math.max(0, limit - used) }
  }

  /** 计数 +1；只扣不判，判定由调用方先做（同步执行，无竞态） */
  function quotaConsume(subject: string): void {
    db.quotaConsume(subject, todayKey())
  }

  function quotaRefund(subject: string): void {
    db.quotaRefund(subject, todayKey())
  }

  return {
    checkOrigin,
    setSessionCookie,
    clearSessionCookie,
    readSessionUser,
    requireAuth,
    requireAdmin,
    requestLogger,
    todayKey,
    quotaStatus,
    quotaConsume,
    quotaRefund,
  }
}
