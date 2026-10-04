import { describe, expect, it } from 'vitest'

import { createResume } from '@/data/defaultResume'
import { buildJdMatchMessages, parseJdMatchResult, summarizeResumeForAI } from '@/utils/aiClient'

describe('summarizeResumeForAI', () => {
  it('只保留内容字段，主题与模板信息不进入摘要', () => {
    const summary = summarizeResumeForAI(createResume())
    expect(summary).toContain('姓名：张伟')
    expect(summary).toContain('【工作经历】')
    expect(summary).toContain('- 主导公司中后台微前端体系改造')
    expect(summary).not.toContain('classic')
    expect(summary).not.toContain('titleStyle')
  })

  it('隐藏模块不进摘要', () => {
    const resume = createResume()
    resume.sections[0].visible = false
    const summary = summarizeResumeForAI(resume)
    expect(summary).not.toContain('【求职意向】')
    expect(summary).toContain('【工作经历】')
  })

  it('超预算时截断并标注省略', () => {
    const summary = summarizeResumeForAI(createResume(), 200)
    expect(summary.length).toBeLessThanOrEqual(200 + 12)
    expect(summary.endsWith('（简历后文已省略）')).toBe(true)
  })
})

describe('buildJdMatchMessages', () => {
  it('system 要求只输出 JSON，user 携带简历摘要与 JD', () => {
    const messages = buildJdMatchMessages('简历摘要', '岗位职责内容', '前端工程师')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('JSON')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('目标岗位：前端工程师')
    expect(messages[1].content).toContain('【简历内容】\n简历摘要')
    expect(messages[1].content).toContain('【岗位 JD】\n岗位职责内容')
  })

  it('整体消息不超过服务端单条 8000 字符限额', () => {
    const longJd = '_requirements '.repeat(600)
    const messages = buildJdMatchMessages(summarizeResumeForAI(createResume()), longJd, '前端')
    messages.forEach((message) => expect(message.content.length).toBeLessThanOrEqual(8000))
  })
})

describe('parseJdMatchResult', () => {
  const payload = {
    matched: [{ kw: 'Vue3', evidence: '中后台微前端体系' }],
    missing: [{ kw: 'Kubernetes', why: '云原生部署的通用要求' }],
    suggestions: ['在技能特长中补充 K8s 相关实践'],
  }

  it('解析裸 JSON 与带 markdown 代码块的返回', () => {
    const direct = parseJdMatchResult(JSON.stringify(payload))
    expect(direct.matched[0]).toEqual({ kw: 'Vue3', note: '中后台微前端体系' })
    expect(direct.missing[0].note).toBe('云原生部署的通用要求')
    expect(direct.suggestions).toHaveLength(1)

    const fenced = parseJdMatchResult('```json\n' + JSON.stringify(payload) + '\n```')
    expect(fenced.matched[0].kw).toBe('Vue3')
  })

  it('容忍 JSON 前后的说明文字', () => {
    const noisy = parseJdMatchResult(`分析结果如下：\n${JSON.stringify(payload)}\n以上。`)
    expect(noisy.missing[0].kw).toBe('Kubernetes')
  })

  it('过滤缺少关键词的条目，全部为空时抛错', () => {
    const partial = parseJdMatchResult(
      JSON.stringify({
        matched: [{ kw: '', evidence: 'x' }, { kw: 'React' }],
        missing: [],
        suggestions: [],
      }),
    )
    expect(partial.matched).toHaveLength(1)
    expect(partial.matched[0].kw).toBe('React')

    expect(() => parseJdMatchResult('{}')).toThrow(/有效/)
    expect(() => parseJdMatchResult('模型表示无法完成')).toThrow()
    expect(() => parseJdMatchResult('{"matched": "不是数组"}')).toThrow()
  })
})
