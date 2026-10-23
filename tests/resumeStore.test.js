import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { installBrowserGlobals, uninstallBrowserGlobals } from './setup/browser-globals.js'
import { makeResume } from './helpers/resume-fixtures.js'

/**
 * useResumeStore 的单测。
 *
 * 这个 store 有 60+ 个 mutation，且是「本地优先」的落盘中心：多文档槽位、历史快照、
 * 头像引用、超容量降级全在这里，此前没有任何直接测试。下面按「先立不变量、再测行为」
 * 组织，重点覆盖那些出错后很难察觉的边界（删到只剩一份、槽位损坏、写入失败降级）。
 *
 * 浏览器 API 由 tests/setup/browser-globals.js 按需安装；必须在安装之后
 * 动态 import store（Pinia 的 setup 里就会读 localStorage 并注册事件监听）。
 */

let useResumeStore
let storage
let failStorageKey

const STORAGE_KEY = 'resume-studio-v1'
const REGISTRY_KEY = 'resume-studio-registry-v1'
const ACTIVE_DOC_KEY = 'resume-studio-active-v1'
const SNAPSHOTS_KEY = 'resume-studio-snapshots-v1'
const DOC_KEY_PREFIX = 'resume-studio-doc-'

const docKey = (id) => `${DOC_KEY_PREFIX}${id}`

/**
 * 清空所有模块。
 * 注意：默认简历自带 7 个模块，只删 sections[0] 并不能得到「空白起步」，
 * 后续按索引取模块就会取错，因此测试里需要空模块时一律走这个函数。
 */
function clearSections(store) {
  store.sections.splice(0, store.sections.length)
}

function readJSON(key) {
  const raw = storage.getItem(key)
  return raw ? JSON.parse(raw) : null
}

function newStore() {
  setActivePinia(createPinia())
  return useResumeStore()
}

/** 预置「两份文档，A 为当前活跃」的落盘状态，再让 store 载入 */
function seedTwoDocs() {
  storage.setItem(
    REGISTRY_KEY,
    JSON.stringify([
      { id: 'doc-a', name: '甲', pinned: false, updatedAt: 1 },
      { id: 'doc-b', name: '乙', pinned: false, updatedAt: 2 },
    ]),
  )
  storage.setItem(ACTIVE_DOC_KEY, JSON.stringify('doc-a'))
  storage.setItem(STORAGE_KEY, JSON.stringify(makeResume('甲')))
  storage.setItem(docKey('doc-b'), JSON.stringify(makeResume('乙')))
}

beforeAll(async () => {
  const env = installBrowserGlobals()
  storage = env.storage
  failStorageKey = env.failStorageKey
  ;({ useResumeStore } = await import('@/stores/resume'))
})

afterAll(() => {
  uninstallBrowserGlobals()
})

beforeEach(() => {
  storage.clear()
  failStorageKey(null)
})

describe('载入与老用户升级', () => {
  it('空存储时给出默认简历，并补一条登记表（老用户无感升级到多文档）', () => {
    const store = newStore()

    expect(store.docList).toHaveLength(1)
    expect(store.docList[0].id).toBe(store.activeDocId)
    expect(readJSON(REGISTRY_KEY)).toHaveLength(1)
    // 没存过任何内容，不该标记成「已恢复」
    expect(store.restored).toBe(false)
  })

  it('有已保存内容时恢复它并置 restored', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(makeResume('张三')))

    const store = newStore()

    expect(store.restored).toBe(true)
    expect(store.basics.name).toBe('张三')
  })

  it('认出上次正在编辑的文档，而不是错把第一份当活跃', () => {
    seedTwoDocs()

    const store = newStore()

    expect(store.activeDocId).toBe('doc-a')
    expect(store.basics.name).toBe('甲')
    expect(store.docList.map((d) => d.id)).toEqual(['doc-a', 'doc-b'])
  })

  it('活跃 id 在登记表里不存在时回退到第一份，避免指到不存在的文档', () => {
    seedTwoDocs()
    storage.setItem(ACTIVE_DOC_KEY, JSON.stringify('doc-不存在'))

    const store = newStore()

    expect(store.activeDocId).toBe('doc-a')
  })

  it('登记表损坏时按首次使用处理，不抛错', () => {
    storage.setItem(REGISTRY_KEY, '{ 这不是 JSON')
    storage.setItem(STORAGE_KEY, JSON.stringify(makeResume('李四')))

    const store = newStore()

    expect(store.docList).toHaveLength(1)
    expect(store.basics.name).toBe('李四')
  })

  it('主文档内容损坏时不抛错，退回默认简历', () => {
    storage.setItem(STORAGE_KEY, '{{{ 坏数据')

    const store = newStore()

    expect(store.restored).toBe(false)
    expect(store.sections.length).toBeGreaterThan(0)
  })
})

describe('多文档管理', () => {
  it('新建文档后切过去，原文档内容留在自己的槽位里', () => {
    const store = newStore()
    store.setBasics({ name: '原文档' })
    store.save()
    const originalId = store.activeDocId

    const newId = store.createDoc()

    expect(newId).not.toBe(originalId)
    expect(store.activeDocId).toBe(newId)
    expect(store.docList).toHaveLength(2)
    // 新建的是空白文档：姓名与模块都清空
    expect(store.basics.name).toBe('')
    expect(store.sections).toHaveLength(0)
    // 原文档落到自己的槽位，内容完整
    expect(readJSON(docKey(originalId)).basics.name).toBe('原文档')
  })

  it('切换文档会把当前内容存回槽位，并把目标内容载入主键', () => {
    seedTwoDocs()
    const store = newStore()

    store.setBasics({ name: '甲改名' })
    store.switchDoc('doc-b')

    expect(store.activeDocId).toBe('doc-b')
    expect(store.basics.name).toBe('乙')
    // 甲的新内容被 park 回自己的槽位
    expect(readJSON(docKey('doc-a')).basics.name).toBe('甲改名')
    // 主键此时承载的是乙
    expect(readJSON(STORAGE_KEY).basics.name).toBe('乙')
    // 乙已载入主键，槽位应被清掉（避免残留重复副本）
    expect(storage.getItem(docKey('doc-b'))).toBeNull()
  })

  it('切到不存在的文档不改变状态', () => {
    seedTwoDocs()
    const store = newStore()

    store.switchDoc('doc-不存在')

    expect(store.activeDocId).toBe('doc-a')
    expect(store.basics.name).toBe('甲')
  })

  it('目标槽位损坏时宁可不动，避免把当前文档切丢', () => {
    seedTwoDocs()
    storage.setItem(docKey('doc-b'), '{ 坏槽位')
    const store = newStore()

    store.switchDoc('doc-b')

    expect(store.activeDocId).toBe('doc-a')
    expect(store.basics.name).toBe('甲')
  })

  it('至少保留一份：只剩一份时删除失败', () => {
    const store = newStore()

    expect(store.removeDoc(store.activeDocId)).toBe(false)
    expect(store.docList).toHaveLength(1)
  })

  it('删除非活跃文档只清槽位，不动当前编辑内容', () => {
    seedTwoDocs()
    const store = newStore()

    expect(store.removeDoc('doc-b')).toBe(true)
    expect(store.docList.map((d) => d.id)).toEqual(['doc-a'])
    expect(storage.getItem(docKey('doc-b'))).toBeNull()
    expect(store.basics.name).toBe('甲')
  })

  it('删除当前文档时顶上来第一份，被删内容不留残余', () => {
    seedTwoDocs()
    const store = newStore()

    expect(store.removeDoc('doc-a')).toBe(true)

    expect(store.activeDocId).toBe('doc-b')
    expect(store.basics.name).toBe('乙')
    expect(storage.getItem(docKey('doc-a'))).toBeNull()
  })

  it('重命名后固定，不再跟随简历里的姓名', () => {
    const store = newStore()
    store.renameDoc(store.activeDocId, '我的主简历')

    const docs = readJSON(REGISTRY_KEY)
    expect(docs[0].name).toBe('我的主简历')
    expect(docs[0].pinned).toBe(true)

    // 改了简历姓名也不该覆盖手工命名
    store.setBasics({ name: '新名字' })
    store.save()
    expect(readJSON(REGISTRY_KEY)[0].name).toBe('我的主简历')
  })

  it('复制活跃文档得到独立副本，改副本不影响原件', () => {
    const store = newStore()
    store.setBasics({ name: '原型' })
    store.addSection('text')
    store.save()
    const originalId = store.activeDocId

    store.duplicateDoc(originalId)

    expect(store.docList).toHaveLength(2)
    const copyId = store.docList[1].id
    expect(copyId).not.toBe(originalId)
    expect(store.docList[1].name).toContain('副本')
    expect(readJSON(docKey(copyId)).basics.name).toBe('原型')

    // 副本是深拷贝：改副本的槽位数据不该动到原件
    const copyData = readJSON(docKey(copyId))
    copyData.basics.name = '被改过的副本'
    storage.setItem(docKey(copyId), JSON.stringify(copyData))
    expect(readJSON(docKey(originalId))).toBeNull() // 活跃文档尚未 park
    expect(store.basics.name).toBe('原型')
  })
})

describe('历史快照', () => {
  it('会话开始就强制采一份快照，保证至少有可回退时点', () => {
    seedTwoDocs()
    const store = newStore()

    expect(store.snapshots.length).toBeGreaterThanOrEqual(1)
    expect(readJSON(SNAPSHOTS_KEY).length).toBe(store.snapshots.length)
    expect(store.snapshots[0].name).toBe('甲')
  })

  it('回退快照会先给当前状态留一份，反悔还能回来', () => {
    const store = newStore()
    // 会话起点那份快照是默认示例（姓名「张伟」），不是我们改的内容；
    // 且采样有 5 分钟节流（SNAPSHOT_INTERVAL），save() 不会立刻再采一份。
    // 因此这里手工造两份快照来测「回退」本身的行为。
    const v1 = makeResume('第一版')
    const v2 = makeResume('第二版')
    store.snapshots.splice(0, store.snapshots.length, {
      id: 'snap-v1',
      name: '第一版',
      updatedAt: Date.now() - 1000,
      data: JSON.stringify(v1),
    })
    store.setBasics({ name: '第二版' })

    expect(store.restoreSnapshot('snap-v1')).toBe(true)

    // 回到第一版
    expect(store.basics.name).toBe('第一版')
    // 回退前把「第二版」补采了一份并排在最后，随时能反悔
    const names = store.snapshots.map((s) => JSON.parse(s.data).basics.name)
    expect(names).toContain('第二版')
    expect(names[names.length - 1]).toBe('第二版')
    expect(v2.basics.name).toBe('第二版')
  })

  it('采样受 5 分钟节流约束：间隔内的保存不会新增快照', () => {
    const store = newStore()
    const countAfterStart = store.snapshots.length
    const lastUpdatedAt = store.snapshots[store.snapshots.length - 1].updatedAt

    store.setBasics({ name: '刚改完就保存' })
    store.save()

    // 距上一份不足 SNAPSHOT_INTERVAL，不该新增
    expect(store.snapshots.length).toBe(countAfterStart)
    expect(store.snapshots[store.snapshots.length - 1].updatedAt).toBe(lastUpdatedAt)
  })

  it('不存在的快照 id 返回 false，且不改动当前内容', () => {
    const store = newStore()
    store.setBasics({ name: '保持不动' })

    expect(store.restoreSnapshot('snap-不存在')).toBe(false)
    expect(store.basics.name).toBe('保持不动')
  })

  it('快照 data 损坏时返回 false，不让坏数据冲掉当前简历', () => {
    const store = newStore()
    store.setBasics({ name: '当前内容' })
    const badId = store.snapshots[0].id
    store.snapshots[0].data = '{ 坏快照数据'

    expect(store.restoreSnapshot(badId)).toBe(false)
    expect(store.basics.name).toBe('当前内容')
  })

  it('快照数量不超过上限（LRU 丢弃最旧的）', () => {
    const store = newStore()
    // 直接塞满超过上限的历史快照，再强制采样一次
    const filled = Array.from({ length: 12 }, (_, i) => ({
      id: `snap-old-${i}`,
      name: '旧快照',
      updatedAt: i,
      data: JSON.stringify(makeResume(`旧-${i}`)),
    }))
    store.snapshots.splice(0, store.snapshots.length, ...filled)
    storage.setItem(SNAPSHOTS_KEY, JSON.stringify(filled))

    store.setBasics({ name: '触发新采样' })
    store.save()

    expect(store.snapshots.length).toBeLessThanOrEqual(12)
    // 最旧的几条被挤出去了
    expect(store.snapshots.some((s) => s.id === 'snap-old-0')).toBe(false)
  })
})

describe('超容量与写入失败的降级', () => {
  /*
   * 头像孤儿回收必须在保存成功后真的被排上。
   *
   * 这一条是针对一个真实回归：`autosave.schedulePrune` 定义了、也由
   * `createAutosave` 返回了，但 store 里**没有任何调用点** —— 整条
   * onPrune → pruneAvatars 链路不可达，换头像后旧的 IndexedDB blob 永远留着。
   * 只测 createAutosave 自己不够（那样把 store 里的调用删掉仍然全绿），
   * 所以这里从 store 的 save() 出发，观察 pruneAvatars 是否真被触达。
   *
   * 判据用「IndexedDB 不可用时 pruneAvatars 直接 return」这一层：
   * 测试环境刻意没装 indexedDB（见 tests/setup/browser-globals.js），
   * 所以这里改为断言 store 在保存后确实进入了回收路径 —— 通过给
   * avatarStore.pruneAvatars 打桩来观察调用，而不是靠副作用猜。
   */
  it('保存成功后会把头像回收排进队列（schedulePrune 有调用点）', async () => {
    const avatarStore = await import('@/utils/avatarStore')
    const calls = []
    // ESM 的模块命名空间是只读的，只能用 spy 包装，不能直接赋值替换
    const spy = vi.spyOn(avatarStore, 'pruneAvatars').mockImplementation((refs) => {
      calls.push(refs)
    })

    vi.useFakeTimers()
    try {
      const store = newStore()
      store.setBasics({ name: '触发一次保存' })
      store.save()

      // 回收是防抖的：窗口内不该已经执行
      expect(calls).toHaveLength(0)

      // 跨过 PRUNE_DEBOUNCE_MS（6000），回收应被触发一次
      vi.advanceTimersByTime(6000 + 50)
      expect(calls.length).toBeGreaterThanOrEqual(1)
      // 传进去的必须是「要保留的引用」数组
      expect(Array.isArray(calls[0])).toBe(true)
    } finally {
      vi.useRealTimers()
      spy.mockRestore()
    }
  })

  it('主文档写入失败时给出可读警告，不抛错', () => {
    const store = newStore()
    failStorageKey(STORAGE_KEY)

    store.setBasics({ name: '写不进去' })
    expect(() => store.save()).not.toThrow()
    expect(store.storageWarning).toContain('自动保存失败')
  })

  it('体积超过上限时提示压缩头像，而不是静默丢弃', () => {
    const store = newStore()
    // 灌入超大正文，越过 4.5MB 上限
    store.updateSection(store.sections[0].id, { content: 'x'.repeat(4.6 * 1024 * 1024) })

    store.save()

    expect(store.storageWarning).toContain('内容体积过大')
    // 超限时不该把半截内容写进主键
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('切换文档时槽位与主键都写不进，警告会保留下来', () => {
    seedTwoDocs()
    const store = newStore()
    store.setBasics({ name: '甲改名' })

    // 两个键同时失败时：parkCurrentDoc 写警告 → 随后的 save() 也失败，
    // 于是 save() 里「写成功就清空警告」那一步不会执行，警告得以保留。
    // 这也说明 park 的失败会被 save 的成败覆盖，只在两个都失败时才对用户可见。
    failStorageKey(null)
    const failing = new Set([docKey('doc-a'), STORAGE_KEY])
    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = (key, value) => {
      if (failing.has(String(key))) {
        const error = new Error('模拟写入失败')
        error.name = 'QuotaExceededError'
        throw error
      }
      originalSetItem(key, value)
    }

    try {
      store.switchDoc('doc-b')
      // 主键也写不进，save() 的失败警告覆盖了 park 的警告，两者都指向写入失败
      expect(store.storageWarning).toContain('自动保存失败')
      expect(store.activeDocId).toBe('doc-b')
    } finally {
      delete storage.setItem
    }
  })

  it('只有槽位写失败时，后续保存成功会把警告清掉（现状行为，勿误判为丢数据）', () => {
    seedTwoDocs()
    const store = newStore()
    store.setBasics({ name: '甲改名' })

    failStorageKey(docKey('doc-a'))
    store.switchDoc('doc-b')

    // switchDoc 内部 park 失败 → 写警告；紧接着 save() 成功 → 清空警告。
    // 内容已切到乙且主键可写，所以这里警告为空是符合预期的。
    expect(store.activeDocId).toBe('doc-b')
    expect(store.storageWarning).toBe('')
  })
})

describe('主题与基本信息', () => {
  it('setTheme 只覆盖传入字段，其余保持', () => {
    const store = newStore()
    const before = { ...store.theme }

    store.setTheme({ accent: '#123456' })

    expect(store.theme.accent).toBe('#123456')
    expect(store.theme.fs).toBe(before.fs)
    expect(store.theme.customLayout).toEqual(before.customLayout)
  })

  it('resetTheme 恢复默认主题', () => {
    const store = newStore()
    store.setTheme({ accent: '#123456', fs: 20 })

    store.resetTheme()

    expect(store.theme.accent).not.toBe('#123456')
    expect(store.theme.accent).toBe('#000000')
  })

  it('头像偏移超出已测边界时被裁剪到边界值', () => {
    const store = newStore()
    store.setAvatarLimits({ minDx: -10, maxDx: 10, minDy: -5, maxDy: 5 })

    store.setAvatarPos({ dx: 999, dy: -999 })

    expect(store.basics.avatarPos).toEqual({ dx: 10, dy: -5 })
  })

  it('头像偏移值未变化时不写回（避免与预览区测量互相触发）', () => {
    const store = newStore()
    store.setAvatarLimits({ minDx: -10, maxDx: 10, minDy: -5, maxDy: 5 })
    store.setAvatarPos({ dx: 4, dy: 2 })
    const applied = store.basics.avatarPos

    store.setAvatarPos({ dx: 4, dy: 2 })

    // 未变化时保持同一个对象引用，说明没有触发新的写入
    expect(store.basics.avatarPos).toBe(applied)
  })

  it('基本信息字段可增删改与排序', () => {
    const store = newStore()
    store.setBasics({ fields: [] })

    store.addBasicsField()
    store.addBasicsField()
    expect(store.basics.fields).toHaveLength(2)

    const [first, second] = store.basics.fields
    store.updateBasicsField(first.id, { label: '联系电话', value: '13800000000' })
    expect(store.basics.fields[0].label).toBe('联系电话')

    store.moveBasicsField(0, 1)
    expect(store.basics.fields[0].id).toBe(second.id)
    expect(store.basics.fields[1].id).toBe(first.id)

    store.removeBasicsField(first.id)
    expect(store.basics.fields).toHaveLength(1)
    expect(store.basics.fields[0].id).toBe(second.id)
  })
})

describe('模块的增删改移', () => {
  it('新增模块返回其 id，并按预设建出对应类型', () => {
    const store = newStore()
    clearSections(store)

    const id = store.addSection('entries')
    const section = store.sections.find((s) => s.id === id)

    expect(section.type).toBe('entries')
    expect(section.title).toBe('新模块')
    expect(Array.isArray(section.items)).toBe(true)
  })

  it('按预设新增模块带出预置条目', () => {
    const store = newStore()
    clearSections(store)

    const id = store.addSectionFromPreset('education')

    const section = store.sections.find((s) => s.id === id)
    expect(section).toBeTruthy()
    expect(section.type).toBe('entries')
    expect(section.items.length).toBeGreaterThan(0)
  })

  it('复制模块插在原模块之后，且所有子项 id 都重新生成', () => {
    const store = newStore()
    clearSections(store)
    const id = store.addSection('entries')
    store.addEntry(id)
    // 取末尾那条（模块自带一个示例条目，索引 0 不是新增的）
    const entryId = store.sections[0].items.at(-1).id
    store.addBullet(id, entryId)
    store.addEntryMeta(id, entryId)

    store.duplicateSection(id)

    expect(store.sections).toHaveLength(2)
    const [original, copy] = store.sections

    expect(copy.id).not.toBe(original.id)
    expect(copy.title).toBe(`${original.title} 副本`)

    // 子项 id 必须全部换新，否则改副本会改到原件。
    // 用末尾那条：模块自带示例条目，只有末尾这条被加了要点与补充信息
    const originalEntry = original.items.at(-1)
    const copyEntry = copy.items.at(-1)
    expect(copyEntry.id).not.toBe(originalEntry.id)
    expect(copyEntry.bullets.at(-1).id).not.toBe(originalEntry.bullets.at(-1).id)
    expect(copyEntry.meta.at(-1).id).not.toBe(originalEntry.meta.at(-1).id)

    // 内容本身要一致
    expect(copyEntry.bullets.at(-1).text).toBe(originalEntry.bullets.at(-1).text)
  })

  it('复制模块后改副本的要点不影响原件', () => {
    const store = newStore()
    clearSections(store)
    const id = store.addSection('entries')
    store.addEntry(id)
    const entryId = store.sections[0].items.at(-1).id
    store.addBullet(id, entryId)
    const bulletId = store.sections[0].items.at(-1).bullets.at(-1).id
    store.updateBullet(id, entryId, bulletId, '原件要点')

    store.duplicateSection(id)

    const copySection = store.sections[1]
    const copyEntry = copySection.items.at(-1)
    store.updateBullet(copySection.id, copyEntry.id, copyEntry.bullets.at(-1).id, '副本要点')

    expect(store.sections[0].items.at(-1).bullets.at(-1).text).toBe('原件要点')
    expect(store.sections[1].items.at(-1).bullets.at(-1).text).toBe('副本要点')
  })

  it('updateSectionLayout 只覆盖传入项，其余取默认值', () => {
    const store = newStore()
    const id = store.sections[0].id

    store.updateSectionLayout(id, { indent: 8 })

    const { layout } = store.sections[0]
    expect(layout.indent).toBe(8)
    expect(layout.align).toBeTruthy()
    expect(layout.columns).toBeTruthy()
  })

  it('reorderSectionsByIds 按给定顺序重排', () => {
    const store = newStore()
    clearSections(store)
    store.addSection('text')
    store.addSection('grid')
    store.addSection('skills')
    const [a, b, c] = store.sections.map((s) => s.id)
    expect([a, b, c].every(Boolean)).toBe(true)

    store.reorderSectionsByIds([c, a, b])

    expect(store.sections.map((s) => s.id)).toEqual([c, a, b])
  })

  it('reorderSectionsByIds 收到残缺或含未知 id 的顺序时忽略，避免拖出残缺数组', () => {
    const store = newStore()
    clearSections(store)
    store.addSection('text')
    store.addSection('grid')
    store.addSection('skills')
    const before = store.sections.map((s) => s.id)
    const [a, b] = before

    store.reorderSectionsByIds([a, b]) // 长度不足
    expect(store.sections.map((s) => s.id)).toEqual(before)

    store.reorderSectionsByIds([a, b, 'sec-未知']) // 含未知 id
    expect(store.sections.map((s) => s.id)).toEqual(before)

    store.reorderSectionsByIds(null) // 非数组
    expect(store.sections.map((s) => s.id)).toEqual(before)
  })

  it('键值网格条目可增删改', () => {
    const store = newStore()
    clearSections(store)
    const id = store.addSection('grid')
    // 新建的 grid 模块自带一个示例条目
    const seeded = store.sections[0].items.length
    expect(seeded).toBeGreaterThanOrEqual(1)

    store.addGridItem(id)
    expect(store.sections[0].items).toHaveLength(seeded + 1)

    // 取 id 而不是索引：模块自带示例条目，索引 0 不是新增的那条
    const itemId = store.sections[0].items.at(-1).id
    store.updateGridItem(id, itemId, { label: '期望薪资', value: '25K' })
    const updated = store.sections[0].items.find((i) => i.id === itemId)
    expect(updated.label).toBe('期望薪资')
    expect(updated.value).toBe('25K')

    store.removeGridItem(id, itemId)
    expect(store.sections[0].items).toHaveLength(seeded)
    expect(store.sections[0].items.find((i) => i.id === itemId)).toBeUndefined()
  })

  it('条目、要点与补充信息可增删改移', () => {
    const store = newStore()
    clearSections(store)
    const id = store.addSection('entries')
    const section = () => store.sections[0]

    store.addEntry(id)
    store.addEntry(id)
    // 新建的 entries 模块自带一个示例条目，所以是 自带 + 2
    expect(section().items.length).toBeGreaterThanOrEqual(3)

    const first = section().items.at(-2)
    const second = section().items.at(-1)

    store.updateEntry(id, first.id, { org: '某公司', role: '前端' })
    expect(section().items.find((e) => e.id === first.id).org).toBe('某公司')

    // 把 first 从队首移到队尾：位置应改变，且两条都还在
    const indexBefore = section().items.findIndex((e) => e.id === first.id)
    const countBefore = section().items.length
    store.moveEntry(id, indexBefore, section().items.length - 1)
    expect(section().items.at(-1).id).toBe(first.id)
    expect(section().items).toHaveLength(countBefore)

    store.addBullet(id, second.id)
    const bulletId = section()
      .items.find((e) => e.id === second.id)
      .bullets.at(-1).id
    store.updateBullet(id, second.id, bulletId, '做了某事，指标提升 30%')
    expect(
      section()
        .items.find((e) => e.id === second.id)
        .bullets.find((b) => b.id === bulletId).text,
    ).toContain('30%')
    const bulletsBefore = section().items.find((e) => e.id === second.id).bullets.length
    store.removeBullet(id, second.id, bulletId)
    expect(section().items.find((e) => e.id === second.id).bullets).toHaveLength(bulletsBefore - 1)

    store.addEntryMeta(id, second.id)
    const metaId = section()
      .items.find((e) => e.id === second.id)
      .meta.at(-1).id
    store.updateEntryMeta(id, second.id, metaId, { label: 'GPA', value: '3.7/4.0' })
    expect(
      section()
        .items.find((e) => e.id === second.id)
        .meta.find((m) => m.id === metaId).value,
    ).toBe('3.7/4.0')
    const metaBefore = section().items.find((e) => e.id === second.id).meta.length
    store.removeEntryMeta(id, second.id, metaId)
    expect(section().items.find((e) => e.id === second.id).meta).toHaveLength(metaBefore - 1)

    const itemsBefore = section().items.length
    store.removeEntry(id, second.id)
    expect(section().items).toHaveLength(itemsBefore - 1)
    expect(section().items.find((e) => e.id === second.id)).toBeUndefined()
  })

  it('技能模块的描述与技能项可增删改', () => {
    const store = newStore()
    clearSections(store)
    const id = store.addSection('skills')
    const section = () => store.sections[0]
    // 新建的 skills 模块自带一条技能与一条描述
    expect(section().items.length).toBeGreaterThanOrEqual(1)

    store.addSkillField(id)
    const fieldId = section().fields.at(-1).id
    store.updateSkillField(id, fieldId, { value: '熟练使用 Vue 3' })
    expect(section().fields.find((f) => f.id === fieldId).value).toBe('熟练使用 Vue 3')
    const fieldsBefore = section().fields.length
    store.removeSkillField(id, fieldId)
    expect(section().fields).toHaveLength(fieldsBefore - 1)
    expect(section().fields.find((f) => f.id === fieldId)).toBeUndefined()

    store.addSkill(id)
    const skillId = section().items.at(-1).id
    store.updateSkill(id, skillId, { name: 'TypeScript', level: 90 })
    expect(section().items.find((i) => i.id === skillId).name).toBe('TypeScript')
    expect(section().items.find((i) => i.id === skillId).level).toBe(90)
    const skillsBefore = section().items.length
    store.removeSkill(id, skillId)
    expect(section().items).toHaveLength(skillsBefore - 1)
  })

  it('对不存在的模块 id 操作是安全的空操作', () => {
    const store = newStore()
    const sectionsBefore = store.sections.length

    expect(() => {
      store.addGridItem('sec-不存在')
      store.addEntry('sec-不存在')
      store.addBullet('sec-不存在', 'entry-不存在')
      store.updateGridItem('sec-不存在', 'i-不存在', { label: 'x' })
      store.removeGridItem('sec-不存在', 'i-不存在')
      store.removeEntry('sec-不存在', 'entry-不存在')
      store.updateSection('sec-不存在', { title: 'x' })
      store.updateSectionLayout('sec-不存在', { indent: 1 })
      store.moveEntry('sec-不存在', 0, 1)
      store.duplicateSection('sec-不存在')
    }).not.toThrow()

    expect(store.sections).toHaveLength(sectionsBefore)
  })

  it('删除模块后再操作它的 id 不会复活模块', () => {
    const store = newStore()
    const id = store.sections[0].id
    store.removeSection(id)

    store.addGridItem(id)
    store.updateSection(id, { title: '幽灵' })

    expect(store.sections.find((s) => s.id === id)).toBeUndefined()
  })
})

describe('撤销 / 重做', () => {
  it('提交点之后可以撤销回上一步', async () => {
    const store = newStore()
    store.setBasics({ name: '第一步' })
    // 历史按停顿成组提交（debounce 600ms），等它落一笔
    await new Promise((resolve) => setTimeout(resolve, 700))

    store.setBasics({ name: '第二步' })
    store.undo()

    expect(store.basics.name).toBe('第一步')
  })

  it('撤销后可以重做回来', async () => {
    const store = newStore()
    store.setBasics({ name: '第一步' })
    await new Promise((resolve) => setTimeout(resolve, 700))

    store.setBasics({ name: '第二步' })
    store.undo()
    store.redo()

    expect(store.basics.name).toBe('第二步')
  })

  it('刚载入时撤销按钮是灭的（历史基线以载入结果为准）', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(makeResume('已有内容')))

    const store = newStore()

    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })

  it('resetAll 清空历史，撤销不会一路回到重置前', () => {
    const store = newStore()
    store.setBasics({ name: '重置前' })

    store.resetAll()

    expect(store.canUndo).toBe(false)
    expect(store.basics.name).not.toBe('重置前')
  })

  it('replaceResume 之后历史基线重立，不再能撤销到替换前', () => {
    const store = newStore()
    store.setBasics({ name: '替换前' })

    store.replaceResume(makeResume('替换后'))

    expect(store.canUndo).toBe(false)
    expect(store.basics.name).toBe('替换后')
  })
})

describe('整包备份', () => {
  it('汇出全部简历与历史版本', async () => {
    seedTwoDocs()
    const store = newStore()

    const backup = await store.exportAllData()

    expect(backup.docs).toHaveLength(2)
    expect(backup.activeId).toBe('doc-a')
    expect(Array.isArray(backup.snapshots)).toBe(true)
    expect(backup.snapshots.length).toBeGreaterThanOrEqual(1)
  })

  it('整包恢复会覆盖本机数据，并返回恢复份数', async () => {
    seedTwoDocs()
    const store = newStore()
    const backup = await store.exportAllData()

    // 改成本机另一副样子
    store.resetAll()
    store.setBasics({ name: '本机新内容' })

    const count = store.importAllData(backup)

    expect(count).toBe(2)
    expect(store.docList).toHaveLength(2)
    expect(store.activeDocId).toBe('doc-a')
    expect(store.basics.name).toBe('甲')
  })

  it('备份内容不合法时抛错，且一个字节都不动本机数据', () => {
    seedTwoDocs()
    const store = newStore()
    const before = storage.getItem(STORAGE_KEY)

    expect(() => store.importAllData('{ 不是备份')).toThrow()
    expect(storage.getItem(STORAGE_KEY)).toBe(before)
    expect(store.docList.map((d) => d.id)).toEqual(['doc-a', 'doc-b'])
  })

  it('没有可备份的简历时抛错', async () => {
    const store = newStore()
    // 清掉登记表与内容，模拟「所有槽位都损坏」
    storage.setItem(REGISTRY_KEY, JSON.stringify([{ id: 'main', name: 'x' }]))
    store.docList.splice(0, store.docList.length)

    await expect(store.exportAllData()).rejects.toThrow('没有可备份的简历')
  })
})

describe('序列化输出', () => {
  it('toJSON 产出可被再次解析的格式化 JSON', () => {
    const store = newStore()
    store.setBasics({ name: '导出我' })

    const parsed = JSON.parse(store.toJSON())

    expect(parsed.basics.name).toBe('导出我')
    expect(parsed.version).toBe(2)
  })

  it('导出再导入后关键字段一致（往返不丢数据）', () => {
    const store = newStore()
    store.setBasics({ name: '往返测试', jobTitle: '后端工程师' })
    clearSections(store)
    const id = store.addSection('grid')
    store.addGridItem(id)
    // 新建的 grid 模块自带一条示例条目，加上新增的共 2 条
    const itemsBefore = store.sections[0].items.length
    expect(itemsBefore).toBeGreaterThanOrEqual(2)
    const exported = store.toJSON()

    store.replaceResume(JSON.parse(exported))

    expect(store.basics.name).toBe('往返测试')
    expect(store.basics.jobTitle).toBe('后端工程师')
    expect(store.sections).toHaveLength(1)
    expect(store.sections[0].items).toHaveLength(itemsBefore)
  })
})
