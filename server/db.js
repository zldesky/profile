/**
 * SQLite 数据层（node:sqlite，Node 22.13+ 内置，无原生编译依赖）。
 *
 * 存四类数据：
 *  1. users    —— 账号。密码只存 scrypt 摘要（见 auth.js），绝不落明文；
 *  2. sessions —— 服务端会话。令牌只存库，Cookie 里那份丢了可随时吊销；
 *  3. resumes  —— 每用户一份简历快照（JSON 文本），云端同步的权威源；
 *  4. export_quota —— 按主体（用户 / 匿名脚本）与自然日计的导出次数。
 *
 * 所有语句走 prepared statement，参数永远绑定、绝不拼字符串，
 * 用户名这类可控文本也就没有注入面。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 会话有效期：30 天不活跃才过期，过期行在登录时惰性清理 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 打开（或创建）数据库。
 * @param {object} [options]
 * @param {string} [options.filePath] 库文件路径；传 ':memory:' 用于测试
 * @returns {{ db: DatabaseSync, createUser, findUserByUsername, createSession, findSession, deleteSession, purgeExpiredSessions, getResume, saveResume, quotaUsed, quotaConsume, quotaRefund, quotaDaysUsed, close }}
 */
export function createDatabase({ filePath = path.join(__dirname, '.data', 'app.db') } = {}) {
  if (filePath !== ':memory:') {
    // 目录不存在会让 SQLite 直接抛错，先建好
    mkdirSync(path.dirname(filePath), { recursive: true })
  }

  const db = new DatabaseSync(filePath)
  // WAL 提升并发读写的耐用性；外键约束默认关闭，必须显式打开
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resumes (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data       TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS export_quota (
      subject TEXT    NOT NULL,
      day     TEXT    NOT NULL,
      used    INTEGER NOT NULL,
      PRIMARY KEY (subject, day)
    );
  `)

  /* ---------------- 用户 ---------------- */

  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
  )
  const selectUserByName = db.prepare(
    'SELECT id, username, password_hash, created_at FROM users WHERE username = ?',
  )
  const selectUserById = db.prepare('SELECT id, username FROM users WHERE id = ?')

  /**
   * 创建用户。用户名冲突（大小写不敏感）会抛出 SQLite 唯一约束错误，
   * 由调用方转成用户可读的提示。
   */
  function createUser(username, passwordHash) {
    const result = insertUser.run(username, passwordHash, Date.now())
    return { id: Number(result.lastInsertRowid), username }
  }

  /** 登录用：按用户名取完整行（含密码摘要）；未注册返回 undefined */
  function findUserByUsername(username) {
    return selectUserByName.get(String(username))
  }

  /** 会话态查询用：按 id 取公开字段（不含密码摘要） */
  function findUserById(id) {
    return selectUserById.get(id)
  }

  /* ---------------- 会话 ---------------- */

  const insertSession = db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
  const selectSession = db.prepare(
    'SELECT token, user_id, expires_at FROM sessions WHERE token = ?',
  )
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?')
  const deleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?')

  function createSession(userId, token, ttlMs = SESSION_TTL_MS) {
    const now = Date.now()
    insertSession.run(token, userId, now, now + ttlMs)
    return token
  }

  /** 未过期才返回会话；过期行视为不存在（顺带清掉，不让死会话堆积） */
  function findSession(token) {
    const row = selectSession.get(String(token || ''))
    if (!row) return null
    if (row.expires_at <= Date.now()) {
      deleteSessionStmt.run(row.token)
      return null
    }
    return row
  }

  function deleteSession(token) {
    deleteSessionStmt.run(String(token || ''))
  }

  function purgeExpiredSessions() {
    return Number(deleteExpiredSessions.run(Date.now()).changes)
  }

  /* ---------------- 简历快照 ---------------- */

  const upsertResume = db.prepare(`
    INSERT INTO resumes (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `)
  const selectResume = db.prepare('SELECT data, updated_at FROM resumes WHERE user_id = ?')

  /**
   * 保存简历快照（整体覆盖，最后写入者胜出）。
   * @returns {{ updatedAt: number }}
   */
  function saveResume(userId, resumeObject) {
    const updatedAt = Date.now()
    upsertResume.run(userId, JSON.stringify(resumeObject), updatedAt)
    return { updatedAt }
  }

  /** 无快照时返回 null，由路由层决定是回落到示例还是提示 */
  function getResume(userId) {
    const row = selectResume.get(userId)
    if (!row) return null
    try {
      // SQL 列名是蛇形的 updated_at，对外统一转驼峰
      return { resume: JSON.parse(row.data), updatedAt: row.updated_at }
    } catch {
      // 理论上不会发生：写入前已序列化成功；为不阻塞登录流程按无快照处理
      return null
    }
  }

  /* ---------------- 导出配额 ---------------- */

  const upsertQuota = db.prepare(`
    INSERT INTO export_quota (subject, day, used) VALUES (?, ?, 1)
    ON CONFLICT(subject, day) DO UPDATE SET used = used + 1
  `)
  const selectQuota = db.prepare('SELECT used FROM export_quota WHERE subject = ? AND day = ?')
  const refundQuotaStmt = db.prepare(
    'UPDATE export_quota SET used = used - 1 WHERE subject = ? AND day = ? AND used > 0',
  )
  const sumQuotaByDay = db.prepare(
    'SELECT COALESCE(SUM(used), 0) AS total FROM export_quota WHERE day = ?',
  )

  /** 当日已用次数；day 由调用方生成（本机时区自然日），库只管计数 */
  function quotaUsed(subject, day) {
    const row = selectQuota.get(subject, day)
    return row ? row.used : 0
  }

  /** 计数 +1 并返回最新值。同步执行，单线程下不存在超发 */
  function quotaConsume(subject, day) {
    upsertQuota.run(subject, day)
    return quotaUsed(subject, day)
  }

  /** 渲染失败归还额度，不让用户为服务端问题买单 */
  function quotaRefund(subject, day) {
    refundQuotaStmt.run(subject, day)
  }

  /** 全站当日总量，作为成本兜底的依据 */
  function quotaDaysUsed(day) {
    return Number(sumQuotaByDay.get(day).total)
  }

  function close() {
    db.close()
  }

  return {
    createUser,
    findUserByUsername,
    findUserById,
    createSession,
    findSession,
    deleteSession,
    purgeExpiredSessions,
    getResume,
    saveResume,
    quotaUsed,
    quotaConsume,
    quotaRefund,
    quotaDaysUsed,
    close,
  }
}
