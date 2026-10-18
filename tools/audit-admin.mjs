/**
 * 管理后台的界面审计（/admin）。
 * 用法：node tools/audit-admin.mjs [--shots]
 *
 * 为什么单独一个脚本：管理后台要走会话与角色校验，直接拿 audit-ui 打 /admin
 * 只会看到未登录态。这里起一个**临时库**的服务、注册出管理员（空库首个用户即管理员），
 * 再把会话令牌交给 audit-ui。
 *
 * 曾经踩过的坑：手工跑的时候 shell 变量名撞车，`--token` 传成了空值，
 * 于是静默地按未登录跑了一遍，报出一个「0 问题」的**假通过**。
 * 所以现在令牌为空会直接失败退出（见 admin-harness）。
 *
 * 临时服务的搭建已抽到 admin-harness.mjs —— verify-selects.mjs 也用同一套。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { startAdminServer } from './admin-harness.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const shots = process.argv.includes('--shots')

let admin
try {
  admin = await startAdminServer({ username: 'audit-admin', password: 'audit-admin-local' })
  console.log(`临时库：${admin.dbPath}`)
  console.log(`管理员：${admin.username}（role=admin）`)
  console.log('')

  const args = ['tools/audit-ui.mjs', `${admin.base}/admin`, '--token', admin.token]
  if (shots) args.push('--shots')
  const audit = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
  const code = await new Promise((resolve) => audit.once('exit', resolve))
  admin.cleanup()
  process.exit(code ?? 0)
} catch (error) {
  console.error(`审计失败：${error.message}`)
  admin?.cleanup()
  process.exit(1)
}