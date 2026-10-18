/**
 * 管理后台的界面审计（/admin）。
 * 用法：node tools/audit-admin.mjs [--shots]
 *
 * 为什么要单独一个脚本：`audit-ui.mjs` 需要外部已起服务 + 一个管理员令牌，
 * 而手工拼这几步很容易出错 —— 实测就踩过一次：命令行里把自己设的变量也命名为
 * `$cookie`，`--token` 被弄成空值，于是审计静默地按**未登录**跑了一遍，
 * 报出来的「0 问题」是假的（管理后台根本没渲染出来）。
 * 这里把「起服务 → 造管理员 → 审计 → 收尾」串成一步，消除手工环节，
 * 并且**在令牌为空时直接报错退出**，而不是继续跑出一个假通过。
 *
 * 管理员从哪来：`db.ts` 里首个注册的账号即实例管理员（`role='admin'`，
 * 由 `MIN(id)` 那条 UPDATE 保证）。所以在一个**全新的临时库**上注册第一个用户，
 * 它就是管理员 —— 不需要改数据、也不需要测试专用旁路。
 *
 * 安全：全程用 os.tmpdir() 下的临时库与随机端口，收尾删除，绝不碰 .data/app.db。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const shots = process.argv.includes('--shots')

const dir = mkdtempSync(join(tmpdir(), 'rs-admin-audit-'))
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
    // 首次注册就成了管理员，不受限频影响，但给足余量避免调试时被挡
    REGISTER_LIMIT: '50',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (b) => (output += b.toString()))
child.stderr.on('data', (b) => (output += b.toString()))

function cleanup() {
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

try {
  // 等就绪
  const deadline = Date.now() + 20000
  let ready = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：\n${output.slice(-800)}`)
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
  if (!ready) throw new Error(`服务未就绪：\n${output.slice(-800)}`)

  // 在空库上注册第一个用户 → 即管理员
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'audit-admin', password: 'audit-admin-local' }),
  })
  const regBody = await reg.json()
  if (!regBody.ok) throw new Error(`建管理员失败：${JSON.stringify(regBody)}`)
  if (regBody.user?.role !== 'admin') {
    throw new Error(`首个用户不是管理员（role=${regBody.user?.role}），管理后台无法审计`)
  }

  const setCookie = reg.headers.getSetCookie?.() ?? []
  const cookieLine = setCookie.find((c) => c.startsWith('rs_session='))
  const token = cookieLine ? cookieLine.split(';')[0].slice('rs_session='.length) : ''
  // 令牌为空时必须停下：否则 audit-ui 会按未登录跑完，报出一个「0 问题」的假通过
  if (!token) throw new Error('未能取到会话令牌，拒绝在未登录状态下审计（那会得到假通过）')

  console.log(`临时库：${dbPath}`)
  console.log(`管理员：${regBody.user.username}（role=${regBody.user.role}）`)
  console.log('')

  const args = ['tools/audit-ui.mjs', `${base}/admin`, '--token', token]
  if (shots) args.push('--shots')
  const audit = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
  const code = await new Promise((resolve) => audit.once('exit', resolve))
  cleanup()
  process.exit(code ?? 0)
} catch (error) {
  console.error(`审计失败：${error.message}`)
  cleanup()
  process.exit(1)
}