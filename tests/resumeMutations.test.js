import { describe, expect, it } from 'vitest'

import * as tree from '@/stores/resumeMutations'
import { makeResume } from './helpers/resume-fixtures.js'

/**
 * 模块树操作的纯函数测试。
 *
 * 这些函数拆出来的意义就在这：只读写传入的 resume，不碰 localStorage、不认识 store，
 * 因此无需任何浏览器环境或 Pinia 就能直测。拆解前它们埋在 store 里，
 * 只能通过 store 间接验证（而那需要一整套 localStorage 桩）。
 */

/** 建一份只含指定类型模块的简历，避免默认示例模块干扰索引 */
function resumeWith(...types) {
  const resume = makeResume()
  resume.sections = []
  for (const type of types) tree.addSection(resume, type)
  return resume
}

describe('findSection / findById', () => {
  it('按 id 定位模块', () => {
    const resume = resumeWith('text', 'grid')
    const [a, b] = resume.sections

    expect(tree.findSection(resume, a.id)).toBe(resume.sections[0])
    expect(tree.findSection(resume, b.id)).toBe(resume.sections[1])
    expect(tree.findSection(resume, '不存在')).toBeUndefined()
  })

  it('给了类型就要求类型也匹配', () => {
    const resume = resumeWith('text', 'grid')
    const [text, grid] = resume.sections

    expect(tree.findSection(resume, grid.id, 'grid')).toBe(grid)
    // id 对但类型不对：返回 undefined，让「哪种模块才有 items」在签名里成立
    expect(tree.findSection(resume, text.id, 'grid')).toBeUndefined()
  })

  it('findById 对 undefined 列表安全', () => {
    expect(tree.findById(undefined, 'x')).toBeUndefined()
    expect(tree.findById([], 'x')).toBeUndefined()
    expect(tree.findById([{ id: 'x' }], 'x')).toEqual({ id: 'x' })
  })
})

describe('模块增删改移', () => {
  it('新增模块返回 id，且新建自带示例条目', () => {
    const resume = resumeWith()
    const id = tree.addSection(resume, 'entries')

    expect(resume.sections).toHaveLength(1)
    expect(resume.sections[0].id).toBe(id)
    // createSection 自带示例内容，这一点容易误判成 bug
    expect(resume.sections[0].items.length).toBeGreaterThanOrEqual(1)
  })

  it('按预设新增模块带出预置条目', () => {
    const resume = resumeWith()
    tree.addSectionFromPreset(resume, 'education')

    expect(resume.sections).toHaveLength(1)
    expect(resume.sections[0].items.length).toBeGreaterThan(0)
  })

  it('removeSection 删掉指定模块，找不到时安静返回', () => {
    const resume = resumeWith('text', 'grid')
    const [a, b] = resume.sections

    tree.removeSection(resume, a.id)
    expect(resume.sections).toEqual([b])

    expect(() => tree.removeSection(resume, '不存在')).not.toThrow()
    expect(resume.sections).toHaveLength(1)
  })

  it('复制模块插在原模块之后，标题加「副本」', () => {
    const resume = resumeWith('text', 'grid')
    const [first, second] = resume.sections

    tree.duplicateSection(resume, first.id)

    expect(resume.sections).toHaveLength(3)
    expect(resume.sections[1].title).toBe(`${first.title} 副本`)
    expect(resume.sections[2]).toBe(second)
  })

  it('复制模块会重生成所有子项 id，改副本不影响原件', () => {
    const resume = resumeWith('entries')
    const id = resume.sections[0].id
    tree.addEntry(resume, id)
    const entryId = resume.sections[0].items.at(-1).id
    tree.addBullet(resume, id, entryId)
    tree.addEntryMeta(resume, id, entryId)

    tree.duplicateSection(resume, id)

    const original = resume.sections[0]
    const copy = resume.sections[1]
    const originalEntry = original.items.at(-1)
    const copyEntry = copy.items.at(-1)

    expect(copy.id).not.toBe(original.id)
    expect(copyEntry.id).not.toBe(originalEntry.id)
    expect(copyEntry.bullets.at(-1).id).not.toBe(originalEntry.bullets.at(-1).id)
    expect(copyEntry.meta.at(-1).id).not.toBe(originalEntry.meta.at(-1).id)

    // 内容一致但彼此独立
    copyEntry.bullets.at(-1).text = '改副本'
    expect(originalEntry.bullets.at(-1).text).not.toBe('改副本')
  })

  it('updateSection 只覆盖传入字段', () => {
    const resume = resumeWith('text')
    const id = resume.sections[0].id
    const before = { ...resume.sections[0] }

    tree.updateSection(resume, id, { title: '新标题' })

    expect(resume.sections[0].title).toBe('新标题')
    expect(resume.sections[0].type).toBe(before.type)
    expect(resume.sections[0].visible).toBe(before.visible)
  })

  it('updateSectionLayout 缺省字段取默认值', () => {
    const resume = resumeWith('text')
    const id = resume.sections[0].id

    tree.updateSectionLayout(resume, id, { indent: 8 })

    expect(resume.sections[0].layout.indent).toBe(8)
    expect(resume.sections[0].layout.columns).toBeTruthy()
  })

  it('updateSectionLayout 四个方向的间距各自独立', () => {
    const resume = resumeWith('text')
    const id = resume.sections[0].id

    tree.updateSectionLayout(resume, id, { indentRight: 12, extraGapBottom: -6 })

    const { layout } = resume.sections[0]
    expect(layout.indentRight).toBe(12)
    expect(layout.extraGapBottom).toBe(-6)
    // 未传的另外两个方向不受影响
    expect(layout.indent).toBe(0)
    expect(layout.extraGap).toBe(0)
  })

  it('moveSection 调整顺序', () => {
    const resume = resumeWith('text', 'grid', 'skills')
    const [a, b, c] = resume.sections.map((s) => s.id)

    tree.moveSection(resume, 0, 2)

    expect(resume.sections.map((s) => s.id)).toEqual([b, c, a])
  })

  it('reorderSectionsByIds 只在传入完整排列时生效', () => {
    const resume = resumeWith('text', 'grid', 'skills')
    const [a, b, c] = resume.sections.map((s) => s.id)

    tree.reorderSectionsByIds(resume, [c, a, b])
    expect(resume.sections.map((s) => s.id)).toEqual([c, a, b])

    // 长度不符 / 含未知 id / 非数组：一律忽略，避免拖出残缺数组
    tree.reorderSectionsByIds(resume, [c, a])
    expect(resume.sections.map((s) => s.id)).toEqual([c, a, b])

    tree.reorderSectionsByIds(resume, [c, a, '未知'])
    expect(resume.sections.map((s) => s.id)).toEqual([c, a, b])

    tree.reorderSectionsByIds(resume, null)
    expect(resume.sections.map((s) => s.id)).toEqual([c, a, b])
  })
})

describe('对错误类型的模块操作是安全的空操作', () => {
  it('往 text 模块里加条目不会改变它', () => {
    const resume = resumeWith('text')
    const id = resume.sections[0].id
    const snapshot = JSON.stringify(resume.sections[0])

    tree.addEntry(resume, id)
    tree.addGridItem(resume, id)
    tree.addSkill(resume, id)
    tree.addBullet(resume, id, '不存在')

    expect(JSON.stringify(resume.sections[0])).toBe(snapshot)
  })

  it('对不存在的模块 id 操作不抛错', () => {
    const resume = resumeWith('entries')
    const before = JSON.stringify(resume)

    expect(() => {
      tree.addEntry(resume, 'sec-无')
      tree.addGridItem(resume, 'sec-无')
      tree.updateSection(resume, 'sec-无', { title: 'x' })
      tree.removeSection(resume, 'sec-无')
      tree.duplicateSection(resume, 'sec-无')
      tree.moveEntry(resume, 'sec-无', 0, 1)
      tree.updateEntry(resume, 'sec-无', 'e-无', { org: 'x' })
      tree.removeEntry(resume, 'sec-无', 'e-无')
      tree.addSkillField(resume, 'sec-无')
    }).not.toThrow()

    expect(JSON.stringify(resume)).toBe(before)
  })
})

describe('各类型模块的条目操作', () => {
  it('grid：条目可增删改', () => {
    const resume = resumeWith('grid')
    const id = resume.sections[0].id
    const seeded = resume.sections[0].items.length

    tree.addGridItem(resume, id)
    expect(resume.sections[0].items).toHaveLength(seeded + 1)

    const itemId = resume.sections[0].items.at(-1).id
    tree.updateGridItem(resume, id, itemId, { label: '期望薪资', value: '25K' })
    expect(tree.findById(resume.sections[0].items, itemId)).toMatchObject({
      label: '期望薪资',
      value: '25K',
    })

    tree.removeGridItem(resume, id, itemId)
    expect(resume.sections[0].items).toHaveLength(seeded)
  })

  it('entries：条目、要点、补充信息都可增删改移', () => {
    const resume = resumeWith('entries')
    const id = resume.sections[0].id

    tree.addEntry(resume, id)
    tree.addEntry(resume, id)
    const first = resume.sections[0].items.at(-2)
    const second = resume.sections[0].items.at(-1)

    tree.updateEntry(resume, id, first.id, { org: '某公司' })
    expect(tree.findById(resume.sections[0].items, first.id).org).toBe('某公司')

    const indexBefore = resume.sections[0].items.findIndex((e) => e.id === first.id)
    tree.moveEntry(resume, id, indexBefore, resume.sections[0].items.length - 1)
    expect(resume.sections[0].items.at(-1).id).toBe(first.id)

    tree.addBullet(resume, id, second.id)
    const bulletId = tree.findById(resume.sections[0].items, second.id).bullets.at(-1).id
    tree.updateBullet(resume, id, second.id, bulletId, '指标提升 30%')
    expect(tree.findById(resume.sections[0].items, second.id).bullets.at(-1).text).toContain('30%')
    const bulletCount = tree.findById(resume.sections[0].items, second.id).bullets.length
    tree.removeBullet(resume, id, second.id, bulletId)
    expect(tree.findById(resume.sections[0].items, second.id).bullets).toHaveLength(bulletCount - 1)

    tree.addEntryMeta(resume, id, second.id)
    const metaId = tree.findById(resume.sections[0].items, second.id).meta.at(-1).id
    tree.updateEntryMeta(resume, id, second.id, metaId, { label: 'GPA', value: '3.7' })
    expect(tree.findById(resume.sections[0].items, second.id).meta.at(-1).value).toBe('3.7')
    const metaCount = tree.findById(resume.sections[0].items, second.id).meta.length
    tree.removeEntryMeta(resume, id, second.id, metaId)
    expect(tree.findById(resume.sections[0].items, second.id).meta).toHaveLength(metaCount - 1)

    const itemsBefore = resume.sections[0].items.length
    tree.removeEntry(resume, id, second.id)
    expect(resume.sections[0].items).toHaveLength(itemsBefore - 1)
    expect(tree.findById(resume.sections[0].items, second.id)).toBeUndefined()
  })

  it('skills：描述与技能项可增删改', () => {
    const resume = resumeWith('skills')
    const id = resume.sections[0].id

    tree.addSkillField(resume, id)
    const fieldId = resume.sections[0].fields.at(-1).id
    tree.updateSkillField(resume, id, fieldId, { value: '熟练使用 Vue 3' })
    expect(tree.findById(resume.sections[0].fields, fieldId).value).toBe('熟练使用 Vue 3')
    const fieldsBefore = resume.sections[0].fields.length
    tree.removeSkillField(resume, id, fieldId)
    expect(resume.sections[0].fields).toHaveLength(fieldsBefore - 1)

    tree.addSkill(resume, id)
    const skillId = resume.sections[0].items.at(-1).id
    tree.updateSkill(resume, id, skillId, { name: 'TypeScript', level: 90 })
    expect(tree.findById(resume.sections[0].items, skillId)).toMatchObject({
      name: 'TypeScript',
      level: 90,
    })
    const skillsBefore = resume.sections[0].items.length
    tree.removeSkill(resume, id, skillId)
    expect(resume.sections[0].items).toHaveLength(skillsBefore - 1)
  })
})

describe('基本信息字段', () => {
  it('createBasicsField 产出可直接渲染的默认字段', () => {
    const field = tree.createBasicsField()

    expect(field.id).toBeTruthy()
    expect(field.label).toBeTruthy()
    expect(field.value).toBe('')
    expect(field.icon).toBe('none')
  })

  it('每次产出的 id 都不同', () => {
    const ids = new Set([tree.createBasicsField().id, tree.createBasicsField().id])
    expect(ids.size).toBe(2)
  })
})
