import { describe, expect, it } from 'vitest'

import { createSemaphore } from '../server/semaphore.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('渲染并发信号量', () => {
  it('并发位内同时执行，超出排队', async () => {
    const slots = createSemaphore({ concurrency: 2, maxQueue: 10 })
    let running = 0
    let peak = 0

    const task = async () => {
      running += 1
      peak = Math.max(peak, running)
      await tick()
      running -= 1
    }

    await Promise.all(Array.from({ length: 6 }, () => slots.run(task)))
    expect(peak).toBe(2)
  })

  it('队列满时直接拒绝（429），不占用槽位', async () => {
    const slots = createSemaphore({ concurrency: 1, maxQueue: 1 })
    let releaseFirst
    const gate = new Promise((resolve) => {
      releaseFirst = resolve
    })

    const first = slots.run(() => gate)
    const second = slots.run(() => tick()) // 占用队列位
    await tick()

    await expect(slots.run(() => tick())).rejects.toMatchObject({ statusCode: 429 })

    releaseFirst()
    await first
    await second
    expect(slots.stats().active).toBe(0)
  })

  it('排队等待超时后拒绝（429），槽位流转不受影响', async () => {
    const slots = createSemaphore({ concurrency: 1, maxQueue: 5, queueTimeoutMs: 20 })
    let releaseFirst
    const gate = new Promise((resolve) => {
      releaseFirst = resolve
    })

    const first = slots.run(() => gate)
    await tick()

    // 两个等待者都会超时；之后槽位仍能正常使用
    await expect(slots.run(() => tick())).rejects.toMatchObject({ statusCode: 429 })
    await expect(slots.run(() => tick())).rejects.toMatchObject({ statusCode: 429 })

    releaseFirst()
    await first
    expect(slots.stats()).toEqual({ active: 0, queued: 0 })
    await expect(slots.run(() => 'ok')).resolves.toBe('ok')
  })

  it('任务抛错时槽位照常归还', async () => {
    const slots = createSemaphore({ concurrency: 1, maxQueue: 1 })
    await expect(
      slots.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(slots.run(async () => 'recovered')).resolves.toBe('recovered')
  })

  it('非法配置在创建时即报错', () => {
    expect(() => createSemaphore({ concurrency: 0, maxQueue: 1 })).toThrow()
    expect(() => createSemaphore({ concurrency: 2, maxQueue: -1 })).toThrow()
  })
})
