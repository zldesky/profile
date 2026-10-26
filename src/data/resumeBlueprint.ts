/**
 * 简历骨架蓝图：按「求职类型 + 方向」给出模块顺序、求职意向字段与要点模板。
 *
 * 为什么要有这一层（而不是直接让 AI 生成整份简历）：
 *
 *  1. **AI 不该编造经历。** 本仓库此前移除过一条「AI 补充导入」，理由写在 README：
 *     让模型判断「这段内容属于哪段经历」，而错填比不填更糟、且难以复核。
 *     这里沿用同一原则：**结构、顺序、字段、写作模板由代码决定**，
 *     AI 只在这些骨架之上做措辞层面的润色，且结果必须先给用户过目。
 *  2. **离线可用。** 没配模型服务时这条路照样能走完 —— 用户得到一份带占位符的
 *     骨架，按提示填自己的内容即可。AI 是加速器，不是前置条件。
 *  3. **可测试。** 纯函数 + 纯数据，`tests/resumeBlueprint.test.js` 能直接断言
 *     「社招的第一个模块是工作经历」「校招必然包含教育背景」这类规则，
 *     而不必真的调用模型。
 *
 * ## 关于「最新实际行情」
 *
 * 下面的 `MARKET_BASELINE` 是**人工整理的基线**（含整理日期），不是实时抓取：
 * 拿不到可靠实时数据时不假装有。它的用途是给默认值与提示语一个合理起点，
 * 用户永远可以改。要更新就改这一处，并把 `MARKET_AS_OF` 一起改掉 ——
 * 一个过期的日期比没有日期更糟，因为读者会以为它是新的。
 */

import {
  createBullet,
  createEntry,
  createGridItem,
  createMeta,
  createSectionFromPreset,
  createSkill,
  DEFAULT_SECTION_LAYOUT,
} from '@/data/defaultResume'
import type { GridItem, Resume, Section } from '@/types/resume'
import { uid } from '@/utils/helpers'

/** 行情基线的整理日期。改动下面的数字时请一起更新。 */
export const MARKET_AS_OF = '2026-10'

/**
 * 求职类型。用户的第一步就是选它 —— 它决定模块顺序，
 * 而模块顺序是简历里最影响「第一眼看到什么」的一件事。
 */
export type TrackKey = 'social' | 'campus' | 'intern' | 'other'

export interface TrackOption {
  key: TrackKey
  label: string
  hint: string
  /** 模块顺序（SECTION_PRESETS 的 key，按渲染顺序） */
  order: string[]
  /** 这条线最该被看到的东西，写在向导里当一句话指引 */
  emphasis: string
}

/**
 * 四条线的模块顺序，各有理由：
 *
 *  - **社招**：工作经历是唯一的主证据，必须紧跟求职意向；教育背景对工作多年的人
 *    已不是决定因素，放最后（HR 只在需要确认学历时才往下翻）。
 *  - **校招**：没有正式工作经历，教育背景（学校/专业/GPA）是硬门槛，提前；
 *    实习与项目是能力证据，排在教育之后。
 *  - **实习**：在校生找实习，教育背景仍然第一，但没有实习经历时用项目与校园经历顶上。
 *  - **其他**（转行 / 兼职 / 自由职业 / 复出）：没有稳定雇佣关系可写，
 *    改为「能力与作品优先」，用项目与技能承担主证据。
 */
export const TRACKS: TrackOption[] = [
  {
    key: 'social',
    label: '社招（有工作经验）',
    hint: '工作经历放最前，教育背景靠后',
    order: ['intent', 'work', 'project', 'skill', 'edu'],
    emphasis: '每一段工作都要有可核对的结果数字；没有数字的经历，HR 会当成「没做成什么」。',
  },
  {
    key: 'campus',
    label: '校招（应届毕业生）',
    hint: '教育背景提前，实习与项目承担能力证据',
    order: ['intent', 'edu', 'intern', 'project', 'skill', 'honor'],
    emphasis: '校招看「可培养性」：课程与 GPA 说明基础，实习与项目说明能上手。',
  },
  {
    key: 'intern',
    label: '实习（在校找实习）',
    hint: '教育背景第一，项目与校园经历补位',
    order: ['intent', 'edu', 'project', 'campus', 'skill'],
    emphasis: '实习岗最看重「能马上干活」：把课程项目写具体，比罗列奖项更有用。',
  },
  {
    key: 'other',
    label: '其他（转行 / 兼职 / 自由职业）',
    hint: '能力与作品优先，弱化雇佣时间线',
    order: ['intent', 'project', 'skill', 'work', 'edu'],
    emphasis: '没有连续雇佣关系时，用「做成过什么」建立可信度，别解释空窗。',
  },
]

/** 按 key 取求职类型，取不到按社招处理 */
export function trackByKey(key: string): TrackOption {
  return TRACKS.find((item) => item.key === key) || TRACKS[0]
}

/** 常见求职方向；用于给要点模板与薪资区间挑一组关键词 */
export interface DirectionOption {
  key: string
  label: string
  /** 该方向简历里最有分量的关键词，给「技能特长」与要点模板用 */
  keywords: string[]
  /** 一线城市社招月薪区间（K）；校招/实习另有折算 */
  band: [number, number]
}

export const DIRECTIONS: DirectionOption[] = [
  {
    key: 'frontend',
    label: '前端开发',
    keywords: ['Vue3 / React', 'TypeScript', '工程化与构建', '性能优化', '组件库'],
    band: [20, 40],
  },
  {
    key: 'backend',
    label: '后端开发',
    keywords: ['Java / Go', 'Spring Boot', 'MySQL 与索引优化', 'Redis 缓存', '消息队列'],
    band: [22, 45],
  },
  {
    key: 'fullstack',
    label: '全栈开发',
    keywords: ['前后端一体', 'Node.js', '接口设计', '数据库建模', '部署与运维'],
    band: [22, 42],
  },
  {
    key: 'algorithm',
    label: '算法 / AI',
    keywords: ['Python', '深度学习框架', '模型训练与调优', '数据处理', '论文与竞赛'],
    band: [30, 60],
  },
  {
    key: 'test',
    label: '测试 / 质量',
    keywords: ['自动化测试', '接口测试', '性能压测', 'CI 集成', '缺陷管理'],
    band: [16, 30],
  },
  {
    key: 'data',
    label: '数据 / 分析',
    keywords: ['SQL', '数据建模', '指标体系', 'BI 可视化', 'A/B 实验'],
    band: [18, 38],
  },
  {
    key: 'product',
    label: '产品经理',
    keywords: ['需求分析', 'PRD 与原型', '数据驱动迭代', '跨团队推进', '用户研究'],
    band: [18, 40],
  },
  {
    key: 'design',
    label: '设计（UI / UX）',
    keywords: ['Figma', '设计规范', '交互流程', '可用性验证', '视觉落地'],
    band: [15, 35],
  },
  {
    key: 'ops',
    label: '运营',
    keywords: ['活动策划', '用户增长', '内容运营', '数据分析', '渠道投放'],
    band: [12, 28],
  },
  {
    key: 'other',
    label: '其他 / 暂不确定',
    keywords: [],
    band: [12, 25],
  },
]

/** 按 key 取方向，取不到按「其他」处理 */
export function directionByKey(key: string): DirectionOption {
  return DIRECTIONS.find((item) => item.key === key) || DIRECTIONS[DIRECTIONS.length - 1]
}

/**
 * 城市档位：只影响薪资默认区间的折算系数，不影响模块结构。
 * 用「一线 / 新一线 / 其他」三档而不是逐个城市列，避免维护一张永远不全的表。
 */
export type CityTier = 'tier1' | 'tier2' | 'other'

export const CITY_TIERS: Array<{ key: CityTier; label: string; factor: number }> = [
  { key: 'tier1', label: '一线（北上广深）', factor: 1 },
  { key: 'tier2', label: '新一线 / 省会', factor: 0.8 },
  { key: 'other', label: '其他城市', factor: 0.65 },
]

export function cityTierFactor(key: string): number {
  return CITY_TIERS.find((item) => item.key === key)?.factor ?? 1
}

/**
 * 按类型与方向折算薪资默认区间。
 *
 * 折算规则刻意保守：校招取社招的 55%，实习取日薪区间（不按月薪写，
 * 因为实习本来就是按天/按小时谈的，写成月薪反而误导）。
 */
export function salaryHint({
  track,
  direction,
  cityTier = 'tier1',
}: {
  track: TrackKey
  direction: string
  cityTier?: string
}): string {
  const dir = directionByKey(direction)
  const factor = cityTierFactor(cityTier)
  const [lo, hi] = dir.band
  const round = (n: number): number => Math.round(n / 1) * 1

  if (track === 'intern') {
    // 实习按日薪：一线大约 150-300/天，同样按城市系数折算
    const dayLo = round(150 * factor)
    const dayHi = round(300 * factor)
    return `${dayLo}-${dayHi} 元/天`
  }
  if (track === 'campus') {
    return `${round(lo * 0.55 * factor)}K-${round(hi * 0.55 * factor)}K`
  }
  if (track === 'other') {
    return `${round(lo * 0.7 * factor)}K-${round(hi * 0.8 * factor)}K`
  }
  return `${round(lo * factor)}K-${round(hi * factor)}K`
}

/**
 * 要点写作模板：占位符用【】，用户替换成自己的事实。
 *
 * 每一条都对应一个「招聘方真正想看的东西」，不是泛泛的「描述工作内容」：
 *  - 动作 + 对象 + 量化结果（最通用，也最难写好）
 *  - 优化类：改前 → 改后
 *  - 协作类：推动谁、推动了什么
 *  - 从 0 到 1 类：新建了什么、被谁用
 */
export const BULLET_TEMPLATES: Record<string, string[]> = {
  social: [
    '负责【业务模块】的【具体职责】，将【核心指标】从【改前数值】提升至【改后数值】，提升约【__】%。',
    '主导【项目 / 改造】，覆盖【范围或用户量】，使【效率 / 成本 / 稳定性】改善【__】%。',
    '推动【跨团队协作事项】，与【产品 / 设计 / 后端】共同落地【结果】，【上线效果或数据】。',
  ],
  campus: [
    '在【实习公司 / 实验室】【岗位】，负责【模块】，完成【可核对的结果，如接口数 / 页面数 / 覆盖率】。',
    '【课程 / 竞赛 / 项目】中实现【技术方案】，解决【具体问题】，【量化结果，如耗时下降 / 排名】。',
    '掌握【核心技能】，在【场景】中用它完成【产出】，并【验证方式，如压测 / 单测 / 上线】。',
  ],
  intern: [
    '参与【项目 / 课程设计】，独立负责【模块】，完成【产出，如 3 个页面 / 1 套接口】。',
    '使用【技术 / 工具】实现【功能】，解决【问题】，【量化或可验证的结果】。',
    '在【社团 / 团队】中承担【角色】，组织【活动 / 协作】，【参与人数或结果】。',
  ],
  other: [
    '独立完成【项目 / 作品】，使用【技术 / 方法】，交付【可查看的成果或链接】。',
    '为【客户 / 团队】解决【问题】，产出【结果】，【量化收益】。',
    '持续投入【方向】共【时长】，产出【作品 / 文章 / 项目】共【数量】，【影响或反馈】。',
  ],
}

/**
 * 每个模块的填写提示：告诉用户「这一段该写什么」。
 * 放在模块标题的说明位置，比让人对着一张空白卡片发呆有用。
 */
export const SECTION_HINTS: Record<string, string> = {
  intent: '岗位、城市、期望薪资与到岗时间。薪资可以先填区间，面试时再谈。',
  work: '按时间倒序。每段 2-4 条要点，每条都要有结果或数字。',
  intern: '写清实习期间的独立产出，比「参与了什么项目」更有说服力。',
  project: '项目名写清是什么、服务谁；要点写你负责的部分与结果。',
  campus: '社团、学生会、志愿、竞赛都可以写，重点是你组织了什么事、结果如何。',
  edu: '学校、专业、学历、时间；有 GPA 或排名就写上，没有不勉强。',
  skill: '按熟练程度排序，只写能在面试里被追问三层的东西。',
  honor: '带名次或比例的奖项才有分量，「获得奖学金」不如「校级一等奖（前 5%）」。',
  cert: '语言与职业资格类证书，写清等级与取得时间。',
  portfolio: '个人主页、代码仓库、作品链接；确保链接能打开。',
  eval: '有具体事实支撑再写，否则不如删掉 —— 空话会稀释前面的硬内容。',
}

/** 蓝图生成的输入 */
export interface BlueprintInput {
  track: TrackKey
  /** DIRECTIONS 的 key */
  direction: string
  cityTier?: string
  /** 意向城市的具体写法，如「上海 / 杭州」 */
  city?: string
  /** 工作年限（社招用），如「5 年」；留空则按占位符处理 */
  years?: string
}

/** 蓝图生成结果：一段可直接写进 store 的数据 + 给用户看的说明 */
export interface Blueprint {
  /** 模块，顺序已按求职类型排好 */
  sections: Section[]
  /** 求职意向里的字段值（供界面预览与回填） */
  intent: { jobTitle: string; city: string; salary: string; availability: string }
  /** 给用户的一句话强调 */
  emphasis: string
  /** 按模块标题给出的填写提示 */
  hints: Array<{ title: string; hint: string }>
  /** 这份蓝图基于的行情基线日期 */
  marketAsOf: string
}

/**
 * 生成简历骨架。
 *
 * 关键取舍：**产出的是「带占位符的空骨架」，不是「看起来完整的假简历」。**
 * 每段经历只给一条要点模板（写着【】），用户必须替换成自己的事实。
 * 这样做有两个好处：不会被误当成真内容直接投出去；也逼着用户面对
 * 「我到底做出了什么」这个问题 —— 那正是简历里唯一有价值的部分。
 *
 * @param input 求职类型与方向
 * @returns 可直接交给 store 的骨架数据
 */
export function buildBlueprint(input: BlueprintInput): Blueprint {
  const track = trackByKey(input.track)
  const dir = directionByKey(input.direction)
  const templates = BULLET_TEMPLATES[track.key] || BULLET_TEMPLATES.social

  const sections = track.order.map((key) => {
    const section = createSectionFromPreset(key)

    // 经历类模块：只留一条带占位符的要点，其余清空 —— 不给假内容
    if (section.type === 'entries') {
      section.items = [
        createEntry({
          time: '',
          org: '',
          role: '',
          meta: [],
          bullets: [createBullet(templates[0] ?? '')],
        }),
      ]
      // 校招的教育背景保留「专业成绩」字段，其余模块不加
      if (key === 'edu') {
        section.items[0].meta = [createMeta('专业成绩', '')]
      }
    }

    // 技能模块：用该方向的真实关键词起底，用户删改比从零想快得多
    if (section.type === 'skills') {
      section.fields = [
        createMeta(
          '技术栈',
          dir.keywords.length
            ? `${dir.keywords.join('、')}（按你的实际熟练度删改，只留能在面试里被追问的）`
            : '',
        ),
      ]
      section.items = dir.keywords.map((name) => createSkill({ name, level: 80 }))
    }

    // 荣誉奖项：给一条格式示例而不是空行，让人知道「该怎么写才有分量」
    if (key === 'honor' && section.type === 'grid') {
      section.items = [
        createGridItem({ icon: 'star', label: '奖学金', value: '【等级】，【排名或比例】' }),
      ]
    }

    return section
  })

  const intent = {
    jobTitle: dir.key === 'other' ? '' : dir.label,
    city: input.city?.trim() || '【意向城市】',
    salary: salaryHint({
      track: track.key,
      direction: dir.key,
      cityTier: input.cityTier || 'tier1',
    }),
    availability:
      track.key === 'intern'
        ? '【每周可到岗 __ 天，可实习 __ 个月】'
        : track.key === 'campus'
          ? '【__ 届毕业生，可随时到岗】'
          : '【一个月内 / 随时到岗】',
  }

  // 求职意向模块的字段值按上面的结果回填
  const intentSection = sections.find((s) => s.type === 'grid' && s.title === '求职意向')
  if (intentSection && intentSection.type === 'grid') {
    intentSection.items = [
      createGridItem({ icon: 'briefcase', label: '求职岗位', value: intent.jobTitle }),
      createGridItem({ icon: 'location', label: '意向城市', value: intent.city }),
      createGridItem({ icon: 'coin', label: '期望薪资', value: intent.salary }),
      createGridItem({ icon: 'clock', label: '到岗时间', value: intent.availability }),
    ]
  }

  return {
    sections,
    intent,
    emphasis: track.emphasis,
    hints: sections.map((section) => ({
      title: section.title,
      hint: SECTION_HINTS[track.order[sections.indexOf(section)] ?? ''] || '',
    })),
    marketAsOf: MARKET_AS_OF,
  }
}

/**
 * 把蓝图套进一份完整简历（保留主题与基本信息，只替换模块与求职意向）。
 *
 * 为什么不新建一份空白 Resume：用户可能已经调过配色/模板，
 * 换结构不该把这些一起重置。这里只动 sections，其余原样保留。
 */
export function applyBlueprintToResume(base: Resume, blueprint: Blueprint): Resume {
  return {
    ...base,
    // 基本信息里的求职职位与求职意向保持一致，避免纸面上两个地方说法不同
    basics: { ...base.basics, jobTitle: blueprint.intent.jobTitle || base.basics.jobTitle },
    sections: blueprint.sections.map((section) => ({
      ...section,
      id: uid('sec'),
      layout: { ...DEFAULT_SECTION_LAYOUT, ...(section.layout || {}) },
    })),
  }
}

/** 供界面显示的一行摘要，例如「社招 · 前端开发 · 一线」 */
export function describeBlueprint(input: BlueprintInput): string {
  const track = trackByKey(input.track)
  const dir = directionByKey(input.direction)
  const tier = CITY_TIERS.find((item) => item.key === (input.cityTier || 'tier1'))
  return [track.label, dir.label, tier?.label].filter(Boolean).join(' · ')
}

/** 该方向的占位符要点模板，界面用来提示「一条好要点长什么样」 */
export function bulletTemplatesFor(track: TrackKey): string[] {
  return BULLET_TEMPLATES[track] || BULLET_TEMPLATES.social
}

/** 供 GridItem 预览用：把蓝图里的意向值摊平成数组 */
export function intentItems(intent: Blueprint['intent']): GridItem[] {
  return [
    createGridItem({ icon: 'briefcase', label: '求职岗位', value: intent.jobTitle }),
    createGridItem({ icon: 'location', label: '意向城市', value: intent.city }),
    createGridItem({ icon: 'coin', label: '期望薪资', value: intent.salary }),
    createGridItem({ icon: 'clock', label: '到岗时间', value: intent.availability }),
  ]
}
