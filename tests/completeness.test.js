import { describe, expect, it } from 'vitest'

import { createResume } from '@/data/defaultResume'
import { checkResume } from '@/utils/completeness'

/** 与 createDoc 的新建空白简历一致的空数据 */
function createBlank() {
  const blank = createResume()
  blank.basics.name = ''
  blank.basics.jobTitle = ''
  blank.basics.fields = []
  blank.sections = []
  return blank
}

const titles = (report) => report.issues.map((issue) => issue.title)

describe('checkResume', () => {
  it('示例简历没有硬伤，分数接近满分', () => {
    const report = checkResume(createResume())
    expect(report.counts.error).toBe(0)
    expect(report.score).toBeGreaterThanOrEqual(90)
  })

  it('空简历能给出低分，并指出缺姓名、缺联系方式、没有模块', () => {
    const report = checkResume(createBlank())
    expect(report.score).toBeLessThan(45)
    const all = titles(report).join('|')
    expect(all).toContain('缺少姓名')
    expect(all).toContain('缺少联系电话')
    expect(all).toContain('没有任何内容模块')
    expect(report.counts.error).toBeGreaterThanOrEqual(2)
  })

  it('删掉电话字段会报缺少联系电话的硬伤', () => {
    const resume = createResume()
    resume.basics.fields = resume.basics.fields.filter((f) => f.label !== '联系电话')
    expect(titles(checkResume(resume))).toContain('缺少联系电话')
  })

  it('联系方式格式可疑时给出 warn 提示', () => {
    const resume = createResume()
    const mail = resume.basics.fields.find((f) => f.label === '联系邮箱')
    mail.value = 'not-an-email'
    const report = checkResume(resume)
    expect(titles(report)).toContain('「联系邮箱」格式存疑')
  })

  it('空条目模块算 error，未填完的键值网格算 warn', () => {
    const resume = createResume()
    resume.sections = [
      { id: 's1', type: 'entries', title: '工作经历', visible: true, items: [] },
      {
        id: 's2',
        type: 'grid',
        title: '求职意向',
        visible: true,
        items: [
          { id: 'g1', label: '求职岗位', value: '前端' },
          { id: 'g2', label: '意向城市', value: '' },
        ],
      },
    ]
    const report = checkResume(resume)
    expect(titles(report)).toContain('「工作经历」模块是空的')
    expect(titles(report)).toContain('「求职意向」有未填完的条目（1 处）')
    expect(report.counts.error).toBe(1)
  })

  it('同模块多条目缺机构名合并成一条并标注处数', () => {
    const resume = createResume()
    const work = resume.sections.find((s) => s.title === '工作经历')
    work.items.forEach((entry) => (entry.org = ''))
    const report = checkResume(resume)
    const hits = report.issues.filter((issue) => issue.title.includes('没写机构'))
    expect(hits.length).toBe(1)
    expect(hits[0].title).toContain('2 处')
  })

  it('删掉教育背景模块会提示补充', () => {
    const resume = createResume()
    resume.sections = resume.sections.filter((s) => s.title !== '教育背景')
    expect(titles(checkResume(resume))).toContain('没有教育背景模块')
  })

  it('隐藏模块只给 tip 级提示', () => {
    const resume = createResume()
    resume.sections[0].visible = false
    const report = checkResume(resume)
    expect(titles(report)).toContain('有 1 个模块处于隐藏状态')
    expect(report.counts.tip).toBe(1)
  })

  it('过半要点没有数字时提示补充量化数据', () => {
    const resume = createResume()
    // 只留一个经历模块，其余模块的带数字要点会稀释比例
    resume.sections = [
      {
        id: 's1',
        type: 'entries',
        title: '工作经历',
        visible: true,
        items: [
          {
            id: 'e1',
            org: '某公司',
            role: '工程师',
            time: '2020-01 - 至今',
            logo: '',
            meta: [],
            bullets: [
              { id: 'b1', text: '负责需求开发' },
              { id: 'b2', text: '参与方案设计' },
              { id: 'b3', text: '推动流程优化' },
              { id: 'b4', text: '支持线上运维' },
            ],
          },
        ],
      },
    ]
    expect(titles(checkResume(resume))).toContain('多数要点缺少量化数据')
  })

  it('问题按严重度排序：error 在 warn 与 tip 之前', () => {
    const resume = createBlank()
    const report = checkResume(resume)
    const rank = { error: 0, warn: 1, tip: 2 }
    const ranks = report.issues.map((issue) => rank[issue.level])
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })
})
