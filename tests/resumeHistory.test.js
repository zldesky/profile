import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { installBrowserGlobals, uninstallBrowserGlobals } from './setup/browser-globals.js'

/**
 * 历史快照模块的测试。
 *
 * 采样有两道闸门（时间节流 + 内容去重）和一道 LRU，都是「错了也不会立刻报错，
 * 而是过一会儿才发现旧版本没了」的类型，值得逐条钉住。
 */

let H
let storage

beforeAll(async () => {
  const env = installBrowserGlobals()
  storage = env.storage
  ;({ ...H } = await import('@/stores/resumeHistory'))
})

afterAll(() => uninstallBrowserGlobals())

beforeEach(() => {
  globalThis.__failStorageKey(null)
  storage.clear()
})

/** 造一个已存在的快照列表 */
function snapList(count, { dataPrefix = 'data-', lastAt = 0 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `snap-${i}`,
    name: `快照 ${i}`,
    updatedAt: lastAt - (count - 1 - i) * 1000,
    data: `${dataPrefix}${i}`,
  }))
}

const sampleOptions = (overrides = {}) => ({
  serialize: () => 'fresh-data',
  getName: () => '我的简历',
  now: 10_000_000,
  ...overrides,
})

describe('读取与清洗', () => {
  it('空存储读出空列表', () => {
    expect(H.readSnapshots()).toEqual([])
  })

  it('损坏的 JSON 按空处理，不抛错', () => {
    storage.setItem('resume-studio-snapshots-v1', '{ 这不是 JSON')
    expect(H.readSnapshots()).toEqual([])
  })

  it('丢掉结构不合法的条目', () => {
    storage.setItem(
      'resume-studio-snapshots-v1',
      JSON.stringify([
        { id: 'ok', name: '好的', updatedAt: 1, data: 'x' },
        { id: 123, name: 'id 不是字符串', updatedAt: 1, data: 'x' },
        { id: 'no-data', name: '缺 data', updatedAt: 1 },
        null,
        ' 字符串',
      ]),
    )

    const list = H.readSnapshots()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('ok')
  })

  it('sanitizeSnapshots 补齐缺失字段并丢掉没有正文的条目', () => {
    const list = H.sanitizeSnapshots([
      { data: 'x' }, // 缺 id/name/updatedAt
      { id: 'a', name: '有名字', updatedAt: 5, data: 'y' },
      { id: 'b', data: '' }, // 没有正文，丢弃
      'not-an-object',
    ])

    expect(list).toHaveLength(2)
    expect(list[0].id).toBeTruthy()
    expect(list[0].name).toBe('未命名快照')
    expect(typeof list[0].updatedAt).toBe('number')
    expect(list[1]).toMatchObject({ id: 'a', name: '有名字', updatedAt: 5 })
  })
})

describe('采样闸门', () => {
  it('首次采样（列表为空）直接记一份', () => {
    const { list, sampled } = H.sample([], sampleOptions())

    expect(sampled).toBe(true)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('我的简历')
    expect(list[0].data).toBe('fresh-data')
    // 落盘了
    expect(JSON.parse(storage.getItem('resume-studio-snapshots-v1'))).toHaveLength(1)
  })

  it('间隔不足时跳过（节流）', () => {
    const existing = snapList(1, { dataPrefix: 'old-', lastAt: 10_000_000 })
    const { list, sampled } = H.sample(
      existing,
      sampleOptions({ now: 10_000_000 + H.SNAPSHOT_INTERVAL - 1 }),
    )

    expect(sampled).toBe(false)
    expect(list).toBe(existing)
  })

  it('间隔足够时采样', () => {
    const existing = snapList(1, { dataPrefix: 'old-', lastAt: 10_000_000 })
    const { list, sampled } = H.sample(
      existing,
      sampleOptions({ now: 10_000_000 + H.SNAPSHOT_INTERVAL }),
    )

    expect(sampled).toBe(true)
    expect(list).toHaveLength(2)
  })

  it('内容与上一份一致时跳过（去重）', () => {
    // 构造「上一份的 data 恰好等于本次序列化结果」的情形：
    // 频繁刷新不该用重复快照把有价值的旧版本挤出 LRU
    const existing = snapList(1, { dataPrefix: '', lastAt: 10_000_000 })
    expect(existing[0].data).toBe('0')

    const { list, sampled } = H.sample(
      existing,
      sampleOptions({ serialize: () => '0', now: 10_000_000 + H.SNAPSHOT_INTERVAL * 2 }),
    )

    expect(sampled).toBe(false)
    expect(list).toBe(existing)
  })

  it('内容有变化时即使上一份很近也会采样（force 场景）', () => {
    const existing = snapList(1, { dataPrefix: 'old-', lastAt: 10_000_000 })
    const { sampled } = H.sample(existing, sampleOptions({ force: true, now: 10_000_000 + 1 }))

    expect(sampled).toBe(true)
  })

  it('force 跳过时间闸门，但仍做内容去重', () => {
    const existing = snapList(1, { dataPrefix: 'old-', lastAt: 10_000_000 })

    const forced = H.sample(existing, sampleOptions({ force: true, now: 10_000_001 }))
    expect(forced.sampled).toBe(true)
    expect(forced.list).toHaveLength(2)

    // 内容没变时即使 force 也不重复记
    const same = H.sample(forced.list, sampleOptions({ force: true, now: 10_000_002 }))
    expect(same.sampled).toBe(false)
    expect(same.list).toBe(forced.list)
  })
})

describe('LRU 上限', () => {
  it('超出上限时从最旧的丢弃', () => {
    const existing = snapList(H.SNAPSHOT_MAX, { dataPrefix: 'old-', lastAt: 0 })
    const { list, sampled } = H.sample(
      existing,
      sampleOptions({ now: 10_000_000 + H.SNAPSHOT_INTERVAL }),
    )

    expect(sampled).toBe(true)
    expect(list).toHaveLength(H.SNAPSHOT_MAX)
    // 最旧那条被挤出去了
    expect(list.some((s) => s.id === 'snap-0')).toBe(false)
    // 新的排在最后
    expect(list[list.length - 1].data).toBe('fresh-data')
  })

  it('恰好在上限内不丢弃', () => {
    const existing = snapList(H.SNAPSHOT_MAX - 1, { dataPrefix: 'old-', lastAt: 0 })
    const { list } = H.sample(existing, sampleOptions({ now: 10_000_000 + H.SNAPSHOT_INTERVAL }))

    expect(list).toHaveLength(H.SNAPSHOT_MAX)
    expect(list[0].id).toBe('snap-0')
  })
})

describe('写入失败时的降级', () => {
  it('写不进时砍半重试，重试成功则保留后半段', () => {
    const existing = snapList(8, { dataPrefix: 'old-', lastAt: 0 })
    // 第一次写失败，之后恢复
    let calls = 0
    const original = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      calls += 1
      if (calls === 1) throw new Error('爆了')
      original(key, value)
    }

    try {
      const { list, sampled } = H.sample(
        existing,
        sampleOptions({ now: 10_000_000 + H.SNAPSHOT_INTERVAL }),
      )
      expect(sampled).toBe(true)
      // 砍半丢掉前 5 条（ceil(9/2)），剩下 4 条
      expect(list).toHaveLength(4)
    } finally {
      delete storage.setItem
    }
  })

  it('重试也失败时放弃本轮采样，返回原列表', () => {
    const existing = snapList(3, { dataPrefix: 'old-', lastAt: 0 })
    globalThis.__failStorageKey('resume-studio-snapshots-v1')

    try {
      const { list, sampled } = H.sample(
        existing,
        sampleOptions({ now: 10_000_000 + H.SNAPSHOT_INTERVAL }),
      )
      expect(sampled).toBe(false)
      expect(list).toBe(existing)
    } finally {
      globalThis.__failStorageKey(null)
    }
  })
})

describe('取用与覆盖', () => {
  it('snapshotData 取正文，找不到返回 null', () => {
    const list = snapList(2)

    expect(H.snapshotData(list, 'snap-1')).toBe('data-1')
    expect(H.snapshotData(list, '不存在')).toBeNull()
  })

  it('replaceSnapshots 覆盖整份列表', () => {
    storage.setItem('resume-studio-snapshots-v1', JSON.stringify(snapList(3)))

    H.replaceSnapshots([{ id: 'only', name: '唯一', updatedAt: 1, data: 'z' }])

    const reread = H.readSnapshots()
    expect(reread).toHaveLength(1)
    expect(reread[0].id).toBe('only')
  })
})
