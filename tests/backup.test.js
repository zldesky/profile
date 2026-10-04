import { describe, expect, it } from 'vitest'

import { BACKUP_KIND, buildBackup, inlineAvatarRefs, parseBackup } from '@/utils/backup'

const fakeDoc = (id, name = `简历 ${id}`) => ({
  id,
  name,
  pinned: false,
  updatedAt: 1700000000000,
  data: {
    version: 2,
    template: 'classic',
    basics: { name: name, fields: [], avatar: '' },
    sections: [{ id: 'sec1', type: 'text', title: '自我评价', visible: true, content: '内容' }],
  },
})

describe('buildBackup / parseBackup', () => {
  it('构建后可原样解析回来，activeId 与文档一一对应', () => {
    const docs = [fakeDoc('a'), fakeDoc('b')]
    const snapshots = [{ id: 'snap1', name: 'a', updatedAt: 1, data: { sections: [] } }]
    const payload = buildBackup({ activeId: 'b', docs, snapshots })

    const parsed = parseBackup(JSON.parse(JSON.stringify(payload)))
    expect(parsed.activeId).toBe('b')
    expect(parsed.docs.map((d) => d.id)).toEqual(['a', 'b'])
    expect(parsed.docs[1].data.sections).toHaveLength(1)
    expect(parsed.snapshots).toHaveLength(1)
  })

  it('接受 JSON 字符串形态的文件内容', () => {
    const payload = buildBackup({ activeId: 'a', docs: [fakeDoc('a')], snapshots: [] })
    const parsed = parseBackup(JSON.stringify(payload))
    expect(parsed.docs[0].name).toBe('简历 a')
  })

  it('普通单份简历 JSON 不按整包备份解析', () => {
    const single = fakeDoc('a').data
    expect(() => parseBackup(single)).toThrow(/整包/)
  })

  it('缺 docs 或重复 id 都拒绝', () => {
    expect(() => parseBackup({ kind: BACKUP_KIND, docs: [] })).toThrow(/没有简历/)

    const payload = buildBackup({
      activeId: 'a',
      docs: [fakeDoc('a'), fakeDoc('a')],
      snapshots: [],
    })
    expect(() => parseBackup(payload)).toThrow(/重复/)
  })

  it('简历数据缺 sections 视为损坏并拒绝', () => {
    const bad = fakeDoc('a')
    delete bad.data.sections
    expect(() => parseBackup(buildBackup({ activeId: 'a', docs: [bad], snapshots: [] }))).toThrow(
      /不完整/,
    )
  })

  it('activeId 不在文档列表里时回落到第一份', () => {
    const parsed = parseBackup(
      buildBackup({ activeId: 'ghost', docs: [fakeDoc('a'), fakeDoc('b')], snapshots: [] }),
    )
    expect(parsed.activeId).toBe('a')
  })

  it('损坏的快照条目被过滤，不影响其余内容', () => {
    const snapshots = [
      null,
      { id: 'ok', name: '好快照', updatedAt: 5, data: { sections: [] } },
      { id: 'bad', updatedAt: 6 }, // 缺 data
    ]
    const parsed = parseBackup(buildBackup({ activeId: 'a', docs: [fakeDoc('a')], snapshots }))
    expect(parsed.snapshots).toHaveLength(1)
    expect(parsed.snapshots[0].id).toBe('ok')
  })
})

describe('inlineAvatarRefs', () => {
  const resolver = async (ref) =>
    ref === 'idb-avatar:gone' ? null : `data:image/jpeg;base64,${ref.slice('idb-avatar:'.length)}`

  it('把嵌套结构里的头像引用替换为 dataURL', async () => {
    const input = {
      basics: { avatar: 'idb-avatar:abc' },
      sections: [
        { items: [{ logo: 'idb-avatar:def' }] },
        { content: '纯文本 idb-avatar:abc 不是引用值？' },
      ],
      list: ['plain', 'idb-avatar:abc'],
      count: 3,
    }
    const output = await inlineAvatarRefs(input, resolver)
    expect(output.basics.avatar).toBe('data:image/jpeg;base64,abc')
    expect(output.sections[0].items[0].logo).toBe('data:image/jpeg;base64,def')
    // 字符串只做整体引用判断，不做内容替换
    expect(output.sections[1].content).toBe('纯文本 idb-avatar:abc 不是引用值？')
    expect(output.list[0]).toBe('plain')
    expect(output.list[1]).toBe('data:image/jpeg;base64,abc')
    expect(output.count).toBe(3)
  })

  it('取不到的引用置空字符串，绝不让悬空引用进备份', async () => {
    const output = await inlineAvatarRefs({ basics: { avatar: 'idb-avatar:gone' } }, resolver)
    expect(output.basics.avatar).toBe('')
  })

  it('原始类型与 null 原样返回', async () => {
    expect(await inlineAvatarRefs('plain', resolver)).toBe('plain')
    expect(await inlineAvatarRefs(null, resolver)).toBe(null)
    expect(await inlineAvatarRefs(7, resolver)).toBe(7)
  })
})
