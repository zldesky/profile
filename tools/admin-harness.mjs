/**
 * 管理后台验证的公共脚手架：起一个临时库的服务、建出管理员、交出会话令牌。
 *
 * 为什么抽出来：`audit-admin.mjs` 与 `verify-selects.mjs` 都需要「一个能登录的管理后台」，
 * 而这套东西（随机端口 / 临时 DB_PATH / 关掉滑块 / 首个用户即管理员 / 取会话 cookie）
 * 抄第二遍就一定会漂移。上一轮我已经因为「立即价值低」少抽过一次 harness，
 * 结果立刻又写了一遍同样的代码 —— 这次直接抽掉。
 *
 * 用法：
 *   const admin = await startAdminServer()
 *   try { ...用 admin.base / admin.token... } finally { admin.cleanup() }
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 起服务并建出管理员。
 * @returns {Promise<{ base: string, token: string, dbPath: string, username: string, cleanup: () => void }>}
 */
export async function startAdminServer({ username = 'admin-harness', password = 'admin-harness-local' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rs-admin-'))
  const dbPath = join(dir, 'app.db')
  const port = 35000 + Math.floor(Math.random() * 5000)
  const base = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      // 注册要过滑块，而这里需要自动建号；这是服务端自带开关（见 .env.example）
      CAPTCHA_ENABLED: 'off',
      // 首个注册就成了管理员，不受限频影响，但给足余量避免调试时被挡
      REGISTER_LIMIT: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (b) => (output += b.toString()))
  child.stderr.on('data', (b) => (output += b.toString()))

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (!child.killed) child.kill()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 清理失败不该影响退出码 */
    }
  }
  process.once('exit', cleanup)
  process.once('SIGINT', () => {
    cleanup()
    process.exit(130)
  })

  // 等就绪
  const deadline = Date.now() + 20000
  let ready = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      cleanup()
      throw new Error(`服务提前退出：\n${output.slice(-800)}`)
    }
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        ready = true
        break
      }
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  if (!ready) {
    cleanup()
    throw new Error(`服务未就绪：\n${output.slice(-800)}`)
  }

  // 在空库上注册第一个用户 → 即管理员
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await reg.json()
  if (!body.ok) {
    cleanup()
    throw new Error(`建管理员失败：${JSON.stringify(body)}`)
  }
  if (body.user?.role !== 'admin') {
    cleanup()
    throw new Error(`首个用户不是管理员（role=${body.user?.role}），管理后台无法验证`)
  }

  const setCookie = reg.headers.getSetCookie?.() ?? []
  const cookieLine = setCookie.find((c) => c.startsWith('rs_session='))
  const token = cookieLine ? cookieLine.split(';')[0].slice('rs_session='.length) : ''
  // 令牌为空时必须停下：否则会按未登录跑完，报出一个「0 问题」的假通过
  if (!token) {
    cleanup()
    throw new Error('未能取到会话令牌，拒绝在未登录状态下验证（那会得到假通过）')
  }

  return { base, token, dbPath, username: body.user.username, cleanup }
}