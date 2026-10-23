import { describe, expect, it } from 'vitest'

import {
  DUPLICATE_THRESHOLD,
  analyzeBullet,
  analyzeEntry,
  charCount,
  formatTimeRange,
  monthIndex,
  parseTimeRange,
  rangesOverlap,
  similarity,
} from '@/utils/expression'

/** 取某一类发现 */
const ruleIds = (text, ctx) => analyzeBullet(text, ctx).map((f) => f.ruleId)
const has = (text, ruleId, ctx) => ruleIds(text, ctx).includes(ruleId)

describe('charCount', () => {
  it('不计空白，数字与英文各算一个', () => {
    // "Vue 3 构建" 去掉空白 = V,u,e,3,构,建 → 6
    expect(charCount('  Vue 3 构建  ')).toBe(6)
    expect(charCount('')).toBe(0)
    expect(charCount(null)).toBe(0)
  })
})

describe('analyzeBullet · 空与非文本输入', () => {
  it('空内容不报任何问题（空模块由 completeness 负责，不重复报）', () => {
    expect(analyzeBullet('')).toEqual([])
    expect(analyzeBullet('   ')).toEqual([])
    expect(analyzeBullet(null)).toEqual([])
    expect(analyzeBullet(undefined)).toEqual([])
  })

  it('纯标点不报', () => {
    expect(analyzeBullet('，。；')).toEqual([])
  })
})

describe('analyzeBullet · 弱动词与主语', () => {
  it('「负责」报 verb.weak，并给出多个可替换候选', () => {
    const found = analyzeBullet('负责后台管理系统的开发与维护')
    const weak = found.find((f) => f.ruleId === 'verb.weak')
    expect(weak).toBeTruthy()
    // 三个候选而不是一个：改成「主导」而事实只是「配合」，那是替用户撒谎
    expect(weak.replacements.filter((r) => r.from === '负责').length).toBeGreaterThanOrEqual(2)
  })

  it('命中片段落在原文里，能定位到具体位置', () => {
    const text = '负责后台系统'
    const weak = analyzeBullet(text).find((f) => f.ruleId === 'verb.weak')
    const span = weak.spans[0]
    expect(text.slice(span.start, span.end)).toBe('负责')
  })

  it('第一人称报 verb.pronoun', () => {
    expect(has('我们团队完成了支付重构', 'verb.pronoun')).toBe(true)
    expect(has('本人主导了三次架构升级', 'verb.pronoun')).toBe(true)
  })

  it('教育经历的「标签：内容」句式不报弱动词', () => {
    const ctx = { entryKind: 'education' }
    // 这行本身没有弱动词，但也不该因为「不是动作句」被别的规则误伤
    expect(ruleIds('主修课程：数据结构、计算机网络', ctx)).not.toContain('verb.weak')
  })

  it('工作经历里同样的弱动词照常报', () => {
    expect(has('负责支付网关的日常维护', 'verb.weak', { entryKind: 'work' })).toBe(true)
  })
})

describe('analyzeBullet · 量化', () => {
  it('没有数字报 quantify.missing', () => {
    expect(has('优化了构建流程并推动落地', 'quantify.missing')).toBe(true)
  })

  it('有数字但没有对比词，报 no-baseline 而不是 missing', () => {
    const ids = ruleIds('服务 3000 个用户')
    expect(ids).toContain('quantify.no-baseline')
    expect(ids).not.toContain('quantify.missing')
  })

  it('「从 A 到 B」这类对比结构不报 no-baseline', () => {
    const ids = ruleIds('把构建耗时从 8 分钟降到 90 秒')
    expect(ids).not.toContain('quantify.no-baseline')
    expect(ids).not.toContain('quantify.missing')
  })

  it('提升/下降/倍 都算对比词', () => {
    expect(has('接口错误率下降 76%', 'quantify.no-baseline')).toBe(false)
    expect(has('订单量增长 3 倍', 'quantify.no-baseline')).toBe(false)
  })

  it('含糊程度词在没有数字时报', () => {
    expect(has('显著提升了团队效率', 'quantify.vague-scale')).toBe(true)
  })

  it('带数字时「明显下降 30%」不再报含糊', () => {
    expect(has('订单处理时长明显下降 30%', 'quantify.vague-scale')).toBe(false)
  })

  it('自我评价式形容词报 tip', () => {
    expect(has('精通前端工程化', 'quantify.self-praise')).toBe(true)
    expect(has('具备出色的沟通能力', 'quantify.self-praise')).toBe(true)
  })
})

describe('analyzeBullet · 词汇', () => {
  it('模板黑话优先报', () => {
    expect(has('通过数据赋能业务闭环', 'lexicon.buzzword')).toBe(true)
  })

  it('英文缩写与版本号不会被误判', () => {
    // 真实写法的技术简历要点，不应命中任何词汇规则
    const ids = ruleIds('主导 Vue3 + Vite 迁移，首屏 LCP 从 3.2s 降到 1.4s')
    expect(ids).not.toContain('lexicon.buzzword')
    expect(ids).not.toContain('quantify.self-praise')
    expect(ids).not.toContain('quantify.missing')
  })
})

describe('analyzeBullet · 结构', () => {
  it('超过 80 字报 too-long', () => {
    const long = '负责'.repeat(50)
    expect(has(long, 'structure.too-long')).toBe(true)
  })

  it('太短且没有数字报 too-short', () => {
    expect(has('负责前端', 'structure.too-short')).toBe(true)
  })

  it('短但有数字不报 too-short（数字本身就是信息）', () => {
    expect(has('降本 30%', 'structure.too-short')).toBe(false)
  })

  it('最多报 3 条，且严重的排前面', () => {
    const text = '我们负责明显赋能团队，非常优秀，服务很多客户'
    const found = analyzeBullet(text)
    expect(found.length).toBeLessThanOrEqual(3)
    const order = found.map((f) => f.level)
    const rank = { error: 0, warn: 1, tip: 2 }
    expect(order).toEqual([...order].sort((a, b) => rank[a] - rank[b]))
  })
})

describe('analyzeBullet · 重复', () => {
  it('同段两条几乎一样时报 duplicate', () => {
    const a = '主导支付链路重构，失败率从 2% 降到 0.3%'
    const b = '主导支付链路重构，失败率从 2% 降至 0.3%'
    expect(analyzeBullet(b, { siblings: [a] }).map((f) => f.ruleId)).toContain(
      'structure.duplicate',
    )
  })

  it('相似的两件事但不相同，不报', () => {
    const a = '主导支付链路重构，失败率从 2% 降到 0.3%'
    const b = '主导会员体系改版，付费转化率提升 12%'
    expect(analyzeBullet(b, { siblings: [a] }).map((f) => f.ruleId)).not.toContain(
      'structure.duplicate',
    )
  })

  it('siblings 为空或未传时不报重复', () => {
    expect(analyzeBullet('主导支付重构').map((f) => f.ruleId)).not.toContain('structure.duplicate')
    expect(analyzeBullet('主导支付重构', { siblings: [] }).map((f) => f.ruleId)).not.toContain(
      'structure.duplicate',
    )
  })
})

describe('similarity', () => {
  it('完全相同为 1，完全不同为 0', () => {
    expect(similarity('主导支付重构', '主导支付重构')).toBe(1)
    expect(similarity('主导支付重构', '')).toBe(0)
    expect(similarity('abc', 'xyz')).toBe(0)
  })

  it('忽略空白与全半角差异', () => {
    expect(similarity('主导 支付 重构', '主导支付重构')).toBe(1)
  })

  it('阈值与实现一致，边界处可预期', () => {
    /*
     * 10 字删掉 1 字，相似度是 0.9 —— 高于 0.85，会被判成重复。
     * 原先这条断言写反了（以为 0.9 < 0.85），是测试写错而不是实现错。
     * 留着这条是为了把「阈值到底判多严」变成可读的数字：删一个字就算重复，
     * 删两个字（0.8）就不算。
     */
    const a = '一二三四五六七八九十'
    expect(similarity(a, '一二三四五六七八九')).toBeCloseTo(9 / 10)
    expect(similarity(a, '一二三四五六七八')).toBeCloseTo(8 / 10)
    expect(9 / 10).toBeGreaterThan(DUPLICATE_THRESHOLD)
    expect(8 / 10).toBeLessThan(DUPLICATE_THRESHOLD)
  })
})

describe('analyzeEntry', () => {
  it('逐条检查并把同段其它要点当作 siblings', () => {
    const texts = ['主导支付重构，失败率从 2% 降到 0.3%', '主导支付重构，失败率从 2% 降到 0.3%']
    const [first, second] = analyzeEntry(texts, { entryKind: 'work' })
    expect(first.map((f) => f.ruleId)).toContain('structure.duplicate')
    expect(second.map((f) => f.ruleId)).toContain('structure.duplicate')
  })

  it('逐字完全相同的两条也要报重复（回归：曾被自己的「排除自身」逻辑吃掉）', () => {
    /*
     * 这条是回归断言。原实现用 `norm(other) !== norm(raw)` 排除自身，
     * 但 norm 会把全角标点转半角，导致两条一模一样的要点被当成「自己」跳过 ——
     * 最该报的完全重复，恰好是唯一漏掉的情况。正解是按索引排除，见 analyzeEntry。
     */
    const same = '主导支付重构，失败率从 2% 降到 0.3%'
    const [first, second] = analyzeEntry([same, same], { entryKind: 'work' })
    expect(first.map((f) => f.ruleId)).toContain('structure.duplicate')
    expect(second.map((f) => f.ruleId)).toContain('structure.duplicate')
  })

  it('不把要点自己和自己比', () => {
    const [only] = analyzeEntry(['主导支付重构，失败率从 2% 降到 0.3%'])
    expect(only.map((f) => f.ruleId)).not.toContain('structure.duplicate')
  })

  it('空数组返回空数组，非数组输入也安全', () => {
    expect(analyzeEntry([])).toEqual([])
    expect(analyzeEntry(null)).toEqual([])
  })
})

describe('parseTimeRange', () => {
  it('识别常见的四种写法', () => {
    expect(parseTimeRange('2022-06 - 至今')).toMatchObject({
      start: { year: 2022, month: 6 },
      ongoing: true,
    })
    expect(parseTimeRange('2022.6 ~ 2023.11')).toMatchObject({
      start: { year: 2022, month: 6 },
      end: { year: 2023, month: 11 },
    })
    expect(parseTimeRange('2022年6月—2023年11月')).toMatchObject({
      start: { year: 2022, month: 6 },
      end: { year: 2023, month: 11 },
    })
    expect(parseTimeRange('2019-07 - 2022-05')).toMatchObject({
      start: { year: 2019, month: 7 },
      end: { year: 2022, month: 5 },
    })
  })

  it('只有年份时用整年近似', () => {
    expect(parseTimeRange('2022 - 2024')).toMatchObject({
      start: { year: 2022, month: 1 },
      end: { year: 2024, month: 12 },
    })
  })

  it('只有年份且「至今」', () => {
    expect(parseTimeRange('2023 - 至今')).toMatchObject({ start: { year: 2023 }, ongoing: true })
  })

  it('解析不出来返回 null，绝不猜', () => {
    expect(parseTimeRange('')).toBeNull()
    expect(parseTimeRange('大学期间')).toBeNull()
    expect(parseTimeRange(null)).toBeNull()
  })
})

describe('rangesOverlap', () => {
  const range = (text) => parseTimeRange(text)

  it('同年段重叠', () => {
    expect(rangesOverlap(range('2022-01 - 2023-01'), range('2022-06 - 2023-06'))).toBe(true)
  })

  it('完全不重叠', () => {
    expect(rangesOverlap(range('2019-01 - 2020-01'), range('2021-01 - 2022-01'))).toBe(false)
  })

  it('同月交接不算重叠（换工作是常态）', () => {
    expect(rangesOverlap(range('2019-01 - 2022-01'), range('2022-01 - 2023-01'))).toBe(false)
  })

  it('「至今」视为无限远，会与后续区间重叠', () => {
    expect(rangesOverlap(range('2022-01 - 至今'), range('2023-01 - 2024-01'))).toBe(true)
  })

  it('包含关系算重叠', () => {
    expect(rangesOverlap(range('2018-01 - 2024-01'), range('2020-01 - 2021-01'))).toBe(true)
  })
})

describe('formatTimeRange / monthIndex', () => {
  it('归一成统一写法', () => {
    expect(formatTimeRange(parseTimeRange('2022年6月 - 至今'), '')).toBe('2022-06 - 至今')
    expect(formatTimeRange(parseTimeRange('2019.7-2022.5'), '')).toBe('2019-07 - 2022-05')
  })

  it('解析不出来时原样返回，绝不改写用户的自由输入', () => {
    expect(formatTimeRange(null, '大学期间')).toBe('大学期间')
  })

  it('monthIndex 可比较', () => {
    expect(monthIndex({ year: 2022, month: 1 })).toBeLessThan(monthIndex({ year: 2022, month: 2 }))
    expect(monthIndex({ year: 2022, month: 12 })).toBe(monthIndex({ year: 2023, month: 1 }) - 1)
  })
})
