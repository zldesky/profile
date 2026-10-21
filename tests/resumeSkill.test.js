import { describe, expect, it } from 'vitest'

import { inspectResume } from '../skills/resume-workshop/scripts/validate_resume.mjs'

/** 最小合法简历：与服务端白名单一致的最简结构 */
function minimalResume() {
  return {
    template: 'classic',
    basics: {
      name: '张三',
      jobTitle: '前端开发工程师',
      showAvatar: false,
      fields: [{ icon: 'phone', label: '联系电话', value: '13800000001' }],
    },
    sections: [
      {
        type: 'entries',
        title: '工作经历',
        items: [
          {
            time: '2022-06 - 至今',
            org: '某公司',
            role: '前端开发',
            meta: [],
            bullets: [{ text: '负责 XX 系统，首屏从 3s 降至 1s' }],
          },
        ],
      },
    ],
  }
}

describe('inspectResume（Agent Skill 校验器，与服务端 sanitize.ts 同源）', () => {
  it('合法简历返回 ok 并给出统计', () => {
    const result = inspectResume(minimalResume())
    expect(result.ok).toBe(true)
    expect(result.stats.template).toBe('classic')
    expect(result.stats.sections).toBe(1)
    expect(result.stats.entries).toBe(1)
    expect(result.stats.bullets).toBe(1)
    expect(result.warnings).toEqual([])
  })

  it('缺 sections 是硬错误，与 /api/pdf 的 400 行为一致', () => {
    expect(inspectResume({ basics: {} })).toMatchObject({ ok: false, error: '缺少 sections 字段' })
    expect(inspectResume(null).ok).toBe(false)
    expect(inspectResume([1, 2]).ok).toBe(false)
  })

  it('越界值被静默清洗而非报错：模板回退、枚举回退、HTML 剥离、level 钳制', () => {
    const resume = minimalResume()
    resume.template = 'not-exist'
    resume.sections[0].items[0].bullets[0].text = '<b>整段加粗</b>会被剥成纯文本'
    resume.sections.push({
      type: 'skills',
      title: '技能',
      items: [{ name: 'Vue', level: 250, extra: '多余键' }],
    })
    resume.sections.push({
      type: 'grid',
      title: '求职意向',
      items: [{ icon: 'rocket', label: '岗位', value: '后端' }],
    })

    const result = inspectResume(resume)
    expect(result.ok).toBe(true)
    expect(result.stats.template).toBe('classic')
    const skills = result.stats.byType.skills
    expect(skills).toBe(1)
    expect(result.stats.byType.grid).toBe(1)
  })

  it('客户端提供的 id 被丢弃（服务端重新生成）', () => {
    const resume = minimalResume()
    resume.sections[0].id = 'sec_fake'
    const result = inspectResume(resume)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result.stats)).not.toContain('sec_fake')
  })

  it('空简历给出一组可操作的质量警告', () => {
    const resume = {
      basics: { name: '', jobTitle: '', showAvatar: false, fields: [] },
      sections: [
        {
          type: 'entries',
          title: '工作经历',
          items: [{ time: '', org: '', role: '', meta: [], bullets: [{ text: '' }] }],
        },
        { type: 'text', title: '自我评价', content: '我是某某某，邮箱 example.com' },
      ],
    }
    const result = inspectResume(resume)
    expect(result.ok).toBe(true)
    const warnings = result.warnings.join('\n')
    expect(warnings).toContain('缺姓名')
    expect(warnings).toContain('缺求职岗位')
    expect(warnings).toContain('缺联系方式')
    expect(warnings).toContain('空经历')
    expect(warnings).toContain('空要点')
    expect(warnings).toContain('占位符')
  })

  it('开了头像位但没有图会提醒', () => {
    const resume = minimalResume()
    resume.basics.showAvatar = true
    resume.basics.avatar = ''
    const result = inspectResume(resume)
    expect(result.warnings.join('\n')).toContain('没有头像图')
  })
})
