/**
 * 起一个真实的 API 服务用于集成测试。
 *
 * 为什么用「真起进程 + 发 HTTP」而不是直接 import app：
 *  - `server/index.ts` 不导出 app，导入即 `listen(PORT)`，没有可挂载的实例；
 *  - 更重要的是**测得更真**：真实进程会走到同一份 .env、中间件顺序、来源校验、
 *    会话守卫、SQLite 建表与迁移、错误处理。把 app 抽出来单测会漏掉这些接缝，
 *    而接缝恰恰是最容易出问题的地方。
 *
 * 两条硬约束：
 *  1. **必须用临时数据库**：`DB_PATH` 指向 os.tmpdir() 下的临时文件，
 *     否则测试会写坏开发用的 `.data/app.db`。收尾时连同 -wal / -shm 一起删。
 *  2. **必须用随机端口**：避免和已在跑的开发服务（3001）撞车，也让并行更安全。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本文件在 tests/api/ 下，项目根要上两级。
 * 用 cwd 兜底是为了「从哪里跑 vitest 都成立」，但主路径必须靠文件位置推出来 ——
 * 只写 './' 会随启动目录漂移，实测第一次跑就报「找不到 tests/server/index.ts」。
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * 记下所有创建过的临时目录，并保证退出时清扫。
 *
 * 为什么需要：服务启动失败时（实测遇到过路径写错导致进程立刻退出），
 * 前面的 `stop()` 不会被调用，临时目录就留在 %TEMP% 里。留一两个无伤大雅，
 * 但测试工具不该在别人的机器上堆垃圾 —— 所以挂一个兜底清扫，
 * 无论成功、失败还是被中断都执行。
 */
const createdDirs = new Set()

function sweepDirs() {
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 清理失败不该影响测试结果 */
    }
  }
  createdDirs.clear()
}

process.once('exit', sweepDirs)
process.once('SIGINT', () => {
  sweepDirs()
  process.exit(130)
})

/** 临时目录与端口在整个测试文件里复用，减少起停次数 */
let shared = null

function pickPort() {
  // 高位随机端口，避开常见开发端口
  return 34000 + Math.floor(Math.random() * 8000)
}

/**
 * 启动服务并等待 /api/health 可用。
 * @returns {{ base: string, dbPath: string, stop: () => Promise<void> }}
 */
export async function startApi() {
  if (shared) return shared

  const dir = mkdtempSync(join(tmpdir(), 'rs-api-test-'))
  createdDirs.add(dir)
  const dbPath = join(dir, 'test.db')
  const port = pickPort()
  const base = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      // 跳过注册滑块校验。这是服务端自带的正当开关（见 .env.example 的
      // CAPTCHA_ENABLED），而不是在测试里绕过安全逻辑 —— 滑块本身另有单测，
      // 这里要测的是注册/登录/会话这条链。
      CAPTCHA_ENABLED: 'off',
      // 放开注册限频：默认 5 次/小时/IP，而测试要从同一个出口 IP 造 20+ 个账号。
      // 这是服务端自带的配置项（见 .env.example 的 REGISTER_LIMIT），
      // 不是绕过防线 —— 限频本身另有单测覆盖（auth.test.js）。
      REGISTER_LIMIT: '500',
      // 固定门禁行为，避免受开发环境变量影响
      ALLOWED_ORIGINS: '',
      TRUST_PROXY: '',
      PDF_ACCESS_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (b) => (output += b.toString()))
  child.stderr.on('data', (b) => (output += b.toString()))

  const stop = async () => {
    if (!child.killed) child.kill()
    // 等进程真正退出，否则 -wal 文件可能还被占用
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    createdDirs.delete(dir)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不该让测试失败 */
    }
    shared = null
  }

  // 轮询健康检查，最多等 20 秒（首次启动要建表）
  const deadline = Date.now() + 20000
  let lastError = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`服务进程提前退出（code ${child.exitCode}）：\n${output.slice(-1200)}`)
    }
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) {
        shared = { base, dbPath, stop }
        return shared
      }
      lastError = `health 返回 ${res.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((r) => setTimeout(r, 150))
  }

  await stop()
  throw new Error(`服务未能在 20 秒内就绪（${lastError}）：\n${output.slice(-1200)}`)
}

/** 停掉服务并清理临时目录 */
export async function stopApi() {
  if (shared) await shared.stop()
}

/**
 * 带 cookie 的请求助手。
 *
 * Node 的 fetch **不会自动保存 cookie**（那是浏览器的行为），
 * 所以这里手工维护一份 cookie jar —— 会话鉴权全靠 rs_session。
 * 这是写 API 集成测试最容易白跑的地方：忘了带 cookie，所有受保护接口都返 401，
 * 于是「守卫生效」的断言一路通过，而真实登录流程根本没被验证。
 */
export function makeClient(base) {
  const jar = new Map()

  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

  const absorb = (res) => {
    const raw = res.headers.getSetCookie?.() ?? []
    for (const line of raw) {
      const [pair] = line.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) {
        const name = pair.slice(0, idx).trim()
        const value = pair.slice(idx + 1).trim()
        if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name)
        else jar.set(name, value)
      }
    }
  }

  async function request(method, path, body, extraHeaders = {}) {
    const headers = { ...extraHeaders }
    if (jar.size) headers.cookie = cookieHeader()
    let payload
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(`${base}${path}`, { method, headers, body: payload })
    absorb(res)
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* 非 JSON 响应（如 PDF 二进制）保留原文 */
    }
    return { status: res.status, headers: res.headers, json, text }
  }

  return {
    get: (path, headers) => request('GET', path, undefined, headers),
    post: (path, body, headers) => request('POST', path, body, headers),
    put: (path, body, headers) => request('PUT', path, body, headers),
    delete: (path, headers) => request('DELETE', path, undefined, headers),
    cookies: jar,
    /** 换一个「浏览器」：清空 cookie，用于验证未登录/换用户的行为 */
    reset: () => jar.clear(),
  }
}

/** 造一个唯一用户名，避免同一次运行内的多次注册互相冲突 */
export function uniqueUser(prefix = 'u') {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}
