/**
 * 简历 PDF 本地渲染服务。
 *
 * 这个进程能起浏览器、能读本机文件、能生成 PDF，因此按「不可信输入」对待，
 * 安全基线如下：
 *  1. 只监听回环地址，局域网内其它机器无法访问；
 *  2. 校验 Origin，阻断跨站调用与 DNS rebinding；
 *  3. 入参全量清洗：枚举白名单 + 文本剥离标签 + 数量与长度上限；
 *  4. 渲染页面禁止访问外部源，注入内容无法外联；
 *  5. 每个自然日总导出次数受限，计数落盘、重启不重置；
 *  6. 可选访问口令，走 Authorization: Bearer，常量时间比较并带失败锁定。
 *
 * 配置统一从环境变量读取，可写在项目根的 .env（模板见 .env.example），
 * 由 npm run pdf 的 --env-file-if-exists 自动加载。
 * 开发模式下 Vite 跑在 5173，启动与本服务都会自动探测该地址。
 * 需要指定渲染源时设置环境变量 RENDER_URL。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'

import { createPasswordGuard, isLoopbackHost, readPassword } from './auth.js'
import { createDailyQuota } from './quota.js'
import { closeBrowser, ensureBrowser, getResolvedChannel, renderResumePdf } from './render.js'
import { sanitizeFilename, sanitizeResume } from './sanitize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001
const DEV_PORT = Number(process.env.DEV_PORT) || 5173
/** 只监听回环地址，避免把带浏览器能力的服务暴露到局域网 */
const HOST = process.env.HOST || '127.0.0.1'

const quota = createDailyQuota({
  limit: Number(process.env.PDF_DAILY_LIMIT) || 20,
  filePath: path.join(__dirname, '.data', 'quota.json'),
})

/** 访问口令。留空表示不校验，但那只允许配合回环监听，见下方启动校验。 */
const guard = createPasswordGuard({ password: process.env.PDF_ACCESS_PASSWORD })

/*
 * 非回环监听意味着局域网或公网可达。这个进程能启动浏览器、能读写本机文件、能访问内网，
 * 无口令地暴露等于把本机交出去，因此宁可起不来也不能悄悄放行。
 */
if (!isLoopbackHost(HOST) && !guard.enabled) {
  console.error(`[server] 拒绝启动：HOST=${HOST} 已对外暴露，但未设置 PDF_ACCESS_PASSWORD`)
  console.error('[server] 请在 .env 中设置访问口令，或把 HOST 改回 127.0.0.1')
  process.exit(1)
}

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

/** 允许的请求来源：本服务自身与本地开发服务器 */
const ALLOWED_ORIGINS = new Set(
  LOCAL_HOSTS.flatMap((host) => [`http://${host}:${PORT}`, `http://${host}:${DEV_PORT}`]),
)

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

  const candidates = LOCAL_HOSTS.map((host) => `http://${host}:${DEV_PORT}/`)
  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return url
    } catch {
      /* 该地址不通，换下一个 */
    }
  }

  return `http://127.0.0.1:${PORT}/`
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
    console.log(`渲染数据源：　${value}`)
  }
  renderUrlCache = { value, at: now }
  return value
}

/**
 * 来源校验。
 *
 * 浏览器发起的跨站请求一定会带 Origin，因此拒绝未知来源即可阻断恶意页面
 * 调用本服务，也能挡住把域名解析到 127.0.0.1 的 DNS rebinding 攻击。
 * 不带 Origin 的请求（curl、脚本、服务内部调用）放行。
 */
function checkOrigin(req, res, next) {
  const origin = req.get('origin')
  if (!origin || ALLOWED_ORIGINS.has(origin)) return next()
  res.status(403).json({ ok: false, message: '请求来源不被允许' })
}

/**
 * 口令校验中间件。
 *
 * 只保护 /api 接口：静态站点本身是公开的，编辑器里也没有需要藏住的服务端数据。
 * 未启用口令时直接放行，此时安全性由「仅监听回环地址」保证。
 */
function requirePassword(req, res, next) {
  const result = guard.verify(readPassword(req))
  if (result === 'ok') return next()

  if (result === 'locked') {
    const minutes = Math.max(1, Math.ceil(guard.lockedMs() / 60000))
    res.status(429).json({ ok: false, message: `口令连续错误过多，请 ${minutes} 分钟后再试` })
    return
  }

  res.status(401).json({
    ok: false,
    authRequired: true,
    message: result === 'missing' ? '该接口需要访问口令' : '访问口令不正确',
  })
}

const app = express()

app.disable('x-powered-by')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

// 来源校验与口令校验都排在请求体解析之前：未通过校验的请求不该消耗内存去解析大 body
app.use(checkOrigin)

/**
 * 服务状态。
 *
 * 不要求口令即可调用：前端必须先知道「要不要口令」，才决定是否弹输入框。
 * 但渲染源、渲染内核与剩余额度只回给已通过校验的调用方，未通过时只给一个标记。
 */
app.get('/api/health', async (req, res) => {
  const authed = guard.verify(readPassword(req)) === 'ok'

  res.json({
    ok: true,
    authRequired: guard.enabled,
    ...(authed
      ? {
          renderUrl: await getRenderUrl(),
          browser: getResolvedChannel() || null,
          quota: quota.status(),
        }
      : {}),
  })
})

// 其余 /api 接口一律要求口令
app.use('/api', requirePassword)

// 头像以 DataURL 随数据提交，上限按「头像 + 若干机构图标」估算
app.use(express.json({ limit: '8mb' }))

app.post('/api/pdf', async (req, res) => {
  const { resume, filename } = req.body || {}

  // 先校验再扣额度：参数不合法属于调用方问题，不应消耗当天配额
  const sanitized = sanitizeResume(resume)
  if (!sanitized.ok) {
    res.status(400).json({ ok: false, message: sanitized.error })
    return
  }

  const ticket = quota.consume()
  if (!ticket.ok) {
    res.status(429).json({
      ok: false,
      message: `今日导出额度已用完（每天 ${ticket.limit} 次），额度在次日 0 点重置`,
      quota: ticket,
    })
    return
  }

  try {
    const pdf = await renderResumePdf({
      resume: sanitized.value,
      renderUrl: await getRenderUrl(),
      title: sanitizeFilename(filename),
    })

    const safeName = `${sanitizeFilename(filename)}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    )
    res.setHeader('X-Quota-Remaining', String(ticket.remaining))
    res.send(pdf)
  } catch (error) {
    // 渲染失败多数是服务端问题，归还额度
    quota.refund()
    console.error('[pdf] 渲染失败：', error)
    res.status(error.statusCode || 500).json({ ok: false, message: error.message || '渲染失败' })
  }
})

app.use(
  express.static(path.join(__dirname, '..', 'dist'), {
    setHeaders(res) {
      res.setHeader('Content-Security-Policy', APP_CSP)
    },
  }),
)

/**
 * 统一错误出口。
 *
 * Express 内置错误处理器在非 production 环境下会返回带完整堆栈的 HTML 页面，
 * 那会把服务端绝对路径与依赖内部结构全部暴露出去，因此必须换成精简响应。
 * 真实错误只写进服务端日志。
 */
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)

  const status = Number(error.status || error.statusCode) || 500
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
  const state = quota.status()
  console.log(`简历 PDF 服务：http://${HOST}:${PORT}`)
  console.log(isLoopbackHost(HOST) ? '监听范围：　　仅本机' : `监听范围：　　${HOST}，已对外暴露`)
  console.log(guard.enabled ? '访问口令：　　已启用' : '访问口令：　　未设置（仅限回环监听）')
  console.log(`今日额度：　　${state.used} / ${state.limit} 次（已用 / 上限）`)

  // 启动时预热浏览器，把可用性直接打在控制台，避免用户点导出才发现问题
  try {
    const channel = await ensureBrowser()
    console.log(`渲染内核：　　${channel}`)
  } catch (error) {
    console.error(`渲染内核不可用：${error.message}`)
  }

  // 顺带跑一次探测，把渲染源打进日志（getRenderUrl 内部已有变化才打印）
  await getRenderUrl()
})

async function shutdown() {
  server.close()
  await closeBrowser()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
