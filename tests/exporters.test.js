import { describe, expect, it } from 'vitest'

import { createResume } from '@/data/defaultResume'
import { resumeToMarkdown, resumeToPlainText } from '@/utils/exporters'

describe('resumeToMarkdown', () => {
  it('包含姓名、模块标题、条目标题与要点列表', () => {
    const md = resumeToMarkdown(createResume())
    expect(md).toContain('# 张伟')
    expect(md).toContain('**前端开发工程师**')
    expect(md).toContain('## 工作经历')
    expect(md).toContain('### 某某科技有限公司 · 高级前端开发工程师')
    expect(md).toContain('- 主导公司中后台微前端体系改造')
    expect(md).toContain('- 求职岗位：前端开发工程师')
    expect(md).toContain('- 技术栈：熟练使用 Vue3')
    expect(md).toContain('- Vue / TypeScript')
  })

  it('隐藏模块不导出', () => {
    const resume = createResume()
    resume.sections[0].visible = false
    const md = resumeToMarkdown(resume)
    expect(md).not.toContain('## 求职意向')
    expect(md).toContain('## 工作经历')
  })

  it('条目的补充字段（meta）导出为键值行', () => {
    const md = resumeToMarkdown(createResume())
    expect(md).toContain('- 专业成绩：GPA 3.7/4.0，专业排名前 5%')
  })

  it('空简历也能导出，不抛错', () => {
    const resume = createResume()
    resume.basics.name = ''
    resume.basics.fields = []
    resume.sections = []
    const md = resumeToMarkdown(resume)
    expect(md.startsWith('# 简历')).toBe(true)
    expect(md.endsWith('\n')).toBe(true)
  })

  it('技能模块开启进度条时附熟练度', () => {
    const resume = createResume()
    resume.sections.find((s) => s.title === '技能特长').showBars = true
    expect(resumeToMarkdown(resume)).toContain('- Vue / TypeScript（熟练度 92%）')
  })
})

describe('resumeToPlainText', () => {
  it('模块标题用【】包裹，不含 markdown 标记', () => {
    const text = resumeToPlainText(createResume())
    expect(text).toContain('张伟 ｜ 前端开发工程师')
    expect(text).toContain('【工作经历】')
    expect(text).toContain('某某科技有限公司 ｜ 高级前端开发工程师')
    expect(text).not.toContain('# ')
    expect(text).not.toContain('**')
    expect(text).not.toContain('##')
  })

  it('条目带时间行，要点用连字符列表', () => {
    const text = resumeToPlainText(createResume())
    expect(text).toContain('时间：2022-06 - 至今')
    expect(text).toContain('- 主导公司中后台微前端体系改造')
  })

  it('隐藏模块与空值字段不导出', () => {
    const resume = createResume()
    resume.sections[0].visible = false
    resume.basics.fields = resume.basics.fields.filter((f) => f.label !== '联系电话')
    const text = resumeToPlainText(resume)
    expect(text).not.toContain('【求职意向】')
    expect(text).not.toContain('联系电话')
  })

  it('空简历导出不抛错且以换行结尾', () => {
    const resume = createResume()
    resume.basics.name = ''
    resume.basics.fields = []
    resume.sections = []
    const text = resumeToPlainText(resume)
    expect(text.endsWith('\n')).toBe(true)
  })
})
