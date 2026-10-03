import { describe, expect, it } from 'vitest'

import { sanitizeFilename, sanitizeResume } from '../server/sanitize.js'

/**
 * sanitize 是安全边界：所有注入、超限、伪造枚举的攻击面都在这里收口。
 * 测试按「攻击者会怎么发请求」组织，而不是按函数结构。
 */
describe('sanitizeResume：结构校验', () => {
  it('非对象与缺失 sections 一律拒绝', () => {
    expect(sanitizeResume(null).ok).toBe(false)
    expect(sanitizeResume('简历').ok).toBe(false)
    expect(sanitizeResume([1]).ok).toBe(false)
    expect(sanitizeResume({}).ok).toBe(false)
    expect(sanitizeResume({ sections: {} }).ok).toBe(false)
  })

  it('合法数据通过并补齐版本与模板', () => {
    const result = sanitizeResume({
      template: 'sidebar',
      theme: {},
      basics: { name: '张三' },
      sections: [{ type: 'text', title: '自评', content: '能吃苦' }],
    })
    expect(result.ok).toBe(true)
    expect(result.value.version).toBe(2)
    expect(result.value.template).toBe('sidebar')
    expect(result.value.sections[0].title).toBe('自评')
  })
})

describe('sanitizeResume：注入面', () => {
  it('文本中的标签被剥离而不是转义', () => {
    const { ok, value } = sanitizeResume({
      basics: { name: '<script>alert(1)</script>张三' },
      sections: [{ type: 'text', title: 't', content: '<img src=x onerror=alert(1)>正文' }],
    })
    expect(ok).toBe(true)
    expect(value.basics.name).toBe('alert(1)张三')
    expect(value.sections[0].content).toBe('正文')
  })

  it('落单尖括号与控制字符一并清除，换行保留', () => {
    const { value } = sanitizeResume({
      sections: [{ type: 'text', title: 't', content: 'a <b\n第二行\u0007' }],
    })
    expect(value.sections[0].content).toBe('a b\n第二行')
  })

  it('图片只接受白名单内的 dataURL', () => {
    const { value } = sanitizeResume({
      basics: { avatar: 'data:image/png;base64,iVBORw0KGgo=' },
      sections: [],
    })
    expect(value.basics.avatar).toBe('data:image/png;base64,iVBORw0KGgo=')

    const rejected = sanitizeResume({
      basics: { avatar: 'data:text/html;base64,PGgxPg==' },
      sections: [],
    })
    expect(rejected.value.basics.avatar).toBe('')
  })

  it('颜色只接受 #RRGGBB，非法回退默认值', () => {
    const { value } = sanitizeResume({
      theme: { accent: 'javascript:alert(1)', text: '#abc' },
      sections: [],
    })
    expect(value.theme.accent).toBe('#000000')
    expect(value.theme.text).toBe('#2b2f36')
  })
})

describe('sanitizeResume：枚举与数值', () => {
  it('未知枚举回退默认而不是透传', () => {
    const { value } = sanitizeResume({
      template: 'not-a-template',
      theme: { fontKey: 'comic-sans', titleStyle: 'xxx' },
      basics: { avatarShape: 'triangle' },
      sections: [{ type: 'hacker', title: 't' }],
    })
    expect(value.template).toBe('classic')
    expect(value.theme.fontKey).toBe('yahei')
    expect(value.theme.titleStyle).toBe('fill')
    expect(value.basics.avatarShape).toBe('square')
    expect(value.sections[0].type).toBe('text')
  })

  it('数值越界被裁剪到与设计面板一致的范围', () => {
    const { value } = sanitizeResume({
      theme: { fs: 99, mv: -5, titleBottomThickness: 1000 },
      basics: { avatarWidth: 999, avatarPos: { dx: 99999, dy: -99999 } },
      sections: [{ type: 'skills', items: [{ name: 'x', level: 999 }] }],
    })
    expect(value.theme.fs).toBe(1.6)
    expect(value.theme.mv).toBe(5)
    expect(value.theme.titleBottomThickness).toBe(12)
    expect(value.basics.avatarWidth).toBe(80)
    expect(value.basics.avatarPos.dx).toBe(300)
    expect(value.sections[0].items[0].level).toBe(100)
  })

  it('结构由服务端定义，客户端多出来的字段被丢弃', () => {
    const { value } = sanitizeResume({
      admin: true,
      basics: { name: '张三', isAdmin: true },
      sections: [{ type: 'grid', title: 't', items: [{ label: 'x', value: 'y', onclick: 'x' }] }],
    })
    expect(value.admin).toBeUndefined()
    expect(value.basics.isAdmin).toBeUndefined()
    expect(value.sections[0].items[0]).toEqual({ icon: 'none', label: 'x', value: 'y' })
  })
})

describe('sanitizeResume：数量与长度上限', () => {
  const makeSection = () => ({ type: 'text', title: 't', content: 'x' })

  it('模块数量截断', () => {
    const { value } = sanitizeResume({ sections: Array.from({ length: 50 }, makeSection) })
    expect(value.sections).toHaveLength(40)
  })

  it('单条文本超长被截断', () => {
    const { value } = sanitizeResume({
      sections: [{ type: 'text', title: 't', content: 'a'.repeat(5000) }],
    })
    expect(value.sections[0].content.length).toBe(2000)
  })
})

describe('sanitizeFilename', () => {
  it('控制字符（含响应头注入所需的 CR/LF）全部替换', () => {
    expect(sanitizeFilename('简历\r\nSet-Cookie: x')).toBe('简历 Set-Cookie_ x')
  })

  it('文件系统非法字符替换为下划线（不含尖括号输入，标签由 cleanText 语义处理）', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g"h|i')).toBe('a_b_c_d_e_f_g_h_i')
  })

  it('超长截断，空值回退', () => {
    expect(sanitizeFilename('x'.repeat(100))).toHaveLength(60)
    expect(sanitizeFilename('')).toBe('简历')
    expect(sanitizeFilename(undefined)).toBe('简历')
  })
})
