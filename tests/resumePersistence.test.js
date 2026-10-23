import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { installBrowserGlobals, uninstallBrowserGlobals } from './setup/browser-globals.js'
import { makeResume } from './helpers/resume-fixtures.js'

/**
 * 本地持久化底座的测试：键名、紧凑序列化、配额保护与自动保存调度。
 *
 * 配额这条最值得测：超限时 localStorage 抛的是同步异常，若不在这一层降级成可读提示，
 * 一次自动保存失败会顺着 Vue 的 watch 调度变成未捕获错误。
 */

let P
let storage

beforeAll(async () => {
  const env = installBrowserGlobals()
  storage = env.storage
  ;({ ...P } = await import('@/stores/resumePersistence'))
})

afterAll(() => uninstallBrowserGlobals())

beforeEach(() => {
  globalThis.__failStorageKey(null)
  storage.clear()
})

describe('键名', () => {
  it('docKey 带统一前缀', () => {
    expect(P.docKey('abc')).toBe(`${P.DOC_KEY_PREFIX}abc`)
    expect(P.DOC_KEY_PREFIX).toBe('resume-studio-doc-')
  })

  it('各键名互不相同，避免互相覆盖', () => {
    const keys = [
      P.STORAGE_KEY,
      P.REGISTRY_KEY,
      P.ACTIVE_DOC_KEY,
      P.SNAPSHOTS_KEY,
      P.DOC_KEY_PREFIX,
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('errorMessage', () => {
  it('Error 取 message', () => {
    expect(P.errorMessage(new Error('炸了'))).toBe('炸了')
  })

  it('非 Error 也能给出可读文本（catch 到的是 unknown）', () => {
    expect(P.errorMessage('纯字符串')).toBe('纯字符串')
    expect(P.errorMessage(undefined)).toBe('undefined')
  })
})

describe('原始读写', () => {
  it('写入后能读回', () => {
    expect(P.writeJSON('k', { a: 1 })).toBe(true)
    expect(P.readJSON('k')).toEqual({ a: 1 })
  })

  it('键不存在返回 null', () => {
    expect(P.readJSON('不存在')).toBeNull()
  })

  it('内容损坏返回 null 而不是抛错', () => {
    storage.setItem('bad', '{ 不是 JSON')
    expect(P.readJSON('bad')).toBeNull()
  })

  it('写入失败返回 false（超配额时 setItem 会抛）', () => {
    globalThis.__failStorageKey('k')
    expect(P.writeJSON('k', { a: 1 })).toBe(false)
  })

  it('removeKey 删掉键', () => {
    P.writeJSON('k', 1)
    P.removeKey('k')
    expect(storage.getItem('k')).toBeNull()
  })
})

describe('紧凑序列化', () => {
  it('产出可解析的 JSON 字符串', () => {
    const serialized = P.compactForStorage(makeResume('张三'))
    const parsed = JSON.parse(serialized)

    expect(parsed.basics.name).toBe('张三')
  })

  it('无 IndexedDB 时保留 dataURL 头像（降级而非丢数据）', () => {
    // 测试环境刻意没有 indexedDB，avatarStore.isAvailable() 应为 false
    const resume = makeResume('张三')
    resume.basics.avatar = 'data:image/png;base64,AAAA'

    const parsed = JSON.parse(P.compactForStorage(resume))

    expect(parsed.basics.avatar).toBe('data:image/png;base64,AAAA')
  })

  it('不改动传入对象（内部先克隆）', () => {
    const resume = makeResume('张三')
    resume.basics.avatar = 'data:image/png;base64,AAAA'

    P.compactForStorage(resume)

    expect(resume.basics.avatar).toBe('data:image/png;base64,AAAA')
  })
})

describe('saveResume 的配额保护', () => {
  it('正常数据写进主键并返回成功', () => {
    const outcome = P.saveResume(makeResume('张三'))

    expect(outcome).toEqual({ ok: true, warning: '' })
    expect(JSON.parse(storage.getItem(P.STORAGE_KEY)).basics.name).toBe('张三')
  })

  it('超过体积上限时提前放弃，不写半截数据', () => {
    const huge = makeResume('大文件')
    huge.sections[0].content = 'x'.repeat(P.STORAGE_LIMIT + 1000)

    const outcome = P.saveResume(huge)

    expect(outcome.ok).toBe(false)
    expect(outcome.warning).toBe(P.QUOTA_WARNING)
    expect(outcome.warning).toContain('内容体积过大')
    // 关键：宁可不存，也不存一份被截断的简历
    expect(storage.getItem(P.STORAGE_KEY)).toBeNull()
  })

  it('写入抛错时降级成可读警告，不让异常冒到 watch 里', () => {
    globalThis.__failStorageKey(P.STORAGE_KEY)

    const outcome = P.saveResume(makeResume('张三'))

    expect(outcome.ok).toBe(false)
    expect(outcome.warning).toContain('自动保存失败')
  })
})

describe('头像引用回收', () => {
  it('从文本里扫出所有 idb 引用', () => {
    const text = '{"a":"idb-avatar:abc123","b":"idb-avatar:def456","c":"无关"}'
    expect(P.collectAvatarRefs(text)).toEqual(['idb-avatar:abc123', 'idb-avatar:def456'])
  })

  it('没有引用时返回空数组', () => {
    expect(P.collectAvatarRefs('没有引用')).toEqual([])
  })
})

describe('自动保存调度', () => {
  function makeAutosave(overrides = {}) {
    const results = []
    const savedCallbacks = []
    const autosave = P.createAutosave({
      getData: () => makeResume('自动保存'),
      onResult: (outcome) => results.push(outcome),
      onSaved: () => savedCallbacks.push(1),
      ...overrides,
    })
    return { autosave, results, savedCallbacks }
  }

  it('saveNow 立即落盘并回调结果', () => {
    const { autosave, results, savedCallbacks } = makeAutosave()

    autosave.saveNow()

    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(true)
    // 成功后触发快照采样
    expect(savedCallbacks).toHaveLength(1)
    expect(storage.getItem(P.STORAGE_KEY)).toBeTruthy()
  })

  it('失败时不触发 onSaved', () => {
    globalThis.__failStorageKey(P.STORAGE_KEY)
    const { autosave, results, savedCallbacks } = makeAutosave()

    autosave.saveNow()

    expect(results[0].ok).toBe(false)
    expect(savedCallbacks).toHaveLength(0)
  })

  it('scheduleSave 延迟落盘（防抖）', async () => {
    const { autosave, results } = makeAutosave()

    autosave.scheduleSave()
    expect(results).toHaveLength(0)

    await new Promise((resolve) => setTimeout(resolve, P.SAVE_DEBOUNCE_MS + 80))
    expect(results).toHaveLength(1)
  })

  it('bindUnloadFlush 注册 pagehide / visibilitychange 并返回解绑函数', () => {
    const { autosave } = makeAutosave()
    let pagehide = 0
    let visibility = 0
    const origWindowAdd = window.addEventListener
    const origDocAdd = document.addEventListener
    window.addEventListener = (type, handler) => {
      if (type === 'pagehide') pagehide += 1
      return origWindowAdd.call(window, type, handler)
    }
    document.addEventListener = (type, handler) => {
      if (type === 'visibilitychange') visibility += 1
      return origDocAdd.call(document, type, handler)
    }

    try {
      const unbind = autosave.bindUnloadFlush()
      expect(pagehide).toBe(1)
      expect(visibility).toBe(1)
      expect(typeof unbind).toBe('function')
      expect(() => unbind()).not.toThrow()
    } finally {
      window.addEventListener = origWindowAdd
      document.addEventListener = origDocAdd
    }
  })

  /*
   * 头像回收的调度。
   *
   * 这组用例是为了防止「定义了但没人调」的复发：`schedulePrune` 曾经存在、
   * 也被 `Autosave` 返回，但全仓库没有任何调用点 —— 于是 onPrune 与
   * pruneAvatars 整条链路不可达，换头像后旧 blob 永远留着，容量只增不减。
   * 断言写在「调用后 onPrune 真的被触发且拿到了引用」，功能坏了这条会红。
   *
   * 用假定时器而不是真等 6 秒：`debounce` 走的是 window.setTimeout，
   * 而测试环境里 window.setTimeout 是转发到 globalThis.setTimeout 的箭头函数
   * （见 tests/setup/browser-globals.js），所以 vi.useFakeTimers 一样能接管。
   */
  it('schedulePrune 防抖后调用 onPrune，并带上收集到的引用', () => {
    const pruned = []
    const { autosave } = makeAutosave({
      collectAvatarRefs: () => ['idb-avatar:keepme'],
      onPrune: (refs) => pruned.push(refs),
    })

    vi.useFakeTimers()
    try {
      autosave.schedulePrune()
      // 防抖窗口内不应触发
      expect(pruned).toHaveLength(0)

      vi.advanceTimersByTime(P.PRUNE_DEBOUNCE_MS + 50)
      expect(pruned).toHaveLength(1)
      expect(pruned[0]).toEqual(['idb-avatar:keepme'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('未提供 collectAvatarRefs / onPrune 时 schedulePrune 不抛错', () => {
    const { autosave } = makeAutosave()

    vi.useFakeTimers()
    try {
      expect(() => autosave.schedulePrune()).not.toThrow()
      expect(() => vi.advanceTimersByTime(P.PRUNE_DEBOUNCE_MS + 50)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})
