/**
 * 给界面审计准备一个已登录的会话（一次性工具，不进构建）。
 *
 * 为什么需要它：tools/audit-ui.mjs 只能看到未登录的界面 —— 而编辑器的模块面板、
 * 设计面板、管理页全都要登录后才渲染，恰恰是界面问题最集中的地方。
 * 走正常注册流程要过滑块验证码，自动化不现实；这里直接建用户 + 建会话，
 * 用的还是生产同一套实现（auth.ts 的 hashPassword、db.ts 的 createUser / createSession），
 * 因此不会出现「测试专用旁路」那种和生产不一致的假象。
 *
 * 用法：
 *   node tools/audit-login.mjs                          # 打印一个会话令牌
 *   node tools/audit-login.mjs --user someone           # 指定用户名
 *   node tools/audit-login.mjs --token <令牌> --cleanup  # 撤销指定令牌
 *
 * 拿到的令牌相当于该账号的登录态（30 天有效），只在本机自测用，
 * 别贴给别人、别提交进仓库。审计用户是**真的写进库**的，
 * 默认库为 server/.data/app.db，该目录已在 .gitignore。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSessionToken, hashPassword } from '../server/auth.ts'
import { createDatabase } from '../server/db.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUDIT_USER = 'audit-ui'
const AUDIT_PASSWORD = 'audit-ui-local-only'

const args = process.argv.slice(2)
const userFlag = args.indexOf('--user')
const username = userFlag >= 0 ? args[userFlag + 1] : AUDIT_USER
const cleanup = args.includes('--cleanup')

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'server', '.data', 'app.db')
const db = createDatabase({ filePath: dbPath })

if (cleanup) {
  const found = db.findUserByUsername(username)
  if (!found) {
    console.log(`没有找到审计用户 ${username}，无需清理`)
  } else {
    /*
     * 只能撤销「本次传进来的那个令牌」——db 只导出 deleteSession(token)，
     * 没有按用户枚举/批量删除会话的接口（也没有 deleteUser）。为一个自测工具
     * 去扩生产数据层的接口不划算，所以这里如实只做能做的：
     * 用 -Token 指定要撤销的令牌，或直接删库文件（server/.data/app.db，本地测试数据、已 gitignore）。
     */
    const tokenFlag = args.indexOf('--token')
    const token = tokenFlag >= 0 ? args[tokenFlag + 1] : ''
    if (token) {
      db.deleteSession(token)
      console.log(`已撤销令牌 ${token.slice(0, 12)}…（用户 ${username} 的其它会话不受影响）`)
    } else {
      console.log(`未指定 --token，没有可撤销的目标。`)
    }
    console.log(`用户行仍在（id=${found.id}）。要彻底清掉，删库文件或用 sqlite 执行：`)
    console.log(`  DELETE FROM users WHERE id=${found.id};`)
  }
  process.exit(0)
}

let user = db.findUserByUsername(username)
if (!user) {
  user = db.createUser(username, hashPassword(AUDIT_PASSWORD))
  console.log(`已创建审计用户 ${user.username}（id=${user.id}，role=${user.role}）`)
} else {
  console.log(`复用已有用户 ${user.username}（id=${user.id}，role=${user.role}）`)
}

const token = db.createSession(user.id, createSessionToken())
console.log('')
console.log(`库：${dbPath}`)
console.log(`会话令牌（30 天有效，仅本机自测用）：`)
console.log(token)
console.log('')
console.log('接着跑：')
console.log(`  node tools/audit-ui.mjs --token ${token}`)
console.log('用完想撤销这个令牌：')
console.log(`  node tools/audit-login.mjs --user ${username} --token ${token} --cleanup`)