import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildResumeFromLines, extractPdfLines } from '../src/utils/pdfImport.ts'

/**
 * 端到端集成测试：用编辑器渲染服务产出的真实矢量 PDF（tests/fixtures/），
 * 走完 pdf.js 提取 + 启发式解析全链路。
 *
 * fixture：tests/fixtures/resume-sample.pdf（单页，Chromium/Skia 渲染的矢量 PDF，
 * 内容是「林致远 · 前端开发工程师」的固定简历）。它是二进制产物，必须入库：
 * 本测试直接 readFileSync，文件缺失时会立刻失败，而 CI 的 Test 步骤在 Build 之前跑，
 * 生成脚本依赖运行中的渲染服务、对 CI 不可用。
 *
 * 重新生成：用渲染服务导出同名文件后覆盖（内容变了要同步改下面的断言）。
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
