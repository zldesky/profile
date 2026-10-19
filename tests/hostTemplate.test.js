import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { normalizeResume } from '@/data/normalizeResume'
import { markdownToResume, resumeToSourceMarkdown } from '@/utils/markdownSource'

/**
 * 宿主模板（markdown-hosts/templates/resume.md）的漂移测试。
 *
 * 那个文件是**由应用自己的导出器生成**的（`npm run build:host-template`），
 * 所以它必须始终符合当前格式。格式改了而模板没重新生成，
 * 用户在 VSCode / Typora / Obsidian 里看到的排版就会不对 —— 而那种不对很难归因。
 *
 * 这里断言三件事：模板仍然是合法输入、仍然带当前的格式标记、仍然能往返。
 */

const TEMPLATE_PATH = fileURLToPath(
  new URL('../markdown-hosts/templates/resume.md', import.meta.url),
)
const template = readFileSync(TEMPLATE_PATH, 'utf8')

/** 抽出「内容形状」用于比对（与 markdownSource.test.js 同一套口径） */
function shape(resume) {
  return resume.sections.map((s) => {
    const base = { type: s.type, title: s.title }
    if (s.type === 'entries') {
      return {
        ...base,
        items: s.items.map((e) => ({
          org: e.org,
          role: e.role,
          time: e.time,
          meta: e.meta.map((m) => m.label),
          bullets: e.bullets.map((b) => b.text),
        })),
      }
    }
    if (s.type === 'grid') return { ...base, items: s.items.map((i) => i.label) }
    if (s.type === 'skills') {
      return { ...base, fields: s.fields.map((f) => f.label), items: s.items.map((i) => i.name) }
    }
    return { ...base, content: s.content }
  })
}

describe('宿主模板 resume.md', () => {
  it('带当前格式要求的类型提示', () => {
    // 每种模块类型都该出现至少一次；模板里是 grid / entries / skills / text
    for (const type of ['grid', 'entries', 'skills', 'text']) {
      expect(
        template,
        `模板里缺少 ${type} 的类型提示，跑 npm run build:host-template 重新生成`,
      ).toContain(`<!-- resume:type=${type} -->`)
    }
  })

  it('键值行的标签是加粗的（无歧义标记）', () => {
    expect(template).toMatch(/^- \*\*.+?\*\*：/m)
  })

  it('解析后四种模块类型齐全', () => {
    const types = normalizeResume(markdownToResume(template)).sections.map((s) => s.type)
    expect(new Set(types)).toEqual(new Set(['grid', 'entries', 'skills', 'text']))
  })

  it('带中文冒号的要点仍是要点（不会退化成补充字段）', () => {
    // 模板的教育背景里就有「主修课程：数据结构…」这一条
    const resume = normalizeResume(markdownToResume(template))
    const bullets = resume.sections
      .filter((s) => s.type === 'entries')
      .flatMap((s) => s.items)
      .flatMap((e) => e.bullets)
      .map((b) => b.text)

    expect(bullets.some((t) => t.includes('主修课程：'))).toBe(true)
  })

  it('往返一次内容形状不变（模板自身是稳定的）', () => {
    const once = normalizeResume(markdownToResume(template))
    const twice = normalizeResume(markdownToResume(resumeToSourceMarkdown(once)))

    expect(shape(twice)).toEqual(shape(once))
  })

  it('模板内容非空：姓名与每个模块都有实质内容', () => {
    const resume = normalizeResume(markdownToResume(template))
    expect(resume.basics.name.length).toBeGreaterThan(0)
    for (const section of resume.sections) {
      expect(section.title.length).toBeGreaterThan(0)
    }
  })
})
