/**
 * 简历应用本地服务：静态站点 + 账号 + 云端简历 + PDF 渲染。
 *
 * 这个进程能起浏览器、能读本机文件、能生成 PDF，因此按「不可信输入」对待，
 * 安全基线如下：
 *  1. 默认只监听回环地址；对外暴露时 /api 一律要求登录（或脚本口令）；
 *  2. 校验 Origin，阻断跨站调用与 DNS rebinding，公网域名用 ALLOWED_ORIGINS 放行；
 *  3. 会话用服务端 Session + httpOnly Cookie，登录失败按「IP+用户名」锁定；
 *  4. 入参全量清洗：枚举白名单 + 文本剥离标签 + 数量与长度上限；
 *  5. 渲染并发有信号量，导出按「用户每日 + 全站每日」双层限配额；
 *  6. 渲染页面禁止访问外部源，注入内容无法外联。
 *
 * 配置统一从环境变量读取，可写在项目根的 .env（模板见 .env.example），
 * 由 npm run pdf 的 --env-file-if-exists 自动加载。
 * 开发模式下 Vite 跑在 5173，启动与本服务都会自动探测该地址。
 */
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import express from 'express'
import type { NextFunction, Request, Response } from 'express'

import { readJsonWithCap, resolveAiEndpoint } from './aiGuard.ts'
import {
  createLoginGuard,
  createPasswordGuard,
  createSessionToken,
  createSlidingWindowCounter,
  hashPassword,
  isLoopbackHost,
  readPassword,
  validateCredentials,
  verifyPassword,
} from './auth.ts'
import { createCaptcha } from './captcha.ts'
import { CATEGORY_KEYS, createDatabase } from './db.ts'
import { fetchRemoteImage } from './imageProxy.ts'
import {
  BEARER_SUBJECT,
  GLOBAL_SUBJECT,
  SESSION_TTL_DAYS,
  createRequestGuards,
} from './requestGuards.ts'
import type { AuthInfo } from './requestGuards.ts'
import {
  closeBrowser,
  ensureBrowser,
  getResolvedChannel,
  getRenderStats,
  renderResumePdf,
} from './render.ts'
import { sanitizeFilename, sanitizeResume } from './sanitize.ts'
import { EDITOR_PATH } from './renderTarget.ts'

/**
 * 给 Express 的 Request 补上 req.auth。
 * requireAuth 成功后写入它，后续路由据此取登录主体；用声明合并而不是到处断言，
 * 这样「谁写了 req.auth、谁在读」在类型上是一致的。
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo
    }
  }
}

/** 读取失败时的可读信息：catch 到的 error 在 strict 下是 unknown */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 带 error.code 的错误（SQLite 唯一约束、网络错误码等） */
function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

/** 解析 AI 上游返回的 JSON 时用的宽松形状：字段不可信，逐层收窄 */
type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {}
}

/**
 * 取会话登录态。
 *
 * 挂在 requireAuth 之后的路由里，req.auth 一定有值（会话通道）；管理员路由更是
 * 只可能是会话（bearer 无角色）。这里把该前提收敛到一个显式断言，避免在十几处
 * 路由里各写一次 `!`，也让「什么条件下 userId 必然存在」有唯一出处。
 */
function sessionAuth(req: Request): { userId: number; subject: string } {
  const auth = req.auth
  if (!auth || auth.userId === null) {
    // 代码路径上不可达：requireAuth 已拦截无登录态的请求
    throw Object.assign(new Error('缺少登录态'), { statusCode: 500 })
  }
  return { userId: auth.userId, subject: auth.subject }
}

/**
 * 取配额主体 —— 会话与脚本口令两条通道都有。
 *
 * 导出、图片代抓、AI 转发这三个端点对两种通道都开放，因此只能依赖 subject
 * （脚本口令通道没有 userId）。这里若误用 sessionAuth，脚本调用会直接 500 ——
 * 之前就踩过这个坑，故单列一个函数把差别写明。
 */
function subjectOf(req: Request): string {
  const auth = req.auth
  if (!auth) {
    // 代码路径上不可达：requireAuth 已拦截无登录态的请求
    throw Object.assign(new Error('缺少登录态'), { statusCode: 500 })
  }
  return auth.subject
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001
const DEV_PORT = Number(process.env.DEV_PORT) || 5173
/** 只监听回环地址，避免把带浏览器能力的服务暴露到局域网 */
const HOST = process.env.HOST || '127.0.0.1'

/** 单用户每日导出上限；全站每日兜底是成本上限，应高于单用户上限之和的常态 */
const USER_DAILY_LIMIT = Number(process.env.PDF_USER_DAILY_LIMIT) || 10
const GLOBAL_DAILY_LIMIT = Number(process.env.PDF_DAILY_LIMIT) || 100
/** 分享链接有效期（天）与创建频率限制：防滥用刷库 */
const SHARE_TTL_DAYS = Number(process.env.SHARE_TTL_DAYS) || 30
/** 简历合集分页大小与游客可见条数；「登录查看更多」由服务端截断，前端只做展示 */
const COLLECTION_PAGE_SIZE = Number(process.env.COLLECTION_PAGE_SIZE) || 12
const COLLECTION_GUEST_VISIBLE = Number(process.env.COLLECTION_GUEST_VISIBLE) || 6
const shareLimiter = createSlidingWindowCounter({ max: 20, windowMs: 60 * 60 * 1000 })
/** AI 转发按主体限频：Key 是用户自己的，限频保护的是上游服务与本机带宽 */
const aiLimiter = createSlidingWindowCounter({ max: 60, windowMs: 60 * 60 * 1000 })
/** 图片代抓同频限频：它是另一个重出网端点，不能成为唯一没有闸门的出口 */
const imageLimiter = createSlidingWindowCounter({ max: 60, windowMs: 60 * 60 * 1000 })

/** 库文件路径可用环境变量覆盖；测试与多实例部署时用得上 */
const db = createDatabase({
  filePath: process.env.DB_PATH || path.join(__dirname, '.data', 'app.db'),
})

/** 访问口令。留空表示不启用 Bearer 通道，账号登录不受影响。 */
const guard = createPasswordGuard({ password: process.env.PDF_ACCESS_PASSWORD })

/** 登录失败锁定与注册频率限制（内存态，重启清零；对爆破而言足够） */
const loginGuard = createLoginGuard()
/**
 * 注册限频。默认每小时 5 次/IP，可用 REGISTER_LIMIT 调整。
 *
 * 做成可配有两个实际理由：家庭/公司网络下多人在同一出口 IP，5 次很容易误伤；
 * 而集成测试要从同一 IP 造多个账号。取值做了上下界保护 ——
 * 设成 0 或负数会让**所有人都无法注册**，那是个很难排查的部署故障，
 * 所以下限固定为 1；上限只是防止把防线写成摆设。
 */
const REGISTER_LIMIT = Math.min(1000, Math.max(1, Number(process.env.REGISTER_LIMIT) || 5))
const registerLimiter = createSlidingWindowCounter({
  max: REGISTER_LIMIT,
  windowMs: 60 * 60 * 1000,
})

/**
 * 注册用的滑块验证码。密钥缺省时每次启动随机生成：
 * 挑战与通过令牌本来就只活几分钟，重启作废无碍；
 * 多实例部署才需要显式传 CAPTCHA_SECRET 保证签名一致。
 */
const captcha = createCaptcha({ secret: process.env.CAPTCHA_SECRET })

/**
 * 注册滑块验证的开关（默认开启）。
 *
 * 给自托管留一条明确的路：内部部署、CI、集成测试常常不需要人机防线，
 * 而没有一个正当开关时，那些场景只能去改代码或伪造令牌。
 * 只影响**注册**这一步的校验；/api/captcha 与 /api/captcha/verify 仍然照常工作，
 * 这样关掉后行为可预期，也不会让前端拿到 404。
 * 供 CI / 集成测试使用：CAPTCHA_ENABLED=off。
 */
const CAPTCHA_REQUIRED = !/^(off|false|0)$/i.test(String(process.env.CAPTCHA_ENABLED ?? '').trim())

/**
 * 登录/注册弹窗交互开关（AUTH_POPUP=off|false|0 关闭，默认开启）。
 * 只影响前端交互形态：开启时点「登录/注册」与未登录一键导出在当前页弹窗；
 * 关闭时回退为跳转独立登录页。经 /api/health 下发给前端。
 */
const AUTH_POPUP_ENABLED = !/^(off|false|0)$/i.test(String(process.env.AUTH_POPUP ?? '').trim())

/** 用户不存在时也走一次 scrypt，抹平「用户不存在」与「密码错误」的耗时差 */
const DUMMY_HASH = hashPassword(createSessionToken())

/**
 * 反向代理场景下必须显式声明信任层数，req.secure / req.ip 才按
 * X-Forwarded-* 解析。只在确认前面有自家代理时开启，否则客户端可伪造头绕过限流。
 * （在下方 app 创建之后设置。）
 */

/** 生产模式下静态应用的内容安全策略，作为注入失败后的兜底 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // 主题大量使用内联 :style 绑定 CSS 变量，必须允许内联样式
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** 允许的请求来源：本服务自身、本地开发服务器，以及环境变量显式放行的域名 */
const ALLOWED_ORIGINS = new Set(
  LOCAL_HOSTS.flatMap((host) => [`http://${host}:${PORT}`, `http://${host}:${DEV_PORT}`]),
)

// 公网部署（反向代理 + 域名）时，浏览器的 Origin 是外部域名，
// 必须在这里放行，否则登录与导出全部会被 403
for (const raw of String(process.env.ALLOWED_ORIGINS || '').split(',')) {
  const origin = raw.trim()
  if (!origin) continue
  try {
    ALLOWED_ORIGINS.add(new URL(origin).origin)
  } catch {
    console.warn(`[server] ALLOWED_ORIGINS 中有非法来源，已忽略：${origin}`)
  }
}

/**
 * 请求层的认证、来源校验与配额。实现已抽到 requestGuards.ts（那边有 38 例单测），
 * 这里只负责把本进程的 db / 口令守卫 / 来源白名单注入进去。
 * 必须在 ALLOWED_ORIGINS 之后创建 —— 它要读这个白名单。
 */
const guards = createRequestGuards({
  db,
  guard,
  allowedOrigins: ALLOWED_ORIGINS,
  userDailyLimit: USER_DAILY_LIMIT,
  globalDailyLimit: GLOBAL_DAILY_LIMIT,
})

/** 渲染源探测结果缓存，避免每个请求都去探测 */
const RENDER_URL_TTL = 5000
let renderUrlCache = { value: '', at: 0 }

/**
 * 优先探测开发服务器，保证导出结果与编辑器里看到的一致。
 * Vite 默认只监听 localhost（在启用 IPv6 的机器上会解析到 ::1），
 * 因此三种写法都要试，不能只试 127.0.0.1。
 */
async function detectRenderUrl() {
  if (process.env.RENDER_URL) return process.env.RENDER_URL

  const candidates = LOCAL_HOSTS.map((host) => `http://${host}:${DEV_PORT}${EDITOR_PATH}`)
  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return url
    } catch {
      /* 该地址不通，换下一个 */
    }
  }

  return `http://127.0.0.1:${PORT}${EDITOR_PATH}`
}

/**
 * 按需解析渲染源并做短时缓存。
 * 不在启动时固定，避免「先起服务后起 Vite」导致一直渲染旧构建。
 */
async function getRenderUrl() {
  const now = Date.now()
  if (renderUrlCache.value && now - renderUrlCache.at < RENDER_URL_TTL) {
    return renderUrlCache.value
  }

  const value = await detectRenderUrl()
  if (value !== renderUrlCache.value) {
    // 显式指定渲染源时，它的来源也要加入白名单
    if (process.env.RENDER_URL) ALLOWED_ORIGINS.add(new URL(value).origin)
    console.log(`渲染数据源：\u3000${value}`)
  }
  renderUrlCache = { value, at: now }
  return value
}

const app = express()

// 必须在定义路由之前设置；'true' 与 '1' 都表示一层代理
if (process.env.TRUST_PROXY) {
  app.set(
    'trust proxy',
    process.env.TRUST_PROXY === 'true' ? 1 : Number(process.env.TRUST_PROXY) || 0,
  )
}

app.disable('x-powered-by')
app.use(guards.requestLogger)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

// 来源校验与认证都排在请求体解析之前：未通过校验的请求不该消耗内存去解析大 body
app.use(guards.checkOrigin)

/**
 * 服务状态。不要求登录即可调用：前端必须先知道「登录态与额度」，
 * 才能决定渲染哪个界面。额度、渲染内核等信息只回给已认证的调用方。
 */
app.get('/api/health', async (req, res) => {
  const session = guards.readSessionUser(req)
  // 会话分支才有用户行；health 只在会话时返回用户名
  const sessionUserId = session?.kind === 'session' ? session.userId : null
  const bearerOk = guard.enabled && guard.verify(readPassword(req)) === 'ok'
  const subject = session?.subject || (bearerOk ? BEARER_SUBJECT : null)

  res.json({
    ok: true,
    loginEnabled: true,
    authPopup: AUTH_POPUP_ENABLED,
    authRequired: guard.enabled,
    user: session
      ? { id: sessionUserId, username: db.findUserById(sessionUserId as number)?.username || '' }
      : null,
    ...(subject
      ? {
          quota: guards.quotaStatus(subject),
          globalQuota: guards.quotaStatus(GLOBAL_SUBJECT),
          renderUrl: await getRenderUrl(),
          browser: getResolvedChannel() || null,
        }
      : {}),
  })
})

app.use(express.json({ limit: '8mb' }))

/* ---------------- 滑块验证码 ---------------- */

/** 发起挑战。缺口坐标只留在内存里，响应里只有图形与块的纵坐标 */
app.get('/api/captcha', (req, res) => {
  res.json({ ok: true, ...captcha.challenge() })
})

/** 校验拖动结果：落进容差才换发一次性通过令牌 */
app.post('/api/captcha/verify', (req, res) => {
  const { id, x } = req.body || {}
  const result = captcha.verify(id, x)

  if (!result.ok) {
    const message =
      result.reason === 'expired' ? '验证已过期，请重新拖动' : '验证未通过，请重新拖动'
    res.status(400).json({ ok: false, message })
    return
  }

  res.json({ ok: true, token: result.token })
})

/* ---------------- 账号 ---------------- */

/**
 * 注册并直接登录。
 * 人机防线两层：滑块验证码（每次注册消耗一个通过令牌）+ 按 IP 限频
 * （每小时 5 次）。防脚本批量建号；个人部署如需收紧，
 * 可用反代再加一层，或改为注册邀请码。
 */
app.post('/api/auth/register', (req, res, next) => {
  const { username, password, captchaToken } = req.body || {}

  const invalid = validateCredentials(username, password)
  if (invalid) {
    res.status(400).json({ ok: false, message: invalid })
    return
  }

  // 滑块验证放在限频之前：没通过验证的请求不去占用每小时注册额度
  if (CAPTCHA_REQUIRED && !captcha.consume(captchaToken)) {
    res.status(400).json({
      ok: false,
      captchaRequired: true,
      message: '滑块验证未通过或已过期，请重新完成验证',
    })
    return
  }

  const ip = req.ip || 'unknown'
  if (!registerLimiter.tryTake(ip)) {
    res.status(429).json({ ok: false, message: '注册过于频繁，请一小时后再试' })
    return
  }

  try {
    const user = db.createUser(username, hashPassword(password))
    const token = createSessionToken()
    db.createSession(user.id, token)
    guards.setSessionCookie(req, res, token)
    res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } })
  } catch (error) {
    // 用户名冲突体现为唯一约束错误（预检查仍有并发窗口，这里兜底转成可读提示）
    const text = errorCode(error) + errorMessage(error)
    if (text.includes('SQLITE_CONSTRAINT') || text.includes('UNIQUE')) {
      res.status(409).json({ ok: false, message: '用户名已被占用' })
      return
    }
    next(error)
  }
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  // 凭证格式不对就别碰数据库与 scrypt，但要给与失败一致的模糊响应
  if (validateCredentials(username, password)) {
    res.status(401).json({ ok: false, message: '用户名或密码不正确' })
    return
  }

  const ip = req.ip || 'unknown'
  const lockedMs = loginGuard.lockedMs(ip, username)
  if (lockedMs > 0) {
    const minutes = Math.max(1, Math.ceil(lockedMs / 60000))
    res.status(429).json({ ok: false, message: `失败次数过多，该账号 ${minutes} 分钟内无法登录` })
    return
  }

  const user = db.findUserByUsername(username)
  // 用户不存在也走一次摘要校验，登录耗时不再泄露「用户名是否存在」
  const ok = verifyPassword(password || '', user ? user.password_hash : DUMMY_HASH)
  if (!ok) {
    loginGuard.noteFailure(ip, username)
    res.status(401).json({ ok: false, message: '用户名或密码不正确' })
    return
  }

  if (!user) return
  loginGuard.reset(ip, username)
  // 登录是清理过期会话的自然时机，平时不安排后台任务
  db.purgeExpiredSessions()
  const token = createSessionToken()
  db.createSession(user.id, token)
  guards.setSessionCookie(req, res, token)
  res.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role || 'member' },
  })
})

app.post('/api/auth/logout', (req, res) => {
  // 用会话解析拿令牌，而不是自己再解析一次 Cookie：
  // 解析规则（Cookie 名、解码、非法值处理）只保留在 requestGuards 一处
  const session = guards.readSessionUser(req)
  if (session?.kind === 'session') db.deleteSession(session.token)
  guards.clearSessionCookie(res)
  res.json({ ok: true })
})

/** 登录态查询。恒为 200：前端用它决定渲染哪个界面，未登录不是错误 */
app.get('/api/auth/me', (req, res) => {
  const session = guards.readSessionUser(req)
  const sessionUserId = session?.kind === 'session' ? session.userId : null
  const profile = sessionUserId === null ? null : db.findUserById(sessionUserId)
  res.json({
    ok: true,
    authenticated: Boolean(session),
    user: profile ? { id: profile.id, username: profile.username, role: profile.role } : null,
  })
})

/* ---------------- 样式配置（管理后台编辑，编辑器运行时读取） ---------------- */

/** 与 src/data/presets.js 的枚举保持一致；漂移只影响新风格的合法值范围 */
const STYLE_TITLE_STYLES = [
  'fill',
  'pill',
  'gradient',
  'underline',
  'bar',
  'boxed',
  'center',
  'leader',
  'plain',
]
const STYLE_TITLE_MARKERS = ['square', 'diamond', 'circle', 'ring', 'triangle', 'bar', 'none']
const STYLE_TITLE_BOTTOMS = [
  'none',
  'solid',
  'dashed',
  'dotted',
  'gradient',
  'double',
  'trapezoid',
  'ribbon',
  'chevron',
]
const STYLE_FONT_KEYS = [
  'yahei',
  'sourceHei',
  'pingfang',
  'dengxian',
  'heiti',
  'sourceSong',
  'songti',
  'fangsong',
  'kaiti',
  'arial',
  'helvetica',
  'times',
  'georgia',
  'calibri',
]
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const STYLE_KEY_RE = /^[a-z0-9-]{1,24}$/
const STYLE_PRESET_MAX = 40

/** 读取运行时样式配置（公开：编辑器首次打开设计面板时拉取）；未配置时回 null，前端走内置默认 */
app.get('/api/styles', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ ok: true, config: db.getConfig('styleConfig') })
})

/** 管理后台读取完整配置（含未发布前为 null 的原始态） */
app.get('/api/styles-admin', guards.requireAuth, guards.requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ ok: true, config: db.getConfig('styleConfig') })
})

/**
 * 保存样式配置（全量覆盖）：风格预设列表 + 模板兼容矩阵。
 * 服务端只做结构与枚举校验，域逻辑（气质搭配）由后台维护者把关。
 */
app.put('/api/styles-admin', guards.requireAuth, guards.requireAdmin, (req, res) => {
  const { presets, matrix } = req.body || {}

  if (!Array.isArray(presets) || presets.length === 0 || presets.length > STYLE_PRESET_MAX) {
    res.status(400).json({ ok: false, message: '风格列表不合法（1-40 条）' })
    return
  }

  const seenKeys = new Set()
  for (const preset of presets) {
    const key = typeof preset.key === 'string' && preset.key ? preset.key : null
    const name = typeof preset.name === 'string' ? preset.name.trim() : ''
    const patch = preset.patch
    if ((key && !STYLE_KEY_RE.test(key)) || name.length < 1 || name.length > 20) {
      res.status(400).json({ ok: false, message: `风格「${name || key || '?'}」的键或名称不合法` })
      return
    }
    if (!patch || typeof patch !== 'object') {
      res.status(400).json({ ok: false, message: `风格「${name}」缺少样式参数` })
      return
    }
    if (!HEX_COLOR_RE.test(String(patch.accent || ''))) {
      res.status(400).json({ ok: false, message: `风格「${name}」的主色须为 #RRGGBB` })
      return
    }
    if (
      !STYLE_TITLE_STYLES.includes(patch.titleStyle) ||
      !STYLE_TITLE_MARKERS.includes(patch.titleMarker) ||
      !STYLE_TITLE_BOTTOMS.includes(patch.titleBottom) ||
      (patch.fontKey !== undefined && !STYLE_FONT_KEYS.includes(patch.fontKey))
    ) {
      res.status(400).json({
        ok: false,
        message: `风格「${name}」的标题样式 / 标记 / 底边线 / 字体不在可选范围`,
      })
      return
    }
    const finalKey = key || `s-${randomBytes(4).toString('hex')}`
    if (seenKeys.has(finalKey)) {
      res.status(400).json({ ok: false, message: `风格键「${finalKey}」重复` })
      return
    }
    seenKeys.add(finalKey)
    preset.key = finalKey
  }

  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    res.status(400).json({ ok: false, message: '兼容矩阵不合法' })
    return
  }
  for (const [templateId, keys] of Object.entries(matrix)) {
    if (!/^[a-z0-9-]{1,32}$/.test(templateId) || !Array.isArray(keys)) {
      res.status(400).json({ ok: false, message: `模板「${templateId}」的矩阵行不合法` })
      return
    }
    if (keys.some((key) => !seenKeys.has(key))) {
      res.status(400).json({ ok: false, message: `模板「${templateId}」引用了不存在的风格` })
      return
    }
  }

  db.setConfig('styleConfig', { presets, matrix })
  res.json({ ok: true })
})

/* ---------------- 云端简历（要求登录） ---------------- */

app.get('/api/resume', guards.requireAuth, (req, res) => {
  // 会话通道才有用户身份：脚本口令通道没有 userId，取出来直接拒绝
  const auth = sessionAuth(req)
  const stored = db.getResume(auth.userId)
  res.json({ ok: true, resume: stored?.resume ?? null, updatedAt: stored?.updatedAt ?? null })
})

app.put('/api/resume', guards.requireAuth, (req, res) => {
  // 会话通道才有用户身份：脚本口令通道没有 userId，取出来直接拒绝
  const auth = sessionAuth(req)

  // 与导出共用同一套清洗：入库的数据同样按「不可信输入」对待，
  // 条目 id 不入账（由前端 normalize 重新生成，避免客户端伪造重复 key）
  const sanitized = sanitizeResume(req.body?.resume)
  if (!sanitized.ok) {
    res.status(400).json({ ok: false, message: sanitized.error })
    return
  }

  const { updatedAt } = db.saveResume(auth.userId, sanitized.value)
  res.json({ ok: true, updatedAt })
})

/* ---------------- PDF 导出（要求登录或脚本口令） ---------------- */

/** PDF 缓存：同一份简历短时间内重复导出不再消耗浏览器与额度 */
const PDF_CACHE_TTL = 10 * 60 * 1000
const PDF_CACHE_MAX = 10
const pdfCache = new Map<string, { buffer: Buffer; at: number }>()

/** PDF 缓存键：同一份简历 + 文件名的重复导出，产物完全一致 */
function cacheKeyOf(resume: unknown, title: unknown): string {
  return createHash('sha256').update(JSON.stringify({ resume, title })).digest('hex')
}

app.post('/api/pdf', guards.requireAuth, async (req, res) => {
  // 该端点对会话与脚本口令都开放，只能依赖 subject
  const subject = subjectOf(req)
  const { resume, filename } = req.body || {}

  // 先校验再扣额度：参数不合法属于调用方问题，不应消耗当天配额
  const sanitized = sanitizeResume(resume)
  if (!sanitized.ok) {
    res.status(400).json({ ok: false, message: sanitized.error })
    return
  }

  const safeName = `${sanitizeFilename(filename)}.pdf`
  const key = `${cacheKeyOf(sanitized.value, sanitizeFilename(filename))}`

  // 命中缓存直接返回：渲染零成本，也就不该扣额度
  const cached = pdfCache.get(key)
  if (cached && Date.now() - cached.at < PDF_CACHE_TTL) {
    cached.at = Date.now()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    )
    res.setHeader('X-Quota-Remaining', String(guards.quotaStatus(subject).remaining))
    res.setHeader('X-Pdf-Cache', 'hit')
    res.send(cached.buffer)
    return
  }
  if (cached) pdfCache.delete(key)

  // subject 已在处理器开头取出
  const userQuota = guards.quotaStatus(subject)
  if (userQuota.remaining <= 0) {
    res.status(429).json({
      ok: false,
      message: `今日导出额度已用完（每天 ${USER_DAILY_LIMIT} 次），额度在次日 0 点重置`,
      quota: userQuota,
    })
    return
  }

  const globalQuota = guards.quotaStatus(GLOBAL_SUBJECT)
  if (globalQuota.remaining <= 0) {
    res.status(429).json({
      ok: false,
      message: `服务今日导出总额度已用完（全站每天 ${GLOBAL_DAILY_LIMIT} 次），额度在次日 0 点重置`,
      quota: globalQuota,
    })
    return
  }

  guards.quotaConsume(subject)
  guards.quotaConsume(GLOBAL_SUBJECT)

  try {
    const pdf = await renderResumePdf({
      resume: sanitized.value,
      renderUrl: await getRenderUrl(),
      title: sanitizeFilename(filename),
    })

    // LRU：超上限时先丢最旧的
    if (pdfCache.size >= PDF_CACHE_MAX) {
      const oldest = [...pdfCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) pdfCache.delete(oldest[0])
    }
    pdfCache.set(key, { buffer: pdf, at: Date.now() })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    )
    res.setHeader('X-Quota-Remaining', String(guards.quotaStatus(subject).remaining))
    res.send(pdf)
  } catch (error) {
    // 渲染失败多数是服务端问题，归还额度
    guards.quotaRefund(subject)
    guards.quotaRefund(GLOBAL_SUBJECT)
    console.error('[pdf] 渲染失败：', error)
    const failure = asRecord(error)
    res
      .status(Number(failure.statusCode) || 500)
      .json({ ok: false, message: String(failure.message || '渲染失败') })
  }
})

/**
 * 远程图片代理：「图片生成模板」需要把网络图片画进 Canvas 读像素，
 * 前端直取会被 CORS 污染画布，由本机服务代取。
 * 任意 URL 抓取是高危能力，与导出同为登录后能力，目标校验见 imageProxy.js。
 */
app.post('/api/image-proxy', guards.requireAuth, async (req, res) => {
  // 该端点对会话与脚本口令都开放，只能依赖 subject
  const subject = subjectOf(req)
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
  if (!url) {
    res.status(400).json({ ok: false, message: '缺少图片链接' })
    return
  }
  if (!imageLimiter.tryTake(`img:${subject}`)) {
    res.status(429).json({ ok: false, message: '图片抓取过于频繁，请一小时后再试' })
    return
  }
  try {
    const result = await fetchRemoteImage(url)
    res.json({ ok: true, ...result })
  } catch (error) {
    // 目标校验不通过、下载失败都属于调用方问题，统一 400 并回传原因
    res.status(400).json({ ok: false, message: errorMessage(error) || '抓取失败' })
  }
})

/* ---------------- 简历分享（创建要求登录，查看公开） ---------------- */

/** 分享短 id：10 位 hex（40bit），千万级分享内碰撞概率可忽略 */
function newShareId() {
  return randomBytes(5).toString('hex')
}

app.post('/api/share', guards.requireAuth, (req, res) => {
  // 会话通道才有用户身份：脚本口令通道没有 userId，取出来直接拒绝
  const auth = sessionAuth(req)

  // 与导出/云端共用同一套清洗：公开出去的数据按「不可信输入」对待
  const sanitized = sanitizeResume(req.body?.resume)
  if (!sanitized.ok) {
    res.status(400).json({ ok: false, message: sanitized.error })
    return
  }

  // 展示到合集是显式勾选的公开行为：默认只生成链接，拿到链接的人仍可查看
  const listInCollection = req.body?.listInCollection === true

  if (!shareLimiter.tryTake(`share:${auth.subject}`)) {
    res.status(429).json({ ok: false, message: '分享过于频繁，请一小时后再试' })
    return
  }

  // 过期分享在此惰性清理，不安排后台任务
  db.purgeExpiredShares()

  let result = null
  for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
    try {
      result = db.createShare(
        newShareId(),
        auth.userId,
        sanitized.value,
        SHARE_TTL_DAYS * 24 * 60 * 60 * 1000,
        listInCollection,
      )
    } catch (error) {
      // 主键碰撞（极小概率）换号重试；其它错误上抛
      if (!errorCode(error).includes('SQLITE_CONSTRAINT')) throw error
    }
  }

  if (!result) {
    res.status(500).json({ ok: false, message: '分享创建失败，请重试' })
    return
  }

  res.json({ ok: true, id: result.id, expiresAt: result.expiresAt })
})

/** 当前用户的分享列表（「我的分享」管理用：撤销、取消合集展示） */
app.get('/api/share/mine', guards.requireAuth, (req, res) => {
  // 会话通道才有用户身份：脚本口令通道没有 userId，取出来直接拒绝
  const auth = sessionAuth(req)
  res.json({ ok: true, items: db.listUserShares(auth.userId) })
})

app.get('/api/share/:id', (req, res) => {
  const share = db.getShare(req.params.id)
  if (!share) {
    res.status(404).json({ ok: false, message: '分享不存在或已过期' })
    return
  }
  res.json({
    ok: true,
    resume: share.resume,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
  })
})

app.delete('/api/share/:id', guards.requireAuth, (req, res) => {
  // 会话通道才有用户身份：脚本口令通道没有 userId，取出来直接拒绝
  const auth = sessionAuth(req)
  const deleted = db.deleteShare(req.params.id, auth.userId)
  if (!deleted) {
    res.status(404).json({ ok: false, message: '分享不存在，或不是你创建的' })
    return
  }
  res.json({ ok: true })
})

/* ---------------- 简历合集（公开浏览，登录解锁全部） ---------------- */

/**
 * 官网简历合集：勾选「展示到合集」的未过期分享摘要，最新在前，可按分类过滤。
 *
 * 游客只拿到前 GUEST_VISIBLE 条且不含其余条目的 id——「登录查看更多」
 * 是服务端截断而非前端隐藏；已登录（会话 Cookie）返回完整分页。
 * 分类由分享入库时按求职意向自动推导（deriveCategory），此处仅做白名单透传。
 * 摘要不含简历正文：正文由客户端按条目走公开的 /api/share/:id 拉取渲染。
 */
app.get('/api/collection', (req, res) => {
  const authenticated = Boolean(guards.readSessionUser(req))

  const pageSize = Math.min(
    24,
    Math.max(1, Number.parseInt(String(req.query.limit ?? ''), 10) || COLLECTION_PAGE_SIZE),
  )
  const offset = Math.min(
    1000,
    Math.max(0, Number.parseInt(String(req.query.offset ?? ''), 10) || 0),
  )
  // 分类白名单：非法值按「全部」处理而不是报错，分享出去的链接容错更好
  const rawCategory = String(req.query.category || '').trim()
  const category = CATEGORY_KEYS.has(rawCategory) ? rawCategory : null

  // 游客最多看到前 guestVisible 条，越界翻页直接给空列表
  const limit = authenticated ? pageSize : Math.max(0, COLLECTION_GUEST_VISIBLE - offset)
  const total = db.countCollection({ category })
  const items = limit > 0 ? db.listCollection({ limit, offset, category }) : []

  // 随会话 Cookie 变化，按不可缓存处理，避免登录后还看到截断前的列表
  res.set('Cache-Control', 'no-store')
  res.json({
    ok: true,
    total,
    items,
    categories: db.collectionFacets(),
    authenticated,
    guestLimited: !authenticated,
    guestVisible: COLLECTION_GUEST_VISIBLE,
  })
})

/* ---------------- AI 转发（要求登录；Key 只过内存，不落盘不写日志） ---------------- */

/**
 * 浏览器直连各家 AI 服务会被 CORS 与混合内容拦住，由本机服务代为转发。
 * Key 由前端每次随请求带来：转发即用即弃，不写库、不打日志；
 * base URL 的协议与内网校验见 aiGuard.js。
 */
app.post('/api/ai/chat', guards.requireAuth, async (req, res) => {
  const { baseUrl, apiKey, model, messages, temperature } = req.body || {}

  const endpoint = await resolveAiEndpoint(baseUrl)
  if (!endpoint.ok) {
    res.status(400).json({ ok: false, message: endpoint.message })
    return
  }
  if (!apiKey || typeof apiKey !== 'string') {
    res.status(400).json({ ok: false, message: '缺少 API Key' })
    return
  }
  if (!model || typeof model !== 'string') {
    res.status(400).json({ ok: false, message: '缺少模型名称' })
    return
  }
  if (model.length > 200) {
    res.status(400).json({ ok: false, message: '模型名称过长' })
    return
  }
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 20 ||
    messages.some(
      (m) => !m || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 8000,
    )
  ) {
    res.status(400).json({ ok: false, message: '对话内容格式不正确' })
    return
  }

  // 该端点对会话与脚本口令都开放，只能依赖 subject
  const subject = subjectOf(req)
  if (!aiLimiter.tryTake(`ai:${subject}`)) {
    res.status(429).json({ ok: false, message: 'AI 调用过于频繁，请一小时后再试' })
    return
  }

  try {
    const upstream = await fetch(`${endpoint.url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number.isFinite(Number(temperature))
          ? Math.min(2, Math.max(0, Number(temperature)))
          : 0.7,
        max_tokens: 1000,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
      // OpenAI 兼容接口不该有重定向；跟随重定向会绕过上面的地址校验，直接拒绝
      redirect: 'error',
    })

    // 上游错误页常是 HTML、恶意上游可能是超大 body：读不出合法 JSON 就按
    // 空对象处理，与下方「AI 服务返回了 X 状态码」的兜底提示衔接。
    // readJsonWithCap 边读边计数，超大响应体在读入内存前就被断开。
    let data: JsonRecord = {}
    try {
      data = asRecord(await readJsonWithCap(upstream))
    } catch {
      /* 按空对象处理 */
    }
    if (!upstream.ok) {
      const message =
        String(asRecord(data.error).message || data.message || '') ||
        `AI 服务返回了 ${upstream.status} 状态码`
      res.status(502).json({ ok: false, message })
      return
    }

    const choices = Array.isArray(data.choices) ? data.choices : []
    const content = asRecord(asRecord(choices[0]).message).content
    if (typeof content !== 'string' || !content.trim()) {
      res.status(502).json({ ok: false, message: 'AI 服务没有返回有效内容' })
      return
    }
    res.json({ ok: true, content })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      res.status(504).json({ ok: false, message: 'AI 服务响应超时，请稍后再试' })
      return
    }
    res.status(502).json({ ok: false, message: `AI 服务连接失败：${errorMessage(error)}` })
  }
})

app.use(
  express.static(path.join(__dirname, '..', 'dist'), {
    setHeaders(res) {
      res.setHeader('Content-Security-Policy', APP_CSP)
    },
  }),
)

// SPA fallback：history 路由的深层链接（如 /login）由前端路由接管。
// 放在静态目录之后，只兜 HTML 文档请求，API 与静态资源照常走前面的路径
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
  res.setHeader('Content-Security-Policy', APP_CSP)
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'), (error) => {
    if (error) next(error)
  })
})

/**
 * 统一错误出口。
 *
 * Express 内置错误处理器在非 production 环境下会返回带完整堆栈的 HTML 页面，
 * 那会把服务端绝对路径与依赖内部结构全部暴露出去，因此必须换成精简响应。
 * 真实错误只写进服务端日志。
 */
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error)

  const status = Number(asRecord(error).status ?? asRecord(error).statusCode) || 500
  const message =
    status === 413
      ? '请求体过大'
      : status === 400
        ? '请求体不是合法的 JSON'
        : status === 403
          ? '请求来源不被允许'
          : '服务内部错误'

  if (status >= 500) console.error('[server] 未捕获错误：', error)
  res.status(status).json({ ok: false, message })
})

const server = app.listen(PORT, HOST, async () => {
  console.log(`简历服务：\u3000\u3000 http://${HOST}:${PORT}`)
  console.log(
    isLoopbackHost(HOST)
      ? '监听范围：\u3000\u3000仅本机'
      : `监听范围：\u3000\u3000${HOST}，已对外暴露（/api 仅限登录用户${guard.enabled ? ' 或脚本口令' : ''}）`,
  )
  console.log(
    `账号系统：\u3000\u3000开放注册（注册限每小时 5 次/IP），会话有效期 ${SESSION_TTL_DAYS} 天`,
  )
  console.log(
    guard.enabled
      ? '脚本口令：\u3000\u3000已启用（Bearer 通道）'
      : '脚本口令：\u3000\u3000未设置（仅账号登录可用）',
  )
  console.log(
    `导出额度：\u3000\u3000每用户 ${USER_DAILY_LIMIT} 次/日，全站 ${GLOBAL_DAILY_LIMIT} 次/日`,
  )
  console.log(
    `渲染并发：\u3000\u3000${getRenderStats().active ? getRenderStats().active : 0} 活跃（上限 ${process.env.RENDER_CONCURRENCY || 1}，排队上限 ${process.env.RENDER_QUEUE_MAX ?? 3}）`,
  )

  // 启动时预热浏览器，把可用性直接打在控制台，避免用户点导出才发现问题
  try {
    const channel = await ensureBrowser()
    console.log(`渲染内核：\u3000\u3000${channel}`)
  } catch (error) {
    console.error(`渲染内核不可用：${errorMessage(error)}`)
  }

  // 顺带跑一次探测，把渲染源打进日志（getRenderUrl 内部已有变化才打印）
  await getRenderUrl()
})

async function shutdown() {
  server.close()
  await closeBrowser()
  db.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
