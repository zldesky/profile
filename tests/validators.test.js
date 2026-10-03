import { describe, expect, it } from 'vitest'

import { contactFieldIssue } from '@/utils/validators'

describe('contactFieldIssue：联系方式软校验', () => {
  it('空内容不提示', () => {
    expect(contactFieldIssue('联系邮箱', '')).toBe('')
    expect(contactFieldIssue('联系邮箱', '   ')).toBe('')
  })

  it('无法识别语义的字段不校验', () => {
    expect(contactFieldIssue('现居城市', '上海')).toBe('')
    expect(contactFieldIssue('年龄', '28岁')).toBe('')
  })

  it('邮箱字段', () => {
    expect(contactFieldIssue('联系邮箱', 'zhangwei@example.com')).toBe('')
    expect(contactFieldIssue('Email', 'zhangwei@example.com')).toBe('')
    expect(contactFieldIssue('联系邮箱', 'zhangwei@example')).not.toBe('')
    expect(contactFieldIssue('联系邮箱', 'zhangwei example.com')).not.toBe('')
  })

  it('电话字段', () => {
    expect(contactFieldIssue('联系电话', '13800000000')).toBe('')
    expect(contactFieldIssue('联系电话', '+86 138 0000 0000')).toBe('')
    expect(contactFieldIssue('手机', '138')).not.toBe('')
    expect(contactFieldIssue('电话', 'hello')).not.toBe('')
  })

  it('链接字段', () => {
    expect(contactFieldIssue('作品集链接', 'https://example.com/portfolio')).toBe('')
    expect(contactFieldIssue('GitHub', 'github.com/zldesky')).toBe('')
    expect(contactFieldIssue('个人主页', 'my portfolio page')).not.toBe('')
    expect(contactFieldIssue('个人主页', 'localhost')).not.toBe('')
  })

  it('大小写标签也能识别语义', () => {
    expect(contactFieldIssue('EMAIL 地址', 'bad-email')).not.toBe('')
  })
})
