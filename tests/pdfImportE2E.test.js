import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildResumeFromLines, extractPdfLines } from '../src/utils/pdfImport.ts'

/**
 * 端到端集成测试：用编辑器渲染服务产出的真实矢量 PDF（tests/fixtures/），
 * 走完 pdf.js 提取 + 启发式解析全链路。PDF 由 tests/fixtures 的示例数据渲染，
 * 内容是固定的一页简历（林致远 · 前端开发工程师）。
 */
const fixture = fileURLToPath(new URL('./fixtures/resume-sample.pdf', import.meta.url))

describe('PDF 导入端到端（真实 PDF fixture）', () => {
  it('提取出行并还原出完整模块结构', async () => {
    const buffer = readFileSync(fixture)
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

    const lines = await extractPdfLines(data)
    expect(lines.length).toBeGreaterThan(10)

    const { resume, warnings } = buildResumeFromLines(lines)
    expect(resume.basics.name).toBe('林致远')
    expect(resume.basics.jobTitle).toBe('前端开发工程师')

    const titles = resume.sections.map((section) => section.title)
    expect(titles).toEqual(['求职意向', '工作经历', '项目经历', '教育背景', '技能特长', '自我评价'])

    const work = resume.sections.find((section) => section.title === '工作经历')
    expect(work.items.length).toBeGreaterThanOrEqual(2)
    expect(work.items[0].time).toMatch(/2022/)
    expect(work.items[0].bullets.length).toBeGreaterThanOrEqual(1)
    expect(warnings).toEqual([])
  })
})
