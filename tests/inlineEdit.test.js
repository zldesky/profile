import { describe, expect, it } from 'vitest'

import { resolveEditTarget } from '../src/composables/useInlineEdit.ts'
import { makeResume } from './helpers/resume-fixtures.js'

/**
 * 纸面就地编辑的字段解析。
 *
 * 这是整个功能里最该被测的一段：它把点到的 DOM 映射回数据字段，
 * 映射错了会把内容写到别处 —— 而且界面上看起来「改成功了」，
 * 直到用户发现改的是另一个字段。这里是纯函数，不起 DOM 就能覆盖全部分支。
 */

/** 造一份含四种模块的简历，覆盖所有可编辑字段 */
function fixture() {
  const resume = makeResume('就地编辑')
  resume.basics.name = '张三'
  resume.basics.jobTitle = '前端工程师'
  resume.sections = [
    {
      id: 'sec-text',
      type: 'text',
      title: '自我评价',
      visible: true,
      content: '原文',
      layout: {},
    },
    {
      id: 'sec-grid',
      type: 'grid',
      title: '基本信息',
      visible: true,
      layout: {},
      items: [{ id: 'g1', icon: 'none', label: '城市', value: '上海' }],
    },
    {
      id: 'sec-entries',
      type: 'entries',
      title: '工作经历',
      visible: true,
      layout: {},
      showLogo: false,
      items: [
        {
          id: 'e1',
          time: '2024.01 - 至今',
          org: '某公司',
          role: '前端',
          logo: '',
          meta: [{ id: 'm1', label: '团队', value: '6 人' }],
          bullets: [{ id: 'b1', text: '做了某事' }],
        },
      ],
    },
    {
      id: 'sec-skills',
      type: 'skills',
      title: '技能',
      visible: true,
      layout: {},
      showBars: true,
      fields: [{ id: 'f1', label: '语言', value: '中文' }],
      items: [{ id: 's1', name: 'TypeScript', level: 80 }],
    },
  ]
  return resume
}

/** 取字段并断言解析成功（失败时给出可读信息） */
function resolve(resume, target) {
  const result = resolveEditTarget(resume, {
    sectionId: '',
    field: '',
    itemId: '',
    entryId: '',
    ...target,
  })
  expect(result, `未能解析字段 ${target.field}`).not.toBeNull()
  return result
}

describe('页头字段', () => {
  it('姓名：取值并写回', () => {
    const resume = fixture()
    const target = resolve(resume, { field: 'name' })

    expect(target.value).toBe('张三')
    expect(target.kind).toBe('text')
    target.commit('李四')
    expect(resume.basics.name).toBe('李四')
  })

  it('求职职位：取值并写回', () => {
    const resume = fixture()
    const target = resolve(resume, { field: 'jobTitle' })

    expect(target.value).toBe('前端工程师')
    target.commit('后端工程师')
    expect(resume.basics.jobTitle).toBe('后端工程师')
  })

  it('页头字段不需要 sectionId（它们不属于任何模块）', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, { sectionId: '', field: 'name', itemId: '', entryId: '' }),
    ).not.toBeNull()
  })
})

describe('模块标题与正文', () => {
  it('模块标题：写回指定模块', () => {
    const resume = fixture()
    const target = resolve(resume, { sectionId: 'sec-text', field: 'sectionTitle' })

    expect(target.value).toBe('自我评价')
    target.commit('个人总结')
    expect(resume.sections[0].title).toBe('个人总结')
  })

  it('正文是多行输入（成段内容在单行框里改很难受）', () => {
    const resume = fixture()
    const target = resolve(resume, { sectionId: 'sec-text', field: 'content' })

    expect(target.kind).toBe('multiline')
    target.commit('新的一段')
    expect(resume.sections[0].content).toBe('新的一段')
  })

  it('把正文写到非 text 模块上不成立（返回 null 而不是写坏数据）', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, {
        sectionId: 'sec-grid',
        field: 'content',
        itemId: '',
        entryId: '',
      }),
    ).toBeNull()
  })

  it('模块 id 不存在时返回 null（模块刚被删掉的竞态）', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, {
        sectionId: 'gone',
        field: 'sectionTitle',
        itemId: '',
        entryId: '',
      }),
    ).toBeNull()
  })
})

describe('键值网格', () => {
  it('标签与内容分别写回同一个条目', () => {
    const resume = fixture()
    const label = resolve(resume, { sectionId: 'sec-grid', field: 'gridLabel', itemId: 'g1' })
    const value = resolve(resume, { sectionId: 'sec-grid', field: 'gridValue', itemId: 'g1' })

    expect(label.value).toBe('城市')
    expect(value.value).toBe('上海')

    label.commit('所在地')
    value.commit('北京')

    const item = resume.sections[1].items[0]
    expect(item.label).toBe('所在地')
    expect(item.value).toBe('北京')
  })

  it('条目 id 不存在时返回 null', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, {
        sectionId: 'sec-grid',
        field: 'gridValue',
        itemId: 'gone',
        entryId: '',
      }),
    ).toBeNull()
  })

  it('把 grid 字段用在 entries 模块上不成立', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, {
        sectionId: 'sec-entries',
        field: 'gridValue',
        itemId: 'e1',
        entryId: 'e1',
      }),
    ).toBeNull()
  })
})

describe('条目（工作经历）', () => {
  it('时间 / 机构 / 职位 三个字段各自写回', () => {
    const resume = fixture()
    const entry = () => resume.sections[2].items[0]

    resolve(resume, { sectionId: 'sec-entries', field: 'entryTime', entryId: 'e1' }).commit(
      '2025.01',
    )
    resolve(resume, { sectionId: 'sec-entries', field: 'entryOrg', entryId: 'e1' }).commit('新公司')
    resolve(resume, { sectionId: 'sec-entries', field: 'entryRole', entryId: 'e1' }).commit(
      '架构师',
    )

    expect(entry().time).toBe('2025.01')
    expect(entry().org).toBe('新公司')
    expect(entry().role).toBe('架构师')
  })

  it('meta 的标签与内容写回指定 meta', () => {
    const resume = fixture()

    resolve(resume, {
      sectionId: 'sec-entries',
      field: 'metaLabel',
      itemId: 'm1',
      entryId: 'e1',
    }).commit('规模')
    resolve(resume, {
      sectionId: 'sec-entries',
      field: 'metaValue',
      itemId: 'm1',
      entryId: 'e1',
    }).commit('10 人')

    expect(resume.sections[2].items[0].meta[0]).toMatchObject({ label: '规模', value: '10 人' })
  })

  it('要点是多行，写回指定要点', () => {
    const resume = fixture()
    const target = resolve(resume, {
      sectionId: 'sec-entries',
      field: 'bulletText',
      itemId: 'b1',
      entryId: 'e1',
    })

    expect(target.kind).toBe('multiline')
    target.commit('换了一条')
    expect(resume.sections[2].items[0].bullets[0].text).toBe('换了一条')
  })

  it('要点写错父条目时不落到别的条目上（返回 null）', () => {
    const resume = fixture()

    // 要点 b1 属于 e1，这里故意指向不存在的条目
    expect(
      resolveEditTarget(resume, {
        sectionId: 'sec-entries',
        field: 'bulletText',
        itemId: 'b1',
        entryId: 'nope',
      }),
    ).toBeNull()
  })

  it('条目的 id 对不上时返回 null', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, {
        sectionId: 'sec-entries',
        field: 'entryOrg',
        itemId: '',
        entryId: 'nope',
      }),
    ).toBeNull()
  })
})

describe('技能', () => {
  it('标签与内容写回 fields', () => {
    const resume = fixture()

    resolve(resume, {
      sectionId: 'sec-skills',
      field: 'skillLabel',
      itemId: 'f1',
    }).commit('语种')
    resolve(resume, {
      sectionId: 'sec-skills',
      field: 'skillValue',
      itemId: 'f1',
    }).commit('英语')

    expect(resume.sections[3].fields[0]).toMatchObject({ label: '语种', value: '英语' })
  })

  it('技能名写回 items', () => {
    const resume = fixture()
    const target = resolve(resume, { sectionId: 'sec-skills', field: 'skillName', itemId: 's1' })

    expect(target.value).toBe('TypeScript')
    target.commit('JavaScript')
    expect(resume.sections[3].items[0].name).toBe('JavaScript')
  })

  /*
   * 熟练度（skillLevel）整套已移除：纸面不再渲染百分比，也没有进度条可调，
   * 所以锚点也一并撤掉 —— 这条断言「它不再是一个可编辑字段」，
   * 比单纯删掉旧用例更有价值：万一以后又把 skillLevel 渲染回纸面，
   * 会立刻在这里失败，而不是变成一处「点了没反应」的哑区。
   */
  it('熟练度不再是可编辑字段（该功能已整套移除）', () => {
    const resume = fixture()

    /*
     * 直接调底层函数：本文件里的 resolve() 是「断言必须解析成功」的包装，
     * 而这里要断言的恰好相反 —— 用它会得到一句误导性的
     * 「未能解析字段 skillLevel: expected null not to be null」。
     */
    const target = resolveEditTarget(resume, {
      sectionId: 'sec-skills',
      field: 'skillLevel',
      itemId: 's1',
      entryId: '',
    })

    expect(target).toBe(null)
  })
})

describe('未知字段', () => {
  it('data-field 是没见过的值时返回 null（而不是抛错）', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, {
        sectionId: 'sec-text',
        field: 'nonsense',
        itemId: '',
        entryId: '',
      }),
    ).toBeNull()
  })

  it('field 为空时返回 null', () => {
    const resume = fixture()

    expect(
      resolveEditTarget(resume, { sectionId: 'sec-text', field: '', itemId: '', entryId: '' }),
    ).toBeNull()
  })
})
