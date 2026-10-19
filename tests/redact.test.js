import { describe, expect, it } from 'vitest'

import { redactForShare, redactSensitive } from '../server/redact.ts'

/**
 * 分享前的敏感信息屏蔽。
 *
 * 这一组断言的是**安全属性**，所以判据要能真的证明「值没出去」，
 * 而不只是「看起来变了」：因此大量直接用 `not.toContain(原文)` 查泄漏。
 */

/** 一份带各种敏感信息的简历 */
function makeResume() {
  return {
    version: 2,
    template: 'classic',
    theme: { accent: '#000', mv: 12, mh: 14 },
    basics: {
      name: '张伟',
      jobTitle: '前端开发工程师',
      avatar: 'data:image/png;base64,AAA',
      showAvatar: true,
      fields: [
        { icon: 'cake', label: '年龄', value: '28岁' },
        { icon: 'none', label: '性别', value: '男' },
        { icon: 'phone', label: '联系电话', value: '13800000000' },
        { icon: 'mail', label: '联系邮箱', value: 'zhangwei@example.com' },
        { icon: 'location', label: '现居城市', value: '上海' },
        { icon: 'link', label: '个人主页', value: 'https://example.com/me' },
      ],
    },
    sections: [
      {
        type: 'grid',
        title: '求职意向',
        visible: true,
        items: [{ icon: 'briefcase', label: '求职岗位', value: '前端开发工程师' }],
      },
      {
        type: 'entries',
        title: '工作经历',
        visible: true,
        items: [
          {
            org: '某某公司',
            role: '高级前端',
            time: '2022-06 - 至今',
            logo: '',
            meta: [{ label: '汇报对象', value: '技术总监' }],
            bullets: [
              { text: '主导微前端改造，构建耗时从 8 分钟降至 90 秒。' },
              // 联系方式被写进要点 —— 只按标签查会漏掉这种
              { text: '在职期间可直接联系 13911112222 沟通细节。' },
            ],
          },
        ],
      },
      {
        type: 'text',
        title: '自我评价',
        visible: true,
        content: '如需详谈可发邮件至 zhangwei.work@example.com，或加微信 zhangwei88。',
      },
    ],
  }
}

/** 把对象里所有字符串拼起来，用于直接查泄漏 */
function allText(value) {
  if (typeof value === 'string') return `${value}\n`
  if (Array.isArray(value)) return value.map(allText).join('')
  if (value && typeof value === 'object') {
    return Object.values(value).map(allText).join('')
  }
  return ''
}

/** 把 basics.fields 转成 { 标签: 取值 } */
function fieldsByLabel(resume) {
  return Object.fromEntries(resume.basics.fields.map((f) => [f.label, f.value]))
}

describe('redactSensitive：按标签屏蔽', () => {
  it('电话与邮箱被部分屏蔽', () => {
    const { resume } = redactSensitive(makeResume())
    const byLabel = fieldsByLabel(resume)

    expect(byLabel['联系电话']).toBe('138****0000')
    expect(byLabel['联系邮箱']).toBe('z***@example.com')
  })

  it('年龄、性别、现居城市这类字段整体替换成 **', () => {
    const { resume } = redactSensitive(makeResume())
    const byLabel = fieldsByLabel(resume)

    expect(byLabel['年龄']).toBe('**')
    expect(byLabel['性别']).toBe('**')
    expect(byLabel['现居城市']).toBe('**')
  })

  it('不敏感的字段原样保留（屏蔽不能把简历改得没法看）', () => {
    const { resume } = redactSensitive(makeResume())
    const byLabel = fieldsByLabel(resume)

    expect(byLabel['个人主页']).toBe('https://example.com/me')
    const intent = resume.sections.find((s) => s.title === '求职意向')
    expect(intent.items[0].value).toBe('前端开发工程师')
  })

  it('告诉调用方屏蔽了哪些字段（便于界面如实告知用户）', () => {
    const { maskedLabels } = redactSensitive(makeResume())

    expect(maskedLabels).toContain('联系电话')
    expect(maskedLabels).toContain('联系邮箱')
    expect(maskedLabels).toContain('年龄')
    // 去重：标签只出现一次
    expect(new Set(maskedLabels).size).toBe(maskedLabels.length)
  })

  it('按标签判定、而不是按取值格式 ——「微信同号」这种不像手机号的也要屏蔽', () => {
    const resume = { basics: { fields: [{ label: '联系电话', value: '微信同号' }] } }
    const { resume: out } = redactSensitive(resume)
    const value = out.basics.fields[0].value

    expect(value).toBe('**')
    expect(value).not.toContain('微信')
  })
})

describe('redactSensitive：正文里的模式屏蔽', () => {
  it('写进要点里的手机号也会被屏蔽', () => {
    const { resume, maskedInText } = redactSensitive(makeResume())
    const text = allText(resume)

    expect(text).not.toContain('13911112222')
    expect(text).toContain('139****2222')
    expect(maskedInText).toBeGreaterThan(0)
  })

  it('写进段落里的邮箱也会被屏蔽', () => {
    const { resume } = redactSensitive(makeResume())
    const text = allText(resume)

    expect(text).not.toContain('zhangwei.work@example.com')
    expect(text).toContain('z***@example.com')
  })

  it('身份证号整体替换，不保留前后段', () => {
    const resume = { sections: [{ type: 'text', content: '证件号 11010119900307123X 已核验' }] }
    const text = allText(redactSensitive(resume).resume)

    expect(text).not.toContain('11010119900307123X')
    expect(text).toContain('**')
  })

  it('普通的数字与链接不会被误伤', () => {
    const resume = {
      sections: [
        { type: 'text', content: '大促期间单日 300 万 PV，LCP 从 3.2s 优化至 1.4s。' },
        { type: 'text', content: '项目地址 https://github.com/example/project' },
      ],
    }
    const { resume: out, maskedInText } = redactSensitive(resume)
    const text = allText(out)

    expect(text).toContain('300 万 PV')
    expect(text).toContain('3.2s')
    expect(text).toContain('https://github.com/example/project')
    expect(maskedInText).toBe(0)
  })
})

describe('redactSensitive：整体性质', () => {
  it('原始数据不被修改（调用方可能还要继续用）', () => {
    const resume = makeResume()
    const before = JSON.stringify(resume)
    redactSensitive(resume)

    expect(JSON.stringify(resume)).toBe(before)
  })

  it('结构不变：屏蔽是替换取值，不是删字段', () => {
    const resume = makeResume()
    const { resume: out } = redactSensitive(resume)

    // 数组长度与键集合都要保持一致，否则版面会跳、界面也会缺项
    expect(out.basics.fields.length).toBe(resume.basics.fields.length)
    expect(out.sections.length).toBe(resume.sections.length)
    expect(Object.keys(out.basics).sort()).toEqual(Object.keys(resume.basics).sort())
    expect(Object.keys(out.theme).sort()).toEqual(Object.keys(resume.theme).sort())
  })

  it('空值与缺字段不会抛错', () => {
    expect(() => redactSensitive(null)).not.toThrow()
    expect(() => redactSensitive(undefined)).not.toThrow()
    expect(() => redactSensitive({})).not.toThrow()
    expect(() => redactSensitive({ basics: { fields: [{ label: '', value: '' }] } })).not.toThrow()
  })

  it('空取值的字段不算被屏蔽（不该出现在告知列表里）', () => {
    const resume = { basics: { fields: [{ label: '联系电话', value: '' }] } }
    const { maskedLabels } = redactSensitive(resume)

    expect(maskedLabels).toEqual([])
  })
})

describe('redactForShare：分享场景的开关语义', () => {
  it('默认屏蔽（不传开关就等于屏蔽）', () => {
    const { resume, maskedLabels } = redactForShare(makeResume())

    expect(maskedLabels.length).toBeGreaterThan(0)
    expect(allText(resume)).not.toContain('13800000000')
  })

  it('显式 revealContacts 时整体不屏蔽 —— 包括正文里的号码', () => {
    /*
     * 这一点是刻意的：开关的语义是「这份分享要带上我的联系方式」。
     * 若只放行标签屏蔽、却仍替掉正文里的号码，用户会以为开关坏了。
     */
    const { resume, maskedLabels, maskedInText } = redactForShare(makeResume(), {
      revealContacts: true,
    })

    expect(maskedLabels).toEqual([])
    expect(maskedInText).toBe(0)
    expect(allText(resume)).toContain('13800000000')
    expect(allText(resume)).toContain('13911112222')
  })
})
