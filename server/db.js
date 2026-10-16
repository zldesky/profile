/**
 * SQLite 数据层（node:sqlite，Node 22.13+ 内置，无原生编译依赖）。
 *
 * 存五类数据：
 *  1. users    —— 账号。密码只存 scrypt 摘要（见 auth.js），绝不落明文；
 *  2. sessions —— 服务端会话。令牌只存库，Cookie 里那份丢了可随时吊销；
 *  3. resumes  —— 每用户一份简历快照（JSON 文本），云端同步的权威源；
 *  4. export_quota —— 按主体（用户 / 匿名脚本）与自然日计的导出次数；
 *  5. shares   —— 简历分享快照（公开只读，带过期时间，本人可撤销；
 *                 勾选 listed 的同时进入官网简历合集）。
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

/** 合集分类：关键词按序首个命中生效，无命中归入 misc（其他） */
const CATEGORY_RULES = [
  [
    'tech',
    [
      '前端',
      '后端',
      '全栈',
      '开发',
      '工程师',
      '算法',
      '架构',
      '运维',
      '测试',
      '数据',
      '研发',
      '软件',
      '程序',
      'java',
      'python',
      'golang',
      'ios',
      'android',
      'php',
      'rust',
      'c++',
      'sre',
      'dba',
    ],
  ],
  ['product', ['产品']],
  ['design', ['设计', 'ui', 'ux', '视觉', '交互', '平面', '插画']],
  ['ops', ['运营', '客服', '电商']],
  ['marketing', ['市场', '营销', '品牌', '广告', '公关', '增长']],
  ['hr', ['人事', '人力资源', '招聘', '行政', 'hr']],
  ['finance', ['财务', '会计', '审计', '税务', '出纳', '投资', '风控', '金融', '证券']],
  ['sales', ['销售', '商务', '客户经理', 'bd', '顾问']],
  ['edu', ['教师', '老师', '讲师', '教育', '培训', '教练']],
]

/** 全部合法分类键（含 misc），供接口层做参数白名单 */
export const CATEGORY_KEYS = new Set([...CATEGORY_RULES.map(([key]) => key), 'misc'])

/**
 * 按求职意向推导合集分类。
 * 拉丁字母统一小写后做子串匹配；空值与未命中一律 misc。
 * @param {string} jobTitle 简历求职意向 / 目标岗位
 */
export function deriveCategory(jobTitle) {
  const text = String(jobTitle ?? '').toLowerCase()
  if (!text.trim()) return 'misc'
  for (const [key, words] of CATEGORY_RULES) {
    if (words.some((word) => text.includes(word))) return key
  }
  return 'misc'
}

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
      role          TEXT    NOT NULL DEFAULT 'member',
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS shares (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      data       TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      listed     INTEGER NOT NULL DEFAULT 0,
      category   TEXT    NOT NULL DEFAULT 'misc'
    );
  `)

  /**
   * 旧库迁移必须在所有 prepare 之前执行：预编译语句引用新列，
   * 老库上若先 prepare 后迁移，会直接报「no column named」。
   * 新库建表时已带这些列，ALTER 会因重名失败，按迁移完成处理。
   */
  let needsCategoryBackfill = false
  try {
    db.exec('ALTER TABLE shares ADD COLUMN listed INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* 列已存在 */
  }
  try {
    db.exec("ALTER TABLE shares ADD COLUMN category TEXT NOT NULL DEFAULT 'misc'")
    needsCategoryBackfill = true
  } catch {
    /* 列已存在 */
  }

  // 用户角色：首个注册的账号是实例所有者（管理后台用）。
  // 旧库迁移时把现存最早的用户提为管理员，保证升级后有可登录的管理员。
  try {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")
    db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)")
  } catch {
    /* 列已存在 */
  }

  /* ---------------- 用户 ---------------- */

  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
  )
  const selectUserByName = db.prepare(
    'SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?',
  )
  const selectUserById = db.prepare('SELECT id, username, role FROM users WHERE id = ?')
  const countUsers = db.prepare('SELECT COUNT(*) AS total FROM users')

  /**
   * 创建用户。用户名冲突（大小写不敏感）会抛出 SQLite 唯一约束错误，
   * 由调用方转成用户可读的提示。首个注册的账号即实例管理员。
   */
  function createUser(username, passwordHash) {
    const role = countUsers.get().total === 0 ? 'admin' : 'member'
    const result = insertUser.run(username, passwordHash, role, Date.now())
    return { id: Number(result.lastInsertRowid), username, role }
  }

  /** 登录用：按用户名取完整行（含密码摘要与角色）；未注册返回 undefined */
  function findUserByUsername(username) {
    return selectUserByName.get(String(username))
  }

  /** 会话态查询用：按 id 取公开字段（不含密码摘要） */
  function findUserById(id) {
    return selectUserById.get(id)
  }

  /** 是否管理员（供 requireAdmin 判定；仅认会话对应的用户行） */
  function isAdminUser(id) {
    return selectUserById.get(Number(id))?.role === 'admin'
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

  /* ---------------- 简历分享 ---------------- */

  const insertShare = db.prepare(
    'INSERT INTO shares (id, user_id, data, created_at, expires_at, listed, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const selectShare = db.prepare(
    'SELECT id, user_id, data, created_at, expires_at FROM shares WHERE id = ?',
  )
  const deleteOwnedShare = db.prepare('DELETE FROM shares WHERE id = ? AND user_id = ?')
  const deleteExpiredShares = db.prepare('DELETE FROM shares WHERE expires_at < ?')

  /**
   * 保存一份分享快照。id 冲突（极小概率）由调用方换号重试。
   * 合集分类按求职意向自动推导，分享者无需额外选择。
   * @param {boolean} [listed] 是否同时展示到公开简历合集（默认仅链接可访问）
   * @returns {{ id: string, createdAt: number, expiresAt: number }}
   */
  function createShare(id, userId, resumeObject, ttlMs, listed = false) {
    const now = Date.now()
    const category = deriveCategory(resumeObject?.basics?.jobTitle)
    insertShare.run(
      String(id),
      userId,
      JSON.stringify(resumeObject),
      now,
      now + ttlMs,
      listed ? 1 : 0,
      category,
    )
    return { id: String(id), createdAt: now, expiresAt: now + ttlMs }
  }

  /** 公开读取。过期行视为不存在（顺带删除） */
  function getShare(id) {
    const row = selectShare.get(String(id || ''))
    if (!row) return null
    if (row.expires_at <= Date.now()) {
      deleteExpiredShares.run(Date.now())
      return null
    }
    try {
      return {
        id: row.id,
        userId: row.user_id,
        resume: JSON.parse(row.data),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }
    } catch {
      return null
    }
  }

  /** 只允许分享者本人撤销；返回是否删到了行 */
  function deleteShare(id, userId) {
    if (!userId) return false
    return Number(deleteOwnedShare.run(String(id), userId).changes) > 0
  }

  /** 清理过期分享，挂在创建分享的调用路径上惰性执行 */
  function purgeExpiredShares() {
    return Number(deleteExpiredShares.run(Date.now()).changes)
  }

  const selectUserShares = db.prepare(`
    SELECT id, data, created_at, expires_at, listed FROM shares
    WHERE user_id = ? AND expires_at > ?
    ORDER BY created_at DESC
  `)

  /** 当前用户未过期的分享摘要（最新在前），供「我的分享」管理 */
  function listUserShares(userId) {
    return selectUserShares
      .all(userId, Date.now())
      .map((row) => {
        try {
          const basics = JSON.parse(row.data)?.basics || {}
          return {
            id: row.id,
            name: String(basics.name ?? '').slice(0, 40),
            jobTitle: String(basics.jobTitle ?? '').slice(0, 60),
            listed: row.listed === 1,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          }
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }

  /* ---------------- 应用配置（KV：管理后台的运行时配置存这里） ---------------- */

  const selectConfig = db.prepare('SELECT value FROM app_config WHERE key = ?')
  const upsertConfigStmt = db.prepare(
    'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )

  /** 读配置：键不存在或 JSON 损坏返回 null，调用方按未配置处理 */
  function getConfig(key) {
    const row = selectConfig.get(String(key))
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return null
    }
  }

  /** 写配置：整体覆盖，值须可 JSON 序列化 */
  function setConfig(key, value) {
    upsertConfigStmt.run(String(key), JSON.stringify(value))
  }

  /* ---------------- 简历分享（勾选展示的公开分享摘要） ---------------- */

  const selectCollectionPage = db.prepare(`
    SELECT id, data, created_at, category FROM shares
    WHERE listed = 1 AND expires_at > ?
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `)
  const selectCollectionPageByCategory = db.prepare(`
    SELECT id, data, created_at, category FROM shares
    WHERE listed = 1 AND expires_at > ? AND category = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `)
  const countCollectionStmt = db.prepare(
    'SELECT COUNT(*) AS total FROM shares WHERE listed = 1 AND expires_at > ?',
  )
  const countCollectionByCategory = db.prepare(
    'SELECT COUNT(*) AS total FROM shares WHERE listed = 1 AND expires_at > ? AND category = ?',
  )
  const selectCollectionFacets = db.prepare(`
    SELECT category, COUNT(*) AS count FROM shares
    WHERE listed = 1 AND expires_at > ?
    GROUP BY category
  `)
  const selectUncategorizedShares = db.prepare(
    "SELECT id, data FROM shares WHERE category = 'misc'",
  )
  const updateShareCategory = db.prepare('UPDATE shares SET category = ? WHERE id = ?')

  /**
   * 存量分享的分类回填：迁移刚发生时（category 列刚加上）跑一次。
   * 只把能推导出非 misc 的行改写；本来就是 misc 的行保持原样。
   */
  function backfillCategories() {
    for (const row of selectUncategorizedShares.iterate()) {
      try {
        const derived = deriveCategory(JSON.parse(row.data)?.basics?.jobTitle)
        if (derived !== 'misc') updateShareCategory.run(derived, row.id)
      } catch {
        /* 快照损坏的行保持 misc */
      }
    }
  }

  /** 从分享快照提取合集卡片需要的摘要；快照损坏的行跳过不入列表 */
  function collectionItemOf(row) {
    let resume
    try {
      resume = JSON.parse(row.data)
    } catch {
      return null
    }
    const basics = resume?.basics || {}
    const accent = resume?.theme?.accent
    return {
      id: row.id,
      // 摘要只取展示字段并限长；入库前已过 sanitize，这里再做一道兜底
      name: String(basics.name ?? '').slice(0, 40),
      jobTitle: String(basics.jobTitle ?? '').slice(0, 60),
      template: String(resume?.template ?? '').slice(0, 40),
      accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '',
      category: row.category || 'misc',
      createdAt: row.created_at,
    }
  }

  /**
   * 合集分页：勾选展示且未过期的分享，最新在前，可按分类过滤。
   * 只返回摘要（不含简历正文），正文由客户端按 id 走公开的 /api/share/:id 取。
   */
  function listCollection({ limit = 12, offset = 0, category = null } = {}) {
    const now = Date.now()
    const cap = (v) => Math.max(0, Math.floor(v))
    const rows = category
      ? selectCollectionPageByCategory.all(now, category, cap(limit), cap(offset))
      : selectCollectionPage.all(now, cap(limit), cap(offset))
    return rows.map(collectionItemOf).filter(Boolean)
  }

  /** 合集总数（可按分类），用于前端显示「还有 N 份」与翻页判断 */
  function countCollection({ category = null } = {}) {
    const total = category
      ? countCollectionByCategory.get(Date.now(), category).total
      : countCollectionStmt.get(Date.now()).total
    return Number(total)
  }

  /** 各分类的合集条数（只含有数分类，按固定顺序排列，misc 殿后） */
  function collectionFacets() {
    const counts = new Map(
      selectCollectionFacets.all(Date.now()).map((row) => [row.category, Number(row.count)]),
    )
    const order = [...CATEGORY_RULES.map(([key]) => key), 'misc']
    return order.filter((key) => counts.has(key)).map((key) => ({ key, count: counts.get(key) }))
  }

  /* ---------------- 旧库数据回填（列已就位，语句已准备） ---------------- */

  // category 列刚加上时为存量分享跑一次回填；新写入的行在 createShare 里已带分类。
  if (needsCategoryBackfill) backfillCategories()

  function close() {
    db.close()
  }

  return {
    createUser,
    findUserByUsername,
    findUserById,
    isAdminUser,
    createSession,
    findSession,
    deleteSession,
    purgeExpiredSessions,
    getResume,
    saveResume,
    getConfig,
    setConfig,
    createShare,
    getShare,
    deleteShare,
    purgeExpiredShares,
    listCollection,
    countCollection,
    listUserShares,
    collectionFacets,
    quotaUsed,
    quotaConsume,
    quotaRefund,
    quotaDaysUsed,
    close,
  }
}
