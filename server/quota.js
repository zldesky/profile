import fs from 'node:fs'
import path from 'node:path'

/** 每日导出上限，可用环境变量 PDF_DAILY_LIMIT 覆盖 */
const DEFAULT_LIMIT = 20

/**
 * 每日导出配额。
 *
 * 计数持久化到磁盘，重启服务不会重置；跨天后自动归零。
 * consume() 全程同步，Node 单线程下不存在「读-改-写」竞态，
 * 因此不需要加锁也不会超发。
 *
 * @param {object} options
 * @param {number} [options.limit] 每日上限
 * @param {string} options.filePath 计数文件路径
 */
export function createDailyQuota({ limit = DEFAULT_LIMIT, filePath }) {
  const pad = (value) => String(value).padStart(2, '0')

  /** 以本机时区的自然日为准 */
  function today() {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }

  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      // 日期不是今天说明已跨天，计数作废；已用量异常时同样按新的一天处理
      if (raw?.date === today() && Number.isFinite(raw.used) && raw.used >= 0) {
        return { date: raw.date, used: Math.floor(raw.used) }
      }
    } catch {
      /* 首次运行或计数文件损坏，按新的一天处理 */
    }
    return { date: today(), used: 0 }
  }

  function write(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(state), 'utf8')
  }

  function status() {
    const state = read()
    return {
      date: state.date,
      limit,
      used: state.used,
      remaining: Math.max(0, limit - state.used),
    }
  }

  /**
   * 取用一个额度。
   * @returns {{ ok: boolean, date: string, limit: number, used: number, remaining: number }}
   */
  function consume() {
    const state = read()
    if (state.used >= limit) return { ok: false, ...status() }

    const next = { date: state.date, used: state.used + 1 }
    write(next)
    return { ok: true, date: next.date, limit, used: next.used, remaining: limit - next.used }
  }

  /** 渲染失败时归还额度，不让用户为服务端问题买单 */
  function refund() {
    const state = read()
    if (state.used <= 0) return status()

    const next = { date: state.date, used: state.used - 1 }
    write(next)
    return { date: next.date, limit, used: next.used, remaining: limit - next.used }
  }

  return { status, consume, refund }
}
