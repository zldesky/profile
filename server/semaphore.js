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

/**
 * @param {object} options
 * @param {number} options.concurrency 同时执行的渲染上限
 * @param {number} options.maxQueue 排队上限，超过直接拒绝
 * @param {number} [options.queueTimeoutMs] 排队等待上限
 * @returns {{ run<T>(task: () => Promise<T>): Promise<T>, stats: () => { active: number, queued: number } }}
 */
export function createSemaphore({ concurrency, maxQueue, queueTimeoutMs = 10000 }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`并发上限非法：${concurrency}`)
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 0) {
    throw new Error(`排队上限非法：${maxQueue}`)
  }

  let active = 0
  /** @type {Array<{ resolve: () => void, timer: NodeJS.Timeout }>} */
  const waiters = []

  function dequeue() {
    const next = waiters.shift()
    if (!next) {
      active -= 1
      return
    }
    // 槽位直接移交给下一个等待者，active 保持不变
    clearTimeout(next.timer)
    next.resolve()
  }

  function acquire() {
    if (active < concurrency) {
      active += 1
      return Promise.resolve()
    }

    if (waiters.length >= maxQueue) {
      const error = new Error('渲染排队已满，请稍后再试')
      error.statusCode = 429
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) waiters.splice(index, 1)
        const timeout = new Error('渲染排队超时，请稍后再试')
        timeout.statusCode = 429
        reject(timeout)
      }, queueTimeoutMs)

      waiters.push({ resolve, timer })
    })
  }

  /**
   * 在并发闸门内执行任务。任务抛错时槽位照常归还。
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  async function run(task) {
    await acquire()
    try {
      return await task()
    } finally {
      dequeue()
    }
  }

  function stats() {
    return { active, queued: waiters.length }
  }

  return { run, stats }
}
