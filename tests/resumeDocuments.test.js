import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { installBrowserGlobals, uninstallBrowserGlobals } from './setup/browser-globals.js'
import { makeResume } from './helpers/resume-fixtures.js'

/**
 * 多文档模块的测试：登记表、槽位读写、名称推导与引用收集。
 *
 * 这里的关键不变式是「槽位与登记表不能各说各话」：登记表里有 id 却没有槽位时，
 * 切换文档必须宁可不动也不能把当前内容切丢（该判断在 store 的 switchDoc 里，
 * 本文件保证 readDocSlot 对损坏槽位老实返回 null）。
 */

let D
let storage

beforeAll(async () => {
  const env = installBrowserGlobals()
  storage = env.storage
  ;({ ...D } = await import('@/stores/resumeDocuments'))
})

afterAll(() => uninstallBrowserGlobals())

beforeEach(() => {
  globalThis.__failStorageKey(null)
  storage.clear()
})

describe('文档名推导', () => {
  it('跟随简历里的姓名', () => {
    expect(D.deriveDocName(makeResume('张三'))).toBe('张三')
  })

  it('姓名为空或只有空白时给默认名', () => {
    expect(D.deriveDocName(makeResume(''))).toBe('未命名简历')
    expect(D.deriveDocName(makeResume('   '))).toBe('未命名简历')
  })

  it('数据缺失也安全', () => {
    expect(D.deriveDocName(null)).toBe('未命名简历')
    expect(D.deriveDocName(undefined)).toBe('未命名简历')
  })
})

describe('登记项构造', () => {
  it('给出默认值', () => {
    const entry = D.makeDocEntry('doc-1')

    expect(entry).toMatchObject({ id: 'doc-1', name: '未命名简历', pinned: false })
    expect(typeof entry.updatedAt).toBe('number')
  })

  it('patch 覆盖默认值', () => {
    const entry = D.makeDocEntry('doc-1', { name: '我的主简历', pinned: true })

    expect(entry.name).toBe('我的主简历')
    expect(entry.pinned).toBe(true)
  })

  it('newDocId 每次不同', () => {
    expect(D.newDocId()).not.toBe(D.newDocId())
  })

  it('docSlotKey 与 docKey 一致', () => {
    expect(D.docSlotKey('abc')).toBe(`resume-studio-doc-abc`)
  })
})

describe('登记表读写', () => {
  it('没有登记表时返回 null（调用方据此走首次使用分支）', () => {
    expect(D.readRegistry()).toBeNull()
  })

  it('读取合法登记表', () => {
    const list = [D.makeDocEntry('a'), D.makeDocEntry('b')]
    D.writeRegistry(list)

    expect(D.readRegistry()).toEqual(list)
  })

  it('空数组按「没有登记表」处理', () => {
    D.writeRegistry([])
    expect(D.readRegistry()).toBeNull()
  })

  it('损坏内容返回 null，不抛错', () => {
    storage.setItem('resume-studio-registry-v1', '{ 坏数据')
    expect(D.readRegistry()).toBeNull()
  })

  it('有条目缺 id 时整份按损坏处理（宁可重建也不带着坏数据跑）', () => {
    storage.setItem(
      'resume-studio-registry-v1',
      JSON.stringify([{ id: 'ok', name: '好' }, { name: '没有 id' }]),
    )
    expect(D.readRegistry()).toBeNull()
  })

  it('写入失败不抛错（登记表极小，写不进只影响列表展示）', () => {
    globalThis.__failStorageKey('resume-studio-registry-v1')
    expect(() => D.writeRegistry([D.makeDocEntry('a')])).not.toThrow()
  })
})

describe('活跃文档 id', () => {
  it('未记录时返回 null', () => {
    expect(D.readActiveDocId()).toBeNull()
  })

  it('写入后读回', () => {
    D.writeActiveDocId('doc-9')
    expect(D.readActiveDocId()).toBe('doc-9')
  })

  it('空字符串按未记录处理', () => {
    D.writeActiveDocId('')
    expect(D.readActiveDocId()).toBeNull()
  })

  it('写入失败不抛错（只影响刷新后定位）', () => {
    globalThis.__failStorageKey('resume-studio-active-v1')
    expect(() => D.writeActiveDocId('doc-1')).not.toThrow()
  })
})

describe('槽位读写', () => {
  it('写进去能读回来', () => {
    const outcome = D.writeDocSlot('doc-1', makeResume('张三'))

    expect(outcome).toEqual({ ok: true, warning: '' })
    expect(D.readDocSlot('doc-1').basics.name).toBe('张三')
  })

  it('槽位不存在返回 null', () => {
    expect(D.readDocSlot('不存在')).toBeNull()
  })

  it('槽位损坏返回 null（切文档时据此不动，避免切丢当前文档）', () => {
    storage.setItem(D.docSlotKey('doc-1'), '{ 坏槽位')
    expect(D.readDocSlot('doc-1')).toBeNull()
  })

  it('写入失败返回可读原因', () => {
    globalThis.__failStorageKey(D.docSlotKey('doc-1'))

    const outcome = D.writeDocSlot('doc-1', makeResume('张三'))

    expect(outcome.ok).toBe(false)
    expect(outcome.warning).toContain('简历副本保存失败')
  })

  it('removeDocSlot 删掉槽位', () => {
    D.writeDocSlot('doc-1', makeResume('张三'))
    D.removeDocSlot('doc-1')
    expect(storage.getItem(D.docSlotKey('doc-1'))).toBeNull()
  })

  it('writeNormalizedSlot 写入归一化后的完整形态', () => {
    // 只给关键字段，缺的部分应被 normalizeResume 补齐
    const ok = D.writeNormalizedSlot('doc-2', { basics: { name: '李四' }, sections: [] })

    expect(ok).toBe(true)
    const slot = D.readDocSlot('doc-2')
    expect(slot.basics.name).toBe('李四')
    expect(slot.version).toBe(2)
    expect(slot.theme).toBeTruthy()
  })
})

describe('存回槽位（parkDoc）', () => {
  it('未固定的文档名跟随简历姓名更新，并刷新更新时间', () => {
    const list = [D.makeDocEntry('doc-1', { name: '旧名字', updatedAt: 1 })]

    const { warning } = D.parkDoc(list, 'doc-1', makeResume('新名字'))

    expect(warning).toBe('')
    expect(list[0].name).toBe('新名字')
    expect(list[0].updatedAt).toBeGreaterThan(1)
    expect(D.readDocSlot('doc-1').basics.name).toBe('新名字')
  })

  it('手工重命名过（pinned）的文档名不被覆盖', () => {
    const list = [D.makeDocEntry('doc-1', { name: '我的主简历', pinned: true })]

    D.parkDoc(list, 'doc-1', makeResume('简历里的名字'))

    expect(list[0].name).toBe('我的主简历')
  })

  it('活跃 id 不在登记表里时安静返回', () => {
    const list = [D.makeDocEntry('doc-1')]

    const { warning } = D.parkDoc(list, 'doc-不存在', makeResume('张三'))

    expect(warning).toBe('')
    expect(storage.getItem(D.docSlotKey('doc-不存在'))).toBeNull()
  })

  it('槽位写失败时把原因带出来，同时仍刷新登记表', () => {
    const list = [D.makeDocEntry('doc-1', { name: '旧' })]
    globalThis.__failStorageKey(D.docSlotKey('doc-1'))

    const { warning } = D.parkDoc(list, 'doc-1', makeResume('新'))

    expect(warning).toContain('简历副本保存失败')
    expect(D.readRegistry()[0].name).toBe('新')
  })
})

describe('引用收集与清理', () => {
  function resumeWithAvatar(ref) {
    const resume = makeResume('张三')
    resume.basics.avatar = ref
    return resume
  }

  it('收集非活跃槽位里的头像引用', () => {
    D.writeDocSlot('doc-active', resumeWithAvatar('idb-avatar:active1'))
    D.writeDocSlot('doc-other', resumeWithAvatar('idb-avatar:other1'))
    const list = [D.makeDocEntry('doc-active'), D.makeDocEntry('doc-other')]

    const refs = D.collectSlotAvatarRefs(list, 'doc-active')

    expect(refs).toContain('idb-avatar:other1')
    // 活跃文档的内容在主键里，不在槽位里，因此不该出现在这里
    expect(refs).not.toContain('idb-avatar:active1')
  })

  it('主键里的引用单独收集', () => {
    storage.setItem('resume-studio-v1', JSON.stringify(resumeWithAvatar('idb-avatar:main1')))

    expect(D.collectActiveAvatarRefs()).toContain('idb-avatar:main1')
  })

  it('主键为空时返回空数组', () => {
    expect(D.collectActiveAvatarRefs()).toEqual([])
  })

  it('clearInactiveSlots 只清非活跃槽位', () => {
    D.writeDocSlot('doc-active', makeResume('甲'))
    D.writeDocSlot('doc-other', makeResume('乙'))
    const list = [D.makeDocEntry('doc-active'), D.makeDocEntry('doc-other')]

    D.clearInactiveSlots(list, 'doc-active')

    // 活跃槽位的内容此刻就在主键里，它的槽位不该被当作孤儿清掉
    expect(storage.getItem(D.docSlotKey('doc-active'))).not.toBeNull()
    expect(storage.getItem(D.docSlotKey('doc-other'))).toBeNull()
  })
})
