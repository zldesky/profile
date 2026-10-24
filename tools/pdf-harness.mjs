/**
 * PDF 导出验证的公共脚手架：起一个**额度不受限**的临时服务，并给出脚本口令。
 *
 * 为什么必须单独起服务，而不是打用户本机那个 3001：
 *  1. **不能消耗正式额度。** 导出有全站与按用户的每日上限（默认 20 / 10 次），
 *     而验证脚本一跑就要出好几份 PDF。实测：反复跑几轮之后接口开始返 429
 *     「服务今日导出总额度已用完」，于是验证失败 —— 而失败原因跟被测代码毫无关系。
 *     工具把产品的额度用光，本身就是工具的问题。
 *  2. **结果要可重复。** 依赖「今天还剩几次额度」的验证，在 CI 上必然不稳。
 *
 * 渲染源仍由服务端自己探测：开发时优先用 Vite（5173），此时渲染的是源码、最新；
 * 探测不到时回落到自己的静态目录，那就要求先 `npm run build`。
 *
 * 用法：
 *   const pdf = await startPdfServer()
 *   try { ...用 pdf.base / pdf.password 发 /api/pdf... } finally { pdf.cleanup() }
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * @param {{ allowedOrigins?: string[] }} [options]
 *   `allowedOrigins`：放行哪些浏览器来源。
 *   默认不设（只允许不带 Origin 的脚本请求）。**浏览器里点按钮验证**时必须传，
 *   否则服务端 checkOrigin 会返 403「请求来源不被允许」——
 *   那条错误看起来像产品坏了，实际是 harness 没放行那个来源。
 * @returns {Promise<{ base: string, password: string, dbPath: string, cleanup: () => void }>}
 */
export async function startPdfServer(options = {}) {
  const { allowedOrigins = [] } = options
  const dir = mkdtempSync(join(tmpdir(), 'rs-pdf-'))
  const dbPath = join(dir, 'app.db')
  const port = 40000 + Math.floor(Math.random() * 5000)
  const base = `http://127.0.0.1:${port}`
  // 每次随机，避免与真实部署的口令有任何关系
  const password = `pdf-harness-${Math.random().toString(36).slice(2, 12)}`

  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      // 脚本通道：注册要过滑块，对工具不友好；这个口令通道本来就是给脚本用的
      PDF_ACCESS_PASSWORD: password,
      // 把额度放大，让验证可以反复跑而不被自己用光
      PDF_DAILY_LIMIT: '1000',
      PDF_USER_DAILY_LIMIT: '1000',
      CAPTCHA_ENABLED: 'off',
      // 浏览器里点按钮的验证必须放行来源，否则 checkOrigin 会 403（见函数注释）
      ...(allowedOrigins.length ? { ALLOWED_ORIGINS: allowedOrigins.join(',') } : {}),
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

  /*
   * 先确认口令通道真的生效：如果服务端没开启口令（例如环境变量没传进去），
   * /api/pdf 会对脚本返 401，而后续所有断言都会跟着失败 ——
   * 那样报出来的是「页数不对」之类的假象，而不是「通道没开」。
   */
  const probe = await fetch(`${base}/api/pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${password}` },
    body: JSON.stringify({ resume: null, filename: 'harness-probe' }),
  })
  if (probe.status === 401) {
    cleanup()
    throw new Error('脚本口令通道未生效（/api/pdf 返 401），拒绝继续验证')
  }

  return { base, password, dbPath, cleanup }
}