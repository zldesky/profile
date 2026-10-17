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

/* ---------------- 导出类型 ---------------- */

/** 用户行：密码只存 scrypt 摘要，绝不落明文 */
export interface UserRecord {
  id: number
  username: string
  password_hash: string
  role: string
  created_at: number
}

/** 会话查询返回的公开字段（不含密码摘要） */
export interface PublicUser {
  id: number
  username: string
  role: string
}

/** 会话行：令牌只存库，Cookie 里那份丢了可随时吊销 */
export interface SessionRecord {
  token: string
  user_id: number
  expires_at: number
}

/** 合集分页与「我的分享」用的摘要（不含简历正文） */
export interface CollectionItem {
  id: string
  name: string
  jobTitle: string
  template: string
  accent: string
  category: string
  createdAt: number
}

/** 「我的分享」列表项：比合集摘要多一个是否已公开列出 */
export interface UserShareItem {
  id: string
  name: string
  jobTitle: string
  listed: boolean
  createdAt: number
  expiresAt: number
}

/** SELECT 出来的行：SQL 列名是蛇形，对外统一转驼峰 */
interface ShareListRow {
  id: string
  data: string
  created_at: number
  expires_at: number
  listed: number
}

interface CollectionRow {
  id: string
  data: string
  created_at: number
  category: string
}

export interface DatabaseOptions {
  /** 库文件路径；传 ':memory:' 用于测试 */
  filePath?: string
}

/** 打开数据库后暴露的全部操作。路由层只依赖这个形状 */
export interface Database {
  createUser: (
    username: string,
    passwordHash: string,
  ) => { id: number; username: string; role: string }
  findUserByUsername: (username: string) => UserRecord | undefined
  findUserById: (id: number | string) => PublicUser | undefined
  isAdminUser: (id: number | string) => boolean
  createSession: (userId: number, token: string, ttlMs?: number) => string
  findSession: (token: string) => SessionRecord | null
  deleteSession: (token: string) => void
  purgeExpiredSessions: () => number
  getResume: (userId: number) => { resume: unknown; updatedAt: number } | null
  saveResume: (userId: number, resumeObject: unknown) => { updatedAt: number }
  getConfig: (key: string) => unknown
  setConfig: (key: string, value: unknown) => void
  createShare: (
    id: string,
    userId: number | null,
    resumeObject: unknown,
    ttlMs: number,
    listed?: boolean,
  ) => { id: string; createdAt: number; expiresAt: number }
  getShare: (id: string) => {
    id: string
    userId: number | null
    resume: unknown
    createdAt: number
    expiresAt: number
  } | null
  deleteShare: (id: string, userId: number | null) => boolean
  purgeExpiredShares: () => number
  listCollection: (options?: {
    limit?: number
    offset?: number
    category?: string | null
  }) => CollectionItem[]
  countCollection: (options?: { category?: string | null }) => number
  listUserShares: (userId: number) => UserShareItem[]
  collectionFacets: () => Array<{ key: string; count: number }>
  quotaUsed: (subject: string, day: string) => number
  quotaConsume: (subject: string, day: string) => number
  quotaRefund: (subject: string, day: string) => void
  quotaDaysUsed: (day: string) => number
  close: () => void
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 会话有效期：30 天不活跃才过期，过期行在登录时惰性清理 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 合集分类：关键词按序首个命中生效，无命中归入 misc（其他） */
const CATEGORY_RULES: Array<[string, string[]]> = [
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
 * @param jobTitle 简历求职意向 / 目标岗位
 */
export function deriveCategory(jobTitle: unknown): string {
  const text = String(jobTitle ?? '').toLowerCase()
  if (!text.trim()) return 'misc'
  for (const [key, words] of CATEGORY_RULES) {
    if (words.some((word) => text.includes(word))) return key
  }
  return 'misc'
}

/**
 * 打开（或创建）数据库。
 * @param options.filePath 库文件路径；传 ':memory:' 用于测试
 */
export function createDatabase({
  filePath = path.join(__dirname, '.data', 'app.db'),
}: DatabaseOptions = {}): Database {
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
  function createUser(
    username: string,
    passwordHash: string,
  ): { id: number; username: string; role: string } {
    const total = (countUsers.get() as { total: number } | undefined)?.total ?? 0
    const role = total === 0 ? 'admin' : 'member'
    const result = insertUser.run(username, passwordHash, role, Date.now())
    return { id: Number(result.lastInsertRowid), username, role }
  }

  /** 登录用：按用户名取完整行（含密码摘要与角色）；未注册返回 undefined */
  function findUserByUsername(username: string): UserRecord | undefined {
    return selectUserByName.get(String(username)) as UserRecord | undefined
  }

  /** 会话态查询用：按 id 取公开字段（不含密码摘要） */
  function findUserById(id: number | string): PublicUser | undefined {
    return selectUserById.get(id) as PublicUser | undefined
  }

  /** 是否管理员（供 requireAdmin 判定；仅认会话对应的用户行） */
  function isAdminUser(id: number | string): boolean {
    return (selectUserById.get(Number(id)) as PublicUser | undefined)?.role === 'admin'
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

  function createSession(userId: number, token: string, ttlMs: number = SESSION_TTL_MS): string {
    const now = Date.now()
    insertSession.run(token, userId, now, now + ttlMs)
    return token
  }

  /** 未过期才返回会话；过期行视为不存在（顺带清掉，不让死会话堆积） */
  function findSession(token: string): SessionRecord | null {
    const row = selectSession.get(String(token || '')) as SessionRecord | undefined
    if (!row) return null
    if (row.expires_at <= Date.now()) {
      deleteSessionStmt.run(row.token)
      return null
    }
    return row
  }

  function deleteSession(token: string): void {
    deleteSessionStmt.run(String(token || ''))
  }

  function purgeExpiredSessions(): number {
    return Number(deleteExpiredSessions.run(Date.now()).changes)
  }

  /* ---------------- 简历快照 ---------------- */

  const upsertResume = db.prepare(`
    INSERT INTO resumes (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `)
  const selectResume = db.prepare('SELECT data, updated_at FROM resumes WHERE user_id = ?')

  /** 保存简历快照（整体覆盖，最后写入者胜出） */
  function saveResume(userId: number, resumeObject: unknown): { updatedAt: number } {
    const updatedAt = Date.now()
    upsertResume.run(userId, JSON.stringify(resumeObject), updatedAt)
    return { updatedAt }
  }

  /** 无快照时返回 null，由路由层决定是回落到示例还是提示 */
  function getResume(userId: number): { resume: unknown; updatedAt: number } | null {
    const row = selectResume.get(userId) as { data: string; updated_at: number } | undefined
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
  function quotaUsed(subject: string, day: string): number {
    const row = selectQuota.get(subject, day) as { used: number } | undefined
    return row ? row.used : 0
  }

  /** 计数 +1 并返回最新值。同步执行，单线程下不存在超发 */
  function quotaConsume(subject: string, day: string): number {
    upsertQuota.run(subject, day)
    return quotaUsed(subject, day)
  }

  /** 渲染失败归还额度，不让用户为服务端问题买单 */
  function quotaRefund(subject: string, day: string): void {
    refundQuotaStmt.run(subject, day)
  }

  /** 全站当日总量，作为成本兜底的依据 */
  function quotaDaysUsed(day: string): number {
    return Number((sumQuotaByDay.get(day) as { total: number }).total)
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
   * @param listed 是否同时展示到公开简历合集（默认仅链接可访问）
   */
  function createShare(
    id: string,
    userId: number | null,
    resumeObject: unknown,
    ttlMs: number,
    listed = false,
  ): { id: string; createdAt: number; expiresAt: number } {
    const now = Date.now()
    const category = deriveCategory(
      (resumeObject as { basics?: { jobTitle?: unknown } })?.basics?.jobTitle,
    )
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
  function getShare(id: string): {
    id: string
    userId: number | null
    resume: unknown
    createdAt: number
    expiresAt: number
  } | null {
    const row = selectShare.get(String(id || '')) as
      | { id: string; user_id: number | null; data: string; created_at: number; expires_at: number }
      | undefined
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
  function deleteShare(id: string, userId: number | null): boolean {
    if (!userId) return false
    return Number(deleteOwnedShare.run(String(id), userId).changes) > 0
  }

  /** 清理过期分享，挂在创建分享的调用路径上惰性执行 */
  function purgeExpiredShares(): number {
    return Number(deleteExpiredShares.run(Date.now()).changes)
  }

  const selectUserShares = db.prepare(`
    SELECT id, data, created_at, expires_at, listed FROM shares
    WHERE user_id = ? AND expires_at > ?
    ORDER BY created_at DESC
  `)

  /** 当前用户未过期的分享摘要（最新在前），供「我的分享」管理 */
  function listUserShares(userId: number): UserShareItem[] {
    // node:sqlite 的行类型是 Record<string, SQLOutputValue>，与具体行结构不重叠，
    // 因此经 unknown 桥接：列名与结构由上面的 SELECT 语句保证
    return (selectUserShares.all(userId, Date.now()) as unknown as ShareListRow[])
      .map((row): UserShareItem | null => {
        try {
          const basics =
            (JSON.parse(row.data) as { basics?: Record<string, unknown> })?.basics || {}
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
      .filter((item): item is UserShareItem => item !== null)
  }

  /* ---------------- 应用配置（KV：管理后台的运行时配置存这里） ---------------- */

  const selectConfig = db.prepare('SELECT value FROM app_config WHERE key = ?')
  const upsertConfigStmt = db.prepare(
    'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )

  /** 读配置：键不存在或 JSON 损坏返回 null，调用方按未配置处理 */
  function getConfig(key: string): unknown {
    const row = selectConfig.get(String(key)) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return null
    }
  }

  /** 写配置：整体覆盖，值须可 JSON 序列化 */
  function setConfig(key: string, value: unknown): void {
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
  function backfillCategories(): void {
    for (const row of selectUncategorizedShares.iterate() as Iterable<{
      id: string
      data: string
    }>) {
      try {
        const derived = deriveCategory(
          (JSON.parse(row.data) as { basics?: { jobTitle?: unknown } })?.basics?.jobTitle,
        )
        if (derived !== 'misc') updateShareCategory.run(derived, row.id)
      } catch {
        /* 快照损坏的行保持 misc */
      }
    }
  }

  /** 从分享快照提取合集卡片需要的摘要；快照损坏的行跳过不入列表 */
  function collectionItemOf(row: CollectionRow): CollectionItem | null {
    let resume: {
      basics?: Record<string, unknown>
      theme?: { accent?: unknown }
      template?: unknown
    }
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
      accent: typeof accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '',
      category: row.category || 'misc',
      createdAt: row.created_at,
    }
  }

  /**
   * 合集分页：勾选展示且未过期的分享，最新在前，可按分类过滤。
   * 只返回摘要（不含简历正文），正文由客户端按 id 走公开的 /api/share/:id 取。
   */
  function listCollection({
    limit = 12,
    offset = 0,
    category = null,
  }: { limit?: number; offset?: number; category?: string | null } = {}): CollectionItem[] {
    const now = Date.now()
    const cap = (v: number): number => Math.max(0, Math.floor(v))
    const rows = category
      ? selectCollectionPageByCategory.all(now, category, cap(limit), cap(offset))
      : selectCollectionPage.all(now, cap(limit), cap(offset))
    return (rows as unknown as CollectionRow[])
      .map(collectionItemOf)
      .filter((item): item is CollectionItem => item !== null)
  }

  /** 合集总数（可按分类），用于前端显示「还有 N 份」与翻页判断 */
  function countCollection({ category = null }: { category?: string | null } = {}): number {
    const total = category
      ? (countCollectionByCategory.get(Date.now(), category) as { total: number }).total
      : (countCollectionStmt.get(Date.now()) as { total: number }).total
    return Number(total)
  }

  /** 各分类的合集条数（只含有数分类，按固定顺序排列，misc 殿后） */
  function collectionFacets(): Array<{ key: string; count: number }> {
    const counts = new Map<string, number>(
      (selectCollectionFacets.all(Date.now()) as Array<{ category: string; count: number }>).map(
        (row) => [row.category, Number(row.count)],
      ),
    )
    const order = [...CATEGORY_RULES.map(([key]) => key), 'misc']
    return order
      .filter((key) => counts.has(key))
      .map((key) => ({ key, count: counts.get(key) as number }))
  }

  /* ---------------- 旧库数据回填（列已就位，语句已准备） ---------------- */

  // category 列刚加上时为存量分享跑一次回填；新写入的行在 createShare 里已带分类。
  if (needsCategoryBackfill) backfillCategories()

  function close(): void {
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
