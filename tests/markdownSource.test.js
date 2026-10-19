import { describe, expect, it } from 'vitest'

import { normalizeResume } from '@/data/normalizeResume'
import { createResume } from '@/data/defaultResume'
import { resumeToMarkdown } from '@/utils/exporters'
import { markdownToResume, resumeToSourceMarkdown } from '@/utils/markdownSource'

/**
 * Markdown 作为一等内容源的往返测试。
 *
 * 这一组断言的是**这次改动的核心承诺**：把简历写成 Markdown、再读回来，内容不变。
 * 所以断言的是「内容形状」（模块类型 / 标题 / 条目 / 要点 / 字段），
 * 而不是逐字节相等 —— 主题、模板、布局、id 本来就不在 Markdown 里（见模块头部说明）。
 */

/** 抽出「内容形状」，忽略 id / 主题 / 布局这些不往返的东西 */
function shape(resume) {
  return {
    name: resume.basics.name,
    jobTitle: resume.basics.jobTitle,
    fields: (resume.basics.fields || []).map((f) => ({ label: f.label, value: f.value })),
    sections: resume.sections.map((s) => {
      const base = { type: s.type, title: s.title }
      if (s.type === 'entries') {
        return {
          ...base,
          items: s.items.map((e) => ({
            org: e.org,
            role: e.role,
            time: e.time,
            meta: e.meta.map((m) => ({ label: m.label, value: m.value })),
            bullets: e.bullets.map((b) => b.text),
          })),
        }
      }
      if (s.type === 'grid') {
        return { ...base, items: s.items.map((i) => ({ label: i.label, value: i.value })) }
      }
      if (s.type === 'skills') {
        return {
          ...base,
          fields: s.fields.map((f) => ({ label: f.label, value: f.value })),
          items: s.items.map((i) => i.name),
        }
      }
      return { ...base, content: s.content }
    }),
  }
}

/** Markdown → 归一化后的简历 */
const roundTrip = (md) => normalizeResume(markdownToResume(md))

describe('往返：简历 → Markdown → 简历', () => {
  it('默认简历的模块类型、条目、要点与字段全部保持', () => {
    const original = createResume()
    const back = roundTrip(resumeToSourceMarkdown(original))

    expect(shape(back)).toEqual(shape(original))
  })

  it('四种模块类型都被保留（不靠猜）', () => {
    const types = roundTrip(resumeToSourceMarkdown(createResume())).sections.map((s) => s.type)

    expect(new Set(types)).toEqual(new Set(['grid', 'entries', 'skills', 'text']))
  })

  it('带中文冒号的要点不会被误判成补充字段', () => {
    // 默认简历的教育背景里就有这么一条：「主修课程：数据结构、计算机网络…」
    const original = createResume()
    const target = original.sections
      .filter((s) => s.type === 'entries')
      .flatMap((s) => s.items)
      .flatMap((e) => e.bullets)
      .find((b) => b.text.includes('：'))
    expect(target, '夹具里应当有一条带中文冒号的要点，否则这条用例没意义').toBeTruthy()

    const back = roundTrip(resumeToSourceMarkdown(original))
    const allBullets = back.sections
      .filter((s) => s.type === 'entries')
      .flatMap((s) => s.items)
      .flatMap((e) => e.bullets)
      .map((b) => b.text)

    expect(allBullets).toContain(target.text)
  })

  it('隐藏模块不写进 Markdown，因此也不会被读回来', () => {
    const original = createResume()
    original.sections[0].visible = false

    const md = resumeToSourceMarkdown(original)
    const back = roundTrip(md)

    expect(md).not.toContain(original.sections[0].title)
    expect(back.sections.map((s) => s.title)).not.toContain(original.sections[0].title)
  })
})

describe('类型提示：精确模式', () => {
  it('每个模块标题后都跟着一行类型提示', () => {
    const md = resumeToSourceMarkdown(createResume())

    expect(md).toContain('<!-- resume:type=grid -->')
    expect(md).toContain('<!-- resume:type=entries -->')
    expect(md).toContain('<!-- resume:type=skills -->')
    expect(md).toContain('<!-- resume:type=text -->')
  })

  it('与既有的 ATS 导出**只差两处**：类型提示行、键值行标签的加粗', () => {
    const resume = createResume()

    /*
     * 这条钉住两套输出的关系，防止它们各自漂移成两种方言：
     *  1. 类型提示那类 `<!-- resume:type=… -->` 行（ATS 版没有）；
     *  2. 键值行的标签加粗（ATS 版是 `- 标签：值`，内容源版是 `- **标签**：值`）——
     *     加粗是无歧义标记，用来把「带冒号的要点」和「补充字段」分开，见模块头部说明。
     * 除这两处之外必须逐字相同。
     */
    const normalize = (md) =>
      md.replace(/^<!-- resume:type=\w+ -->\n/gm, '').replace(/^- \*\*(.+?)\*\*：/gm, '- $1：')

    expect(normalize(resumeToSourceMarkdown(resume))).toBe(resumeToMarkdown(resume))
  })

  it('没有提示时按键值处理带冒号的列表项（兼容手写，与精确模式有别）', () => {
    const md = [
      '# 某人',
      '',
      '## 工作经历',
      '',
      '### 某公司 · 工程师',
      '2020 - 2021',
      '- 重构了构建流程：耗时降 90%',
      '',
    ].join('\n')

    const section = roundTrip(md).sections[0]
    expect(section.type).toBe('entries')
    // 无提示 → 走兼容惯例，这条被当成补充字段（这是有意的取舍，文档已写明）
    expect(section.items[0].meta.map((m) => m.label)).toEqual(['重构了构建流程'])
    expect(section.items[0].bullets).toEqual([])
  })

  it('有提示时同一条内容是「要点」而不是补充字段', () => {
    const md = [
      '# 某人',
      '',
      '## 工作经历',
      '<!-- resume:type=entries -->',
      '',
      '### 某公司 · 工程师',
      '2020 - 2021',
      '- 重构了构建流程：耗时降 90%',
      '',
    ].join('\n')

    const section = roundTrip(md).sections[0]
    expect(section.items[0].meta).toEqual([])
    expect(section.items[0].bullets.map((b) => b.text)).toEqual(['重构了构建流程：耗时降 90%'])
  })
})

describe('兼容手写：无类型提示时按内容猜模块', () => {
  it('三级标题 → entries；纯键值 → grid；键值+裸列表 → skills；纯段落 → text', () => {
    const md = [
      '# 张三',
      '**后端工程师**',
      '- **电话**：13800000000',
      '',
      '## 求职意向',
      '- **城市**：上海',
      '',
      '## 工作经历',
      '### A 公司 · 开发',
      '2021 - 2023',
      '- 做了些事',
      '',
      '## 技能',
      '- **语言**：Python',
      '- 分布式系统',
      '',
      '## 自我评价',
      '踏实，喜欢把事做完。',
      '',
    ].join('\n')

    const resume = roundTrip(md)
    expect(resume.basics.name).toBe('张三')
    expect(resume.basics.jobTitle).toBe('后端工程师')
    expect(resume.basics.fields.map((f) => f.label)).toEqual(['电话'])

    const byTitle = Object.fromEntries(resume.sections.map((s) => [s.title, s.type]))
    expect(byTitle['求职意向']).toBe('grid')
    expect(byTitle['工作经历']).toBe('entries')
    expect(byTitle['技能']).toBe('skills')
    expect(byTitle['自我评价']).toBe('text')

    const skills = resume.sections.find((s) => s.title === '技能')
    expect(skills.fields.map((f) => f.value)).toEqual(['Python'])
    expect(skills.items.map((i) => i.name)).toEqual(['分布式系统'])
  })

  it('条目里机构与职位用「 · 」拆开，没有分隔符时整串当机构', () => {
    const md = ['## 经历', '### 只有机构', '', '### A 公司 · 职位', ''].join('\n')

    const items = roundTrip(md).sections[0].items
    expect(items[0]).toMatchObject({ org: '只有机构', role: '' })
    expect(items[1]).toMatchObject({ org: 'A 公司', role: '职位' })
  })

  it('LapisCV 式的头像 <img alt="avatar"> 被识别', () => {
    const md = [
      '# 李四',
      '<img alt="avatar" src="https://example.com/a.png">',
      '',
      '## 自我评价',
      '一段话',
      '',
    ].join('\n')

    const resume = roundTrip(md)
    expect(resume.basics.avatar).toBe('https://example.com/a.png')
    expect(resume.basics.showAvatar).toBe(true)
  })

  it('分隔线（LapisCV 用它标记分页）被跳过，不污染内容', () => {
    const md = ['# 王五', '', '## 自我评价', '第一页内容', '', '---', '', '第二页内容', ''].join(
      '\n',
    )

    const resume = roundTrip(md)
    expect(resume.sections[0].type).toBe('text')
    expect(resume.sections[0].content).toBe('第一页内容\n第二页内容')
  })
})

describe('宽容性：残缺输入不抛错', () => {
  /*
   * 这两条断言在**草稿**上，而不是归一化之后。
   * 原因：normalizeResume 对「没有模块」的输入会**有意**补上默认的 6 个模块
   * （见它的 `sections.length ? ... : base.sections`），这是编辑器空态的既有行为。
   * 所以「导入一份空 Markdown」的结果是拿到默认简历，而不是把简历清空 ——
   * 这个语义值得写清楚，否则很容易被误解成 bug。
   */
  it('空字符串产出空草稿，而不是抛错', () => {
    const draft = markdownToResume('')
    expect(draft.basics.name).toBe('')
    expect(draft.sections).toEqual([])
  })

  it('只有姓名、没有模块时草稿里也就没有模块', () => {
    const draft = markdownToResume('# 只有名字\n')
    expect(draft.basics.name).toBe('只有名字')
    expect(draft.sections).toEqual([])
  })

  it('而没有模块的草稿交给 normalizeResume 后，会补上默认模块（有意的既有行为）', () => {
    const resume = normalizeResume(markdownToResume(''))
    expect(resume.sections.length).toBeGreaterThan(0)
  })

  it('条目正文里的续行会并进上一条要点，而不是丢掉', () => {
    const md = ['## 经历', '### A · B', '- 第一行', '第二行续写', ''].join('\n')

    const bullets = roundTrip(md).sections[0].items[0].bullets
    expect(bullets.map((b) => b.text)).toEqual(['第一行 第二行续写'])
  })

  it('三级标题之前的孤立正文不会造出一个空机构条目', () => {
    const md = ['## 经历', '这段文字在条目之前', '', '### A · B', '- 要点', ''].join('\n')

    const items = roundTrip(md).sections[0].items
    expect(items).toHaveLength(1)
    expect(items[0].org).toBe('A')
  })
})
