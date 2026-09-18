/**
 * 接口口令校验。
 *
 * 服务只监听回环地址时，口令是一层额外防线；一旦对外暴露，它就是唯一防线，
 * 因此这里按「会被爆破」的前提来设计：常量时间比较 + 连续失败锁定。
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
