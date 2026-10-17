/**
 * 渲染并发闸门。
 *
 * 每个导出请求都要开一个浏览器 context，内存成本远高于普通接口；
 * 没有上限时，突发并发（正常洪峰或恶意刷接口）会直接把进程拖垮。
 * 这个信号量把「刷接口」的后果从「打爆内存」降级为「排队变慢」：
 *  - 并发位满 → 请求排队，最多 maxQueue 个，再多的直接拒绝（429）；
 *  - 排队等待超过 queueTimeoutMs → 放弃（429），避免客户端挂着无限等。
 *
 * Node 单线程下 acquire/release 都是同步段，不存在竞态。
 */

/** 带 HTTP 状态码的错误：路由层据此直接回 429，不必再判断错误类型 */
export interface HttpError extends Error {
  statusCode: number
}

export interface SemaphoreOptions {
  /** 同时执行的渲染上限 */
  concurrency: number
  /** 排队上限，超过直接拒绝 */
  maxQueue: number
  /** 排队等待上限（毫秒），默认 10 秒 */
  queueTimeoutMs?: number
}

export interface SemaphoreStats {
  active: number
  queued: number
}

export interface Semaphore {
  run<T>(task: () => Promise<T>): Promise<T>
  stats: () => SemaphoreStats
}

export function createSemaphore({
  concurrency,
  maxQueue,
  queueTimeoutMs = 10000,
}: SemaphoreOptions): Semaphore {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`并发上限非法：${concurrency}`)
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 0) {
    throw new Error(`排队上限非法：${maxQueue}`)
  }

  let active = 0
  /** 排队中的任务：resolve 用来把槽位直接移交过去，timer 用来做超时放弃 */
  const waiters: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = []

  function dequeue(): void {
    const next = waiters.shift()
    if (!next) {
      active -= 1
      return
    }
    // 槽位直接移交给下一个等待者，active 保持不变
    clearTimeout(next.timer)
    next.resolve()
  }

  function acquire(): Promise<void> {
    if (active < concurrency) {
      active += 1
      return Promise.resolve()
    }

    if (waiters.length >= maxQueue) {
      const error: HttpError = Object.assign(new Error('渲染排队已满，请稍后再试'), {
        statusCode: 429,
      })
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) waiters.splice(index, 1)
        const timeout: HttpError = Object.assign(new Error('渲染排队超时，请稍后再试'), {
          statusCode: 429,
        })
        reject(timeout)
      }, queueTimeoutMs)

      waiters.push({ resolve, timer })
    })
  }

  /** 在并发闸门内执行任务。任务抛错时槽位照常归还 */
  async function run<T>(task: () => Promise<T>): Promise<T> {
    await acquire()
    try {
      return await task()
    } finally {
      dequeue()
    }
  }

  function stats(): SemaphoreStats {
    return { active, queued: waiters.length }
  }

  return { run, stats }
}
