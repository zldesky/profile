import { describe, expect, it } from 'vitest'

import {
  buildFillMessages,
  clipSource,
  normalizeFillResult,
  parseJsonReply,
  SOURCE_BUDGET,
} from '../src/utils/aiFill.ts'

/**
 * AI 补充导入的纯逻辑。
 *
 * 这里测的是两道「错填比不填更糟」的保险：
 *  1. 空值一律不写回 —— 模型没提取到时若产出空字符串，会把用户原有内容清空；
 *  2. 每项都带 id —— 纸面与编辑器都用 id 做 key，漏了会渲染异常。
 * 另外钉住提示词里的硬约束：不许编造、只输出 JSON。
 */
describe('来源文本裁剪', () => {
  it('折叠多余空行（PDF 提取常见大量空行，白占预算）', () => {
    expect(clipSource('甲\n\n\n\n乙')).toBe('甲\n\n乙')
    expect(clipSource('甲   \n乙')).toBe('甲\n乙')
  })

  it('超长时截断并标注，让模型知道自己看的是节选', () => {
    const long = '字'.repeat(SOURCE_BUDGET + 500)
    const out = clipSource(long)

    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain('节选')
  })

  it('不超预算时原样返回', () => {
    expect(clipSource('一份短简历')).toBe('一份短简历')
  })

  it('空输入不抛错', () => {
    expect(clipSource('')).toBe('')
    expect(clipSource(undefined)).toBe('')
  })
})

describe('解析模型回复', () => {
  it('直接是 JSON 时可用', () => {
    expect(parseJsonReply('{"name":"张三"}')).toEqual({ name: '张三' })
  })

  it('容忍 markdown 代码块', () => {
    expect(parseJsonReply('```json\n{"name":"张三"}\n```')).toEqual({ name: '张三' })
  })

  it('容忍前后缀解释文字', () => {
    expect(parseJsonReply('好的，结果如下：{"name":"张三"} 请核对')).toEqual({ name: '张三' })
  })

  it('完全解析不出时给出可读错误（而不是抛 JSON 原始报错）', () => {
    expect(() => parseJsonReply('抱歉，我无法完成')).toThrow(/没有返回可用的结果/)
  })

  it('JSON 损坏时给出可读错误', () => {
    expect(() => parseJsonReply('{"name":}')).toThrow(/JSON 格式有误/)
  })
})

describe('归一化：空值绝不写回（否则会清空用户原有内容）', () => {
  it('basics：空字符串字段被丢掉', () => {
    const out = normalizeFillResult({ name: '张三', jobTitle: '', fields: [] }, { kind: 'basics' })

    expect(out).toEqual({ name: '张三' })
    expect('jobTitle' in out).toBe(false)
    expect('fields' in out).toBe(false)
  })

  it('全空时返回空对象，调用方据此提示「没提取到」而不是写入空值', () => {
    expect(normalizeFillResult({}, { kind: 'basics' })).toEqual({})
    expect(normalizeFillResult({ name: '   ' }, { kind: 'basics' })).toEqual({})
  })

  it('grid：缺 label 或 value 的项被丢弃', () => {
    const out = normalizeFillResult(
      { items: [{ label: '城市', value: '上海' }, { label: '只有标签' }, { value: '只有内容' }] },
      { kind: 'section', sectionType: 'grid' },
    )

    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toMatchObject({ label: '城市', value: '上海' })
  })

  it('text：空白正文不写回', () => {
    expect(
      normalizeFillResult({ content: '  ' }, { kind: 'section', sectionType: 'text' }),
    ).toEqual({})
  })
})

describe('归一化：每项都带 id（漏了纸面 key 会重复）', () => {
  const hasId = (item) => typeof item.id === 'string' && item.id.length > 0

  it('basics 字段带 id', () => {
    const out = normalizeFillResult(
      { fields: [{ label: '电话', value: '138' }] },
      { kind: 'basics' },
    )

    expect(hasId(out.fields[0])).toBe(true)
  })

  it('grid 项带 id，并补上 icon', () => {
    const out = normalizeFillResult(
      { items: [{ label: '城市', value: '上海' }] },
      { kind: 'section', sectionType: 'grid' },
    )

    expect(hasId(out.items[0])).toBe(true)
    expect(out.items[0].icon).toBe('none')
  })

  it('经历条目、meta 与要点都带 id，且 id 互不相同', () => {
    const out = normalizeFillResult(
      {
        items: [
          {
            org: '某公司',
            role: '前端',
            meta: [{ label: '团队', value: '6 人' }],
            bullets: ['做了 A', '做了 B'],
          },
        ],
      },
      { kind: 'section', sectionType: 'entries' },
    )

    const entry = out.items[0]
    expect(hasId(entry)).toBe(true)
    expect(hasId(entry.meta[0])).toBe(true)
    expect(entry.bullets).toHaveLength(2)
    expect(entry.bullets.every(hasId)).toBe(true)

    const ids = [entry.id, entry.meta[0].id, ...entry.bullets.map((b) => b.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('技能项与技能字段都带 id', () => {
    const out = normalizeFillResult(
      { fields: [{ label: '语言', value: '中文' }], items: [{ name: 'TypeScript', level: 80 }] },
      { kind: 'section', sectionType: 'skills' },
    )

    expect(hasId(out.fields[0])).toBe(true)
    expect(hasId(out.items[0])).toBe(true)
  })
})

describe('归一化：条目的取舍与技能名', () => {
  it('没有任何实质内容的「经历」被丢弃（模型偶尔返回空壳对象）', () => {
    const out = normalizeFillResult(
      { items: [{}, { org: '有机构' }] },
      { kind: 'section', sectionType: 'entries' },
    )

    expect(out.items).toHaveLength(1)
    expect(out.items[0].org).toBe('有机构')
  })

  /*
   * 熟练度已整套移除，AI 填充也不再产出 level。
   * 这两条断言的要点是「模型多给了 level 也不该被采纳」——
   * 比单纯删掉旧用例更能防止它悄悄回潮。
   */
  it('只取技能名，模型多给的 level 一律不采纳', () => {
    const out = normalizeFillResult(
      {
        items: [{ name: 'A', level: 150 }, { name: 'B' }, { name: 'C', level: '很高' }],
      },
      { kind: 'section', sectionType: 'skills' },
    )

    expect(out.items.map((i) => i.name)).toEqual(['A', 'B', 'C'])
    // level 仍是数据模型里的字段（createSkill 会给默认值），
    // 但不能是模型给的那个值 —— 三个条目应当拿到同一个出厂默认
    expect(new Set(out.items.map((i) => i.level)).size).toBe(1)
  })

  it('空名字的技能条目被丢弃（模型偶尔返回空壳）', () => {
    const out = normalizeFillResult(
      { items: [{ name: '' }, { name: 'B' }] },
      { kind: 'section', sectionType: 'skills' },
    )

    expect(out.items).toHaveLength(1)
    expect(out.items[0].name).toBe('B')
  })

  it('要点允许写成字符串数组或 {text} 对象数组', () => {
    const out = normalizeFillResult(
      { items: [{ org: 'X', bullets: ['纯字符串', { text: '对象形式' }] }] },
      { kind: 'section', sectionType: 'entries' },
    )

    expect(out.items[0].bullets.map((b) => b.text)).toEqual(['纯字符串', '对象形式'])
  })
})

describe('提示词', () => {
  const text = (messages) => messages.map((m) => m.content).join('\n')

  it('包含目标位置的 JSON 结构说明（否则写回无从下手）', () => {
    const entries = buildFillMessages('原文', { kind: 'section', sectionType: 'entries' })

    expect(text(entries)).toContain('"items"')
    expect(text(entries)).toContain('bullets')
  })

  it('明确禁止编造（简历上的假经历是灾难）', () => {
    for (const type of ['grid', 'entries', 'skills', 'text']) {
      const out = text(buildFillMessages('原文', { kind: 'section', sectionType: type }))

      expect(out).toContain('不要编造')
    }
  })

  it('要求只输出 JSON，不要代码块与解释', () => {
    const out = text(buildFillMessages('原文', { kind: 'basics' }))

    expect(out).toContain('只输出一个 JSON 对象')
  })

  it('带上了目标模块标题，模型据此判断相关性', () => {
    const out = text(
      buildFillMessages('原文', {
        kind: 'section',
        sectionType: 'entries',
        sectionTitle: '实习经历',
      }),
    )

    expect(out).toContain('实习经历')
  })

  it('用户提示词与原文都进了消息', () => {
    const out = text(buildFillMessages('这里是原文', { kind: 'basics' }, '只取最近两段'))

    expect(out).toContain('只取最近两段')
    expect(out).toContain('这里是原文')
  })

  it('没给提示词时也有一句兜底，不留空白让模型自行发挥', () => {
    const out = text(buildFillMessages('原文', { kind: 'basics' }))

    expect(out).toContain('未给额外要求')
  })
})
