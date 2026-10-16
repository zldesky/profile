import { describe, expect, it } from 'vitest'

import { buildResumeFromLines } from '../src/utils/pdfImport.ts'

/**
 * 合成行按 pdf.js 抽取结果的形态构造：视觉行、字号、页码。
 * 内容取自本编辑器渲染输出的真实版式（time org role 同行、要点带符号）。
 */
const sampleLines = [
  { text: '林致远', size: 18, page: 1 },
  { text: '前端开发工程师', size: 11, page: 1 },
  { text: '138-0000-0000 联系电话', size: 9, page: 1 },
  { text: 'demo@example.com 联系邮箱', size: 9, page: 1 },
  { text: '上海 现居城市', size: 9, page: 1 },
  { text: '求职意向', size: 12, page: 1 },
  { text: '求职岗位： 前端开发工程师', size: 9, page: 1 },
  { text: '期望薪资： 28K-38K', size: 9, page: 1 },
  { text: '工作经历', size: 12, page: 1 },
  { text: '2022-03 - 至今 云帆信息技术有限公司 高级前端开发工程师', size: 9, page: 1 },
  { text: '主导中后台微前端改造，12 个子应用接入统一基座。', size: 9, page: 1 },
  { text: '• 推动首屏性能专项，LCP 从 3.2s 优化至 1.4s。', size: 9, page: 1 },
  { text: '2019-07 - 2022-02 星河网络科技 前端开发工程师', size: 9, page: 1 },
  { text: '负责电商 C 端活动页开发，支撑大促稳定运行。', size: 9, page: 1 },
  { text: '教育背景', size: 12, page: 1 },
  { text: '2015-09 - 2019-06 华东理工大学 计算机科学与技术（本科）', size: 9, page: 1 },
  { text: '技能特长', size: 12, page: 1 },
  { text: '技术栈：熟练使用 Vue3、TypeScript、Vite。', size: 9, page: 1 },
  { text: 'Vue / TypeScript、工程化、性能优化', size: 9, page: 1 },
  { text: '自我评价', size: 12, page: 1 },
  { text: '五年前端开发经验，擅长工程化落地。', size: 9, page: 1 },
]

describe('PDF 导入解析', () => {
  it('识别姓名、求职岗位与联系方式', () => {
    const { resume, warnings } = buildResumeFromLines(sampleLines)

    expect(resume.basics.name).toBe('林致远')
    expect(resume.basics.jobTitle).toBe('前端开发工程师')
    const values = resume.basics.fields.map((field) => field.value)
    expect(values).toContain('138-0000-0000')
    expect(values).toContain('demo@example.com')
    // 头像等无关字段不该有值
    expect(resume.basics.avatar).toBe('')
    expect(warnings).toEqual([])
  })

  it('按模块标题切分出五类模块', () => {
    const { resume } = buildResumeFromLines(sampleLines)
    const titles = resume.sections.map((section) => section.title)

    expect(titles).toEqual(['求职意向', '工作经历', '教育背景', '技能特长', '自我评价'])
    expect(resume.sections[0].type).toBe('grid')
    expect(resume.sections[1].type).toBe('entries')
    expect(resume.sections[3].type).toBe('skills')
    expect(resume.sections[4].type).toBe('text')
  })

  it('条目按时间段切分，要点归入所属条目', () => {
    const { resume } = buildResumeFromLines(sampleLines)
    const work = resume.sections.find((section) => section.title === '工作经历')

    expect(work.items).toHaveLength(2)
    expect(work.items[0].time).toBe('2022-03 - 至今')
    expect(work.items[0].org).toBe('云帆信息技术有限公司')
    expect(work.items[0].role).toBe('高级前端开发工程师')
    expect(work.items[0].bullets).toHaveLength(2)
    expect(work.items[0].bullets[1].text).toContain('LCP 从 3.2s')
    // 要点符号已被剥掉
    expect(work.items[1].bullets[0].text).not.toMatch(/^[•]/)
  })

  it('技能段：标签行进描述、顿号行拆成技能项', () => {
    const { resume } = buildResumeFromLines(sampleLines)
    const skills = resume.sections.find((section) => section.title === '技能特长')

    expect(skills.fields).toEqual([{ label: '技术栈', value: '熟练使用 Vue3、TypeScript、Vite。' }])
    expect(skills.items.map((item) => item.name)).toEqual([
      'Vue / TypeScript',
      '工程化',
      '性能优化',
    ])
  })

  it('求职意向的键值行转网格条目，联系方式行不混入', () => {
    const { resume } = buildResumeFromLines(sampleLines)
    const intent = resume.sections[0]

    expect(intent.items).toHaveLength(2)
    expect(intent.items[0]).toEqual({
      icon: 'briefcase',
      label: '求职岗位',
      value: '前端开发工程师',
    })
  })

  it('识别编号式标题（一、工作经历）', () => {
    const lines = [
      { text: '张三', size: 16, page: 1 },
      { text: '一、工作经历', size: 12, page: 1 },
      { text: '2020-01 - 至今 某公司 工程师', size: 9, page: 1 },
      { text: '做事很稳。', size: 9, page: 1 },
    ]
    const { resume } = buildResumeFromLines(lines)
    const work = resume.sections.find((section) => section.title === '工作经历')

    expect(work.items[0].org).toBe('某公司')
    expect(work.items[0].bullets[0].text).toBe('做事很稳。')
  })

  it('没有任何结构时兜底进「原文内容」并给出警告', () => {
    const lines = [{ text: '一份没有模块标题的简历内容，随便写了点什么。', size: 10, page: 1 }]
    const { resume, warnings } = buildResumeFromLines(lines)

    expect(resume.sections).toHaveLength(1)
    expect(resume.sections[0].title).toBe('原文内容')
    expect(resume.sections[0].content).toContain('随便写了点什么')
    expect(warnings.some((w) => w.includes('没有识别出常见的模块结构'))).toBe(true)
  })

  it('条目行缺失机构时仍保留时间与要点', () => {
    const lines = [
      { text: '李四', size: 16, page: 1 },
      { text: '工作经历', size: 12, page: 1 },
      { text: '2018-06 - 2019-07 自由职业', size: 9, page: 1 },
      { text: '独立完成若干项目。', size: 9, page: 1 },
    ]
    const { resume } = buildResumeFromLines(lines)
    const work = resume.sections.find((section) => section.title === '工作经历')

    expect(work.items[0].time).toBe('2018-06 - 2019-07')
    expect(work.items[0].org).toBe('自由职业')
  })
})
