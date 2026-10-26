import { describe, expect, it } from 'vitest'

import {
  BULLET_TEMPLATES,
  CITY_TIERS,
  DIRECTIONS,
  MARKET_AS_OF,
  SECTION_HINTS,
  TRACKS,
  applyBlueprintToResume,
  buildBlueprint,
  bulletTemplatesFor,
  cityTierFactor,
  describeBlueprint,
  directionByKey,
  intentItems,
  salaryHint,
  trackByKey,
} from '../src/data/resumeBlueprint.ts'
import { createResume } from '../src/data/defaultResume.ts'

/**
 * 简历骨架蓝图。
 *
 * 这一组断言守的是「结构规则」，而不是措辞：
 *  - 社招必须工作经历在前、校招必须教育背景在前（这是四条线唯一真正的差别）；
 *  - **不许生成看起来完整的假内容**（占位符必须真的带【】）；
 *  - 薪资区间必须随类型与城市变化，而不是写死一个数。
 *
 * 为什么值得写：这些规则一旦漂移，用户会拿到一份「结构就不对」的简历，
 * 而界面上看起来一切正常 —— 不报错，只是投出去没人回。
 */

describe('求职类型（Track）', () => {
  it('四条线都在，且 key 唯一', () => {
    const keys = TRACKS.map((t) => t.key)
    expect(keys).toEqual(['social', 'campus', 'intern', 'other'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('社招：工作经历紧跟求职意向，教育背景靠后', () => {
    const order = trackByKey('social').order
    expect(order[0]).toBe('intent')
    expect(order[1]).toBe('work')
    // 教育背景不该排在项目之前 —— 工作多年的人，学校已不是决定因素
    expect(order.indexOf('edu')).toBeGreaterThan(order.indexOf('work'))
    expect(order.indexOf('edu')).toBeGreaterThan(order.indexOf('project'))
  })

  it('校招：教育背景必须排在任何经历之前', () => {
    const order = trackByKey('campus').order
    expect(order[0]).toBe('intent')
    expect(order[1]).toBe('edu')
    expect(order.indexOf('edu')).toBeLessThan(order.indexOf('intern'))
    expect(order.indexOf('edu')).toBeLessThan(order.indexOf('project'))
  })

  it('实习：教育背景第一，且不包含「工作经历」这种与在校生不符的模块', () => {
    const order = trackByKey('intern').order
    expect(order[1]).toBe('edu')
    // 在校生没有正式工作经历，放一个空的「工作经历」只会暴露空窗
    expect(order).not.toContain('work')
    expect(order).toContain('campus')
  })

  it('其他（转行等）：项目与技能排在雇佣经历之前', () => {
    const order = trackByKey('other').order
    expect(order.indexOf('project')).toBeLessThan(order.indexOf('work'))
    expect(order.indexOf('skill')).toBeLessThan(order.indexOf('work'))
  })

  it('未知 key 退回社招，而不是抛错', () => {
    expect(trackByKey('不存在').key).toBe('social')
    expect(trackByKey('').key).toBe('social')
  })

  it('每条线都有一句「最该被看到什么」的说明', () => {
    for (const track of TRACKS) {
      expect(track.emphasis.length, `${track.key} 缺少 emphasis`).toBeGreaterThan(10)
    }
  })
})

describe('方向与薪资', () => {
  it('方向 key 唯一，且都有一个兜底项', () => {
    const keys = DIRECTIONS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('other')
    expect(directionByKey('不存在').key).toBe('other')
  })

  it('每个技术方向都有可用的关键词（技能模块靠它起底）', () => {
    for (const dir of DIRECTIONS) {
      if (dir.key === 'other') continue
      expect(dir.keywords.length, `${dir.key} 没有关键词`).toBeGreaterThanOrEqual(3)
    }
  })

  it('薪资区间随求职类型变化：校招低于社招', () => {
    const social = salaryHint({ track: 'social', direction: 'frontend' })
    const campus = salaryHint({ track: 'campus', direction: 'frontend' })
    // 取区间下界比较：数字化的比较比字符串更可靠
    const lower = (text) => Number(text.split('-')[0].replace(/[^\d.]/g, ''))
    expect(lower(campus)).toBeLessThan(lower(social))
  })

  it('实习按日薪写，而不是按月薪', () => {
    const hint = salaryHint({ track: 'intern', direction: 'frontend' })
    // 实习本来就是按天谈的，写成月薪会误导
    expect(hint).toContain('元/天')
  })

  it('城市档位影响区间：一线高于其他城市', () => {
    const tier1 = salaryHint({ track: 'social', direction: 'frontend', cityTier: 'tier1' })
    const other = salaryHint({ track: 'social', direction: 'frontend', cityTier: 'other' })
    const lower = (text) => Number(text.split('-')[0].replace(/[^\d.]/g, ''))
    expect(lower(other)).toBeLessThan(lower(tier1))
  })

  it('城市系数单调递减，且一线为 1', () => {
    expect(cityTierFactor('tier1')).toBe(1)
    expect(cityTierFactor('tier2')).toBeLessThan(1)
    expect(cityTierFactor('other')).toBeLessThan(cityTierFactor('tier2'))
    // 未知档位按一线处理，不能让薪资变成 0
    expect(cityTierFactor('不存在')).toBe(1)
  })

  it('三档城市都有中文说明', () => {
    for (const tier of CITY_TIERS) expect(tier.label.length).toBeGreaterThan(1)
  })
})

describe('buildBlueprint：结构与顺序', () => {
  it('模块顺序与所选求职类型一致', () => {
    const blueprint = buildBlueprint({ track: 'campus', direction: 'backend' })
    const titles = blueprint.sections.map((s) => s.title)
    expect(titles[0]).toBe('求职意向')
    expect(titles[1]).toBe('教育背景')
  })

  it('社招生成的第一个经历模块是工作经历', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    const titles = blueprint.sections.map((s) => s.title)
    expect(titles).toContain('工作经历')
    expect(titles.indexOf('工作经历')).toBeLessThan(titles.indexOf('教育背景'))
  })

  it('求职意向四个字段都填上了值（不留空字段）', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    const intent = blueprint.sections.find((s) => s.title === '求职意向')
    expect(intent.type).toBe('grid')
    expect(intent.items).toHaveLength(4)
    for (const item of intent.items) {
      expect(item.value.trim(), `「${item.label}」是空的`).not.toBe('')
    }
  })

  it('求职意向里的岗位名与该方向一致', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'backend' })
    expect(blueprint.intent.jobTitle).toBe('后端开发')
  })

  it('自定义城市会写进求职意向', () => {
    const blueprint = buildBlueprint({
      track: 'social',
      direction: 'frontend',
      city: '杭州 / 上海',
    })
    expect(blueprint.intent.city).toBe('杭州 / 上海')
  })

  it('没填城市时留占位符，而不是留空', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    expect(blueprint.intent.city).toContain('【')
  })

  it('技能模块用该方向的关键词起底（而不是空列表）', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'backend' })
    const skills = blueprint.sections.find((s) => s.type === 'skills')
    expect(skills.items.length).toBeGreaterThanOrEqual(3)
    expect(skills.items.map((i) => i.name).join(' ')).toContain('Redis')
  })

  it('每个模块的提示文案都覆盖到了（不留空提示）', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    for (const item of blueprint.hints) {
      expect(item.hint, `「${item.title}」没有提示文案`).not.toBe('')
    }
  })

  it('带出行情基线日期，供界面如实标注', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    expect(blueprint.marketAsOf).toBe(MARKET_AS_OF)
    expect(blueprint.marketAsOf).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('buildBlueprint：不许生成假内容', () => {
  it('每条经历只留一条带占位符的要点模板', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    const work = blueprint.sections.find((s) => s.title === '工作经历')
    expect(work.type).toBe('entries')
    expect(work.items).toHaveLength(1)
    expect(work.items[0].bullets).toHaveLength(1)
    // 关键：模板必须带【】，否则用户会以为那是已经写好的内容
    expect(work.items[0].bullets[0].text).toContain('【')
  })

  it('经历的时间 / 机构 / 岗位都是空的（不编造公司名）', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    const work = blueprint.sections.find((s) => s.title === '工作经历')
    expect(work.items[0].org).toBe('')
    expect(work.items[0].time).toBe('')
    expect(work.items[0].role).toBe('')
  })

  it('荣誉奖项给的是格式示例，不是具体奖项', () => {
    const blueprint = buildBlueprint({ track: 'campus', direction: 'algorithm' })
    const honor = blueprint.sections.find((s) => s.title === '荣誉奖项')
    if (!honor) return
    expect(honor.items[0].value).toContain('【')
  })

  it('所有要点模板都带占位符（否则会被当成真内容）', () => {
    for (const [track, templates] of Object.entries(BULLET_TEMPLATES)) {
      expect(templates.length, `${track} 没有模板`).toBeGreaterThan(0)
      for (const text of templates) {
        expect(text, `${track} 的模板缺少占位符：${text}`).toContain('【')
      }
    }
  })

  it('没有哪个模块会生成「看起来完整」的示例姓名或公司', () => {
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    const text = JSON.stringify(blueprint.sections)
    // 默认简历里的示例公司名绝不能出现在蓝图里
    expect(text).not.toContain('某某科技')
    expect(text).not.toContain('某某大学')
  })
})

describe('applyBlueprintToResume', () => {
  it('替换模块但保留模板与主题（用户调过的配色不该被重置）', () => {
    const base = createResume()
    base.template = 'sidebar'
    base.theme.accent = '#123456'
    const blueprint = buildBlueprint({ track: 'campus', direction: 'backend' })

    const next = applyBlueprintToResume(base, blueprint)
    expect(next.template).toBe('sidebar')
    expect(next.theme.accent).toBe('#123456')
    expect(next.sections).toHaveLength(blueprint.sections.length)
  })

  it('基本信息里的求职职位跟随意向岗位（避免纸面两处说法不一致）', () => {
    const base = createResume()
    const blueprint = buildBlueprint({ track: 'social', direction: 'design' })
    const next = applyBlueprintToResume(base, blueprint)
    expect(next.basics.jobTitle).toBe('设计（UI / UX）')
  })

  it('重新分配模块 id，不与原简历冲突（否则渲染 key 重复）', () => {
    const base = createResume()
    const blueprint = buildBlueprint({ track: 'social', direction: 'frontend' })
    const next = applyBlueprintToResume(base, blueprint)

    const ids = next.sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 不能与蓝图原件共用同一个 id，否则两次套用会撞
    const originalIds = blueprint.sections.map((s) => s.id)
    expect(ids.some((id) => originalIds.includes(id))).toBe(false)
  })

  it('不改动传入的 base 对象（纯函数）', () => {
    const base = createResume()
    const before = JSON.stringify(base.sections.map((s) => s.title))
    applyBlueprintToResume(base, buildBlueprint({ track: 'campus', direction: 'backend' }))
    expect(JSON.stringify(base.sections.map((s) => s.title))).toBe(before)
  })
})

describe('展示辅助', () => {
  it('describeBlueprint 拼出一行可读摘要', () => {
    const text = describeBlueprint({ track: 'campus', direction: 'frontend', cityTier: 'tier2' })
    expect(text).toContain('校招')
    expect(text).toContain('前端开发')
    expect(text).toContain('新一线')
  })

  it('bulletTemplatesFor 对未知类型退回社招模板，不返回空数组', () => {
    expect(bulletTemplatesFor('不存在').length).toBeGreaterThan(0)
    expect(bulletTemplatesFor('campus').length).toBeGreaterThan(0)
  })

  it('intentItems 摊平成四个 GridItem，图标都在白名单内', () => {
    const items = intentItems({
      jobTitle: '前端开发工程师',
      city: '上海',
      salary: '25K-35K',
      availability: '一个月内',
    })
    expect(items).toHaveLength(4)
    expect(items.map((i) => i.icon)).toEqual(['briefcase', 'location', 'coin', 'clock'])
  })

  it('每个预设模块都有填写提示（新增模块时不会漏）', () => {
    const presetKeys = [
      'intent',
      'work',
      'intern',
      'project',
      'campus',
      'edu',
      'skill',
      'honor',
      'cert',
      'portfolio',
      'eval',
    ]
    for (const key of presetKeys) {
      expect(SECTION_HINTS[key], `${key} 缺少提示`).toBeTruthy()
    }
  })
})
