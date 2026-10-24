/**
 * SQLite 备份：用 `VACUUM INTO` 生成一致快照，并保留最近 N 份。
 *
 * 用法：
 *   node tools/backup-db.mjs                # 备份到 server/.data/backups/
 *   node tools/backup-db.mjs --keep 14      # 保留最近 14 份
 *   node tools/backup-db.mjs --out D:/bak   # 指定输出目录
 *
 * ---------------- 为什么不能直接 copy .db ----------------
 *
 * 本项目开着 WAL（`node:sqlite` 默认）。WAL 模式下数据分散在
 * `app.db`、`app.db-wal`、`app.db-shm` 三个文件里，**直接复制 .db 只能拿到一部分**：
 * 最近提交但还没 checkpoint 的事务留在 -wal 里，拷出来的库要么缺数据、要么损坏。
 *
 * `VACUUM INTO` 由 SQLite 自己写一份完整、一致的新库文件，
 * 是官方推荐的在线备份方式 —— 不需要停服务。
 *
 * ---------------- 为什么不做「复制整个目录」 ----------------
 *
 * 目录里还有 -wal / -shm 与备份文件自身。拷目录会把这些中间态一起带走，
 * 恢复时反而要处理「-wal 比 -db 新」这种歧义。
 * 单文件快照是最没有歧义的形态：恢复 = 把它拷回 DB_PATH。
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 解析命令行参数 */
function parseArgs(argv) {
  const args = { keep: 7, out: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--keep') args.keep = Number(argv[i + 1]) || 7
    else if (argv[i] === '--out') args.out = argv[i + 1] || null
  }
  return args
}

const { keep, out } = parseArgs(process.argv.slice(2))

/** 与 server/index.ts 一致的 DB 路径推导 */
const dbPath = process.env.DB_PATH || join(ROOT, 'server', '.data', 'app.db')

if (!existsSync(dbPath)) {
  /*
   * 库还不存在时**不要**创建一个空库再备份 —— 那会让人以为「备份成功」，
   * 而实际上备份的是一个空数据库。这比失败更糟。
   */
  console.error(`[--] 数据库不存在：${dbPath}`)
  console.error('     先启动一次服务（npm run pdf）让它建库，或检查 DB_PATH')
  process.exit(1)
}

const targetDir = out ? resolve(out) : join(dirname(dbPath), 'backups')
mkdirSync(targetDir, { recursive: true })

const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const target = join(targetDir, `app-${stamp}.db`)

/*
 * VACUUM INTO 的目标文件必须**不存在**（SQLite 会直接报错）。
 * 同一秒内跑两次会撞名 —— 加序号而不是覆盖：覆盖掉上一次备份等于毁掉一份历史。
 */
let finalTarget = target
let suffix = 1
while (existsSync(finalTarget)) {
  finalTarget = target.replace(/\.db$/, `-${suffix}.db`)
  suffix += 1
}

let db = null
try {
  db = new DatabaseSync(dbPath)
  /*
   * 用参数绑定而不是字符串拼接：路径里有空格或引号时，
   * 拼出来的 SQL 会语法错误（Windows 的用户目录里带空格很常见）。
   */
  db.prepare('VACUUM INTO ?').run(finalTarget)
} catch (error) {
  console.error(`[--] 备份失败：${error.message}`)
  console.error('     若提示 file already exists，说明目标文件已存在（不应发生，请检查目录权限）')
  process.exit(1)
} finally {
  db?.close?.()
}

const size = statSync(finalTarget).size
const kb = (size / 1024).toFixed(1)
console.log(`[ok] 已备份：${finalTarget}（${kb} KB）`)

/* ---------------- 清理旧备份 ---------------- */

const backups = readdirSync(targetDir)
  .filter((name) => /^app-\d{8}-\d{6}(-\d+)?\.db$/.test(name))
  .map((name) => ({ name, mtime: statSync(join(targetDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)

const removed = backups.slice(keep)
for (const item of removed) {
  try {
    rmSync(join(targetDir, item.name), { force: true })
  } catch (error) {
    console.warn(`[--] 删除旧备份失败：${item.name}（${error.message}）`)
  }
}

console.log(
  `[ok] 保留最近 ${keep} 份，共 ${Math.min(backups.length, keep)} 份` +
    (removed.length ? `，清理 ${removed.length} 份旧备份` : ''),
)
console.log('')
console.log('恢复方式：停止服务 → 把选定的 .db 拷回 DB_PATH → 重新启动。')
console.log('          同目录下的 -wal / -shm 要先删掉，否则会与旧快照冲突。')
