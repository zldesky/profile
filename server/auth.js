/**
 * 接口口令校验与账号凭证。
 *
 * 服务只监听回环地址时，口令是一层额外防线；一旦对外暴露，它就是唯一防线，
 * 因此这里按「会被爆破」的前提来设计：常量时间比较 + 连续失败锁定。
 *
 * 账号密码用 node:crypto 的 scrypt（内存困难型，与 argon2id 同属 OWASP
 * 认可的口令摘要算法）：选它而不是 argon2 包，是为了保持服务端零原生
 * 依赖——换机器、换容器镜像都不用重编译。参数取 OWASP 建议区间的保守值，
 * 摘要格式自带算法与参数，未来升级算法可以按前缀平滑迁移。
 */
import crypto from 'node:crypto'

/** 连续失败上限与锁定时长，避免口令被逐个试出来 */
const MAX_FAILURES = 10
const LOCK_MS = 15 * 60 * 1000

/**
 * 常量时间比较。
 *
 * 逐字符比较在首个不同字符处就会返回，攻击者能靠响应时间差逐位推断口令；
 * 先各自摘要成定长值（顺带抹掉长度差异）再比对，耗时就与内容无关。
 * @param {string} a
 * @param {string} b
 */
function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(a).digest()
  const right = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(left, right)
}

/**
 * 监听地址是否仅本机可达。
 * 非回环地址意味着局域网乃至公网都能连上，此时必须有口令兜底。
 * @param {string} host
 */
export function isLoopbackHost(host) {
  const value = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')

  return (
    value === 'localhost' || value === '::1' || value === '::ffff:127.0.0.1' || /^127\./.test(value)
  )
}

/**
 * 从 Authorization 头取 Bearer 口令。
 *
 * 用请求头而不是 URL 查询参数：查询参数会被写进访问日志、浏览器历史与 Referer，
 * 等于把口令到处散播。
 * @param {import('express').Request} req
 */
export function readPassword(req) {
  const raw = req.get('authorization') || ''
  const matched = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return matched ? matched[1].trim() : ''
}

/**
 * 创建口令守卫。
 * @param {object} options
 * @param {string} [options.password] 期望口令，空串表示不启用校验
 * @param {number} [options.maxFailures] 连续失败上限
 * @param {number} [options.lockMs] 触发上限后的锁定时长
 */
export function createPasswordGuard({
  password = '',
  maxFailures = MAX_FAILURES,
  lockMs = LOCK_MS,
} = {}) {
  // 环境变量很容易带进行尾空格或不可见字符，必须裁剪后再比较
  const secret = String(password).trim()
  const enabled = secret.length > 0

  /** 失败时间戳滑动窗口 */
  let failures = []
  let lockedUntil = 0

  const isLocked = () => Date.now() < lockedUntil

  function noteFailure() {
    const now = Date.now()
    failures = failures.filter((at) => now - at < lockMs)
    failures.push(now)

    if (failures.length >= maxFailures) {
      lockedUntil = now + lockMs
      failures = []
    }
  }

  function reset() {
    failures = []
    lockedUntil = 0
  }

  /**
   * 校验口令。
   *
   * 返回值要区分「没带口令」和「口令错误」：不带口令是页面首次探测，
   * 若也计入失败次数，正常轮询就会把服务锁死，反倒成了拒绝服务。
   *
   * @param {string} input 待校验口令
   * @returns {'ok' | 'missing' | 'bad' | 'locked'}
   */
  function verify(input) {
    if (!enabled) return 'ok'

    const candidate = String(input || '').trim()
    if (!candidate) return 'missing'
    if (isLocked()) return 'locked'

    if (safeEqual(candidate, secret)) {
      reset()
      return 'ok'
    }

    noteFailure()
    return 'bad'
  }

  return {
    enabled,
    verify,
    /** 剩余锁定毫秒数，未锁定为 0 */
    lockedMs: () => Math.max(0, lockedUntil - Date.now()),
  }
}

/* ---------------- 账号密码 ---------------- */

/**
 * scrypt 参数：N=2^15（32MiB 内存成本）、r=8、p=1，登录耗时约几十毫秒。
 * Node 默认 maxmem 32MiB 恰好压线会直接报错，显式放宽到 96MiB。
 */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 }

/** 用户名：2–32 位，中英文、数字、下划线、连字符；入库前还会整串绑定参数 */
const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,32}$/

/**
 * 校验注册凭证，返回出错原因；通过时返回空串。
 * 密码长度上限 72 与 bcrypt 对齐，也避免超长输入拖慢摘要。
 * @param {string} username
 * @param {string} password
 */
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 2-32 位中英文、数字、下划线或连字符'
  }
  if (typeof password !== 'string' || password.length < 8) {
    return '密码至少 8 位'
  }
  if (password.length > 72) {
    return '密码最长 72 位'
  }
  return ''
}

/**
 * 生成口令摘要，格式：scrypt$N$r$p$salt$hash（均 base64url）。
 * 自带参数存储，未来调高强度时老账号仍可校验、可在改密时自动升级。
 * @param {string} password
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  })
  const b64 = (buffer) => buffer.toString('base64url')
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64(salt)}$${b64(hash)}`
}

/**
 * 校验口令与摘要是否匹配。摘要格式不符一律按失败处理，
 * 不抛异常——失败路径也要保持与成功路径相近的成本，避免被当探针。
 * @param {string} password
 * @param {string} stored hashPassword 的产物
 */
export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, 'base64url')
  if (expected.length === 0) return false

  const actual = crypto.scryptSync(
    String(password),
    Buffer.from(salt, 'base64url'),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    },
  )
  return crypto.timingSafeEqual(actual, expected)
}

/**
 * 登录失败锁定（按「IP + 用户名」维度）。
 *
 * 与共享口令的锁定不同：按组合键锁定，攻击者换一个用户名不会拖累其他人，
 * 正常用户从别的网络来也不会被殃及。
 * @param {object} [options]
 * @param {number} [options.maxFailures] 窗口内允许的连续失败次数
 * @param {number} [options.windowMs] 失败计数的滑动窗口
 * @param {number} [options.lockMs] 触发上限后的锁定时长
 */
export function createLoginGuard({
  maxFailures = 10,
  windowMs = 15 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
} = {}) {
  /** @type {Map<string, { failures: number[], lockedUntil: number }>} */
  const state = new Map()

  const keyOf = (ip, username) => `${ip}|${String(username).toLowerCase()}`

  /** 简单的过期清理，避免长期运行下 Map 无限增长 */
  function sweep(now) {
    for (const [key, entry] of state) {
      if (
        entry.lockedUntil <= now &&
        (entry.failures.length === 0 || now - entry.failures[entry.failures.length - 1] > windowMs)
      ) {
        state.delete(key)
      }
    }
  }

  function entryOf(key) {
    let entry = state.get(key)
    if (!entry) {
      entry = { failures: [], lockedUntil: 0 }
      state.set(key, entry)
    }
    return entry
  }

  /** 当前是否处于锁定中；返回剩余毫秒数（0 表示未锁定） */
  function lockedMs(ip, username) {
    const entry = state.get(keyOf(ip, username))
    if (!entry) return 0
    return Math.max(0, entry.lockedUntil - Date.now())
  }

  function noteFailure(ip, username) {
    const now = Date.now()
    sweep(now)
    const entry = entryOf(keyOf(ip, username))
    entry.failures = entry.failures.filter((at) => now - at < windowMs)
    entry.failures.push(now)
    if (entry.failures.length >= maxFailures) {
      entry.lockedUntil = now + lockMs
      entry.failures = []
    }
  }

  /** 登录成功后调用，清空该组合的失败记录 */
  function reset(ip, username) {
    state.delete(keyOf(ip, username))
  }

  return { lockedMs, noteFailure, reset }
}

/**
 * 从 Cookie 头解析键值对。只依赖标准库，避免为一个解析器引入 cookie-parser。
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  const cookies = {}
  if (!header) return cookies

  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    if (!name) continue
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      /* 编码非法的 Cookie 直接丢弃，不影响其他键 */
    }
  }
  return cookies
}

/**
 * 滑动窗口计数器：窗口内每个键最多放行 max 次，用于注册这类
 * 「按次收紧」的场景（区别于登录的连续失败锁定）。
 * @param {object} options
 * @param {number} options.max 窗口内允许的最大次数
 * @param {number} options.windowMs 窗口时长
 */
export function createSlidingWindowCounter({ max, windowMs }) {
  /** @type {Map<string, number[]>} 键 → 窗口内的取用时间戳 */
  const state = new Map()

  function sweep(now) {
    for (const [key, hits] of state) {
      if (hits.every((at) => now - at >= windowMs)) state.delete(key)
    }
  }

  /**
   * 尝试取用一次。放行返回 true，超限返回 false。
   * @param {string} key 通常为客户端 IP
   */
  function tryTake(key) {
    const now = Date.now()
    sweep(now)

    const hits = (state.get(key) || []).filter((at) => now - at < windowMs)
    if (hits.length >= max) {
      state.set(key, hits)
      return false
    }

    hits.push(now)
    state.set(key, hits)
    return true
  }

  return { tryTake }
}

/**
 * 生成会话令牌：256 位随机数的 base64url，服务端只存这一份，
 * 泄露前无法预测，也不携带任何可解读信息（对比 JWT）。
 */
export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url')
}
