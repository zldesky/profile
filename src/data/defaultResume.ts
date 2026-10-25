import type { SectionType, Theme } from '@/types/resume'
import type {
  Bullet,
  EntryItem,
  EntryMeta,
  GridItem,
  GridSection,
  EntriesSection,
  Resume,
  Section,
  SectionLayout,
  SkillItem,
  SkillsSection,
  TextSection,
} from '@/types/resume'
import { uid } from '@/utils/helpers'

import { DEFAULT_CUSTOM_LAYOUT } from '@/data/presets'

/**
 * 简历数据结构说明
 *
 * resume
 *  ├─ version    数据版本号，用于后续兼容迁移
 *  ├─ template   当前模板 id
 *  ├─ theme      主题（配色 / 字体 / 排版 / 页边距）
 *  ├─ basics     基本信息（姓名、头像、联系方式字段）
 *  └─ sections   模块数组，数组顺序即渲染顺序，天然支持拖拽排序
 *
 * 模块按 type 区分渲染方式：
 *  - grid    键值网格（求职意向）
 *  - entries 条目列表，含时间、机构、职位、补充字段与要点（教育 / 工作 / 项目）
 *  - skills  技能文字描述 + 技能名列表
 *  - text    段落文本（自我评价）
 */

export interface SectionTypeOption {
  value: SectionType
  label: string
  hint: string
}

export const SECTION_TYPES: SectionTypeOption[] = [
  { value: 'entries', label: '条目列表', hint: '适合教育、工作、项目经历' },
  { value: 'grid', label: '键值网格', hint: '适合求职意向等两列信息' },
  { value: 'skills', label: '技能特长', hint: '文字描述 + 技能名列表，可拖拽排序' },
  { value: 'text', label: '段落文本', hint: '适合自我评价、个人总结' },
]

export const DEFAULT_THEME: Theme = {
  accent: '#000000',
  text: '#2b2f36',
  fontKey: 'yahei',
  fs: 1,
  lh: 1.75,
  gap: 1,
  mv: 12,
  mh: 14,

  /* 模块标题主体样式，可选值见 presets.js 的 TITLE_STYLES */
  titleStyle: 'fill',
  /* 标题前标记形状，可选值见 presets.js 的 TITLE_MARKERS */
  titleMarker: 'square',

  /* 标题内部间距 */
  titleGap: 0.5, // 方块与标题文字的间距（em）
  titleMargin: 0.55, // 标题与下方正文的间距（em）

  /* 标题底边线 */
  titleBottom: 'none', // none / solid / dashed / dotted / gradient / double
  titleBottomWidth: 100, // 长度占标题宽度的百分比
  titleBottomThickness: 2, // 线宽（px）
  titleBottomGap: 4, // 底边线与标题文字的垂直间距（px）
  titleBottomAlign: 'left', // 线的起始位置：left / center / right

  /* 自由定制模板的布局参数，可选值见 presets.js 的 CUSTOM_* 选项 */
  customLayout: { ...DEFAULT_CUSTOM_LAYOUT },
}

/** 头像默认尺寸（毫米），取国内 1 寸证件照标准 25×35 */
export const DEFAULT_AVATAR: { width: number; height: number } = {
  width: 25,
  height: 35,
}

export function createBullet(text = ''): Bullet {
  return { id: uid('b'), text }
}

export function createEntry(patch: Partial<EntryItem> = {}): EntryItem {
  return {
    id: uid('e'),
    time: '',
    org: '',
    role: '',
    /* 机构图标（校徽 / 公司 logo）的 DataURL，为空时用机构名首字占位 */
    logo: '',
    meta: [],
    bullets: [createBullet()],
    ...patch,
  }
}

export function createMeta(label = '', value = ''): EntryMeta {
  return { id: uid('m'), label, value }
}

export function createGridItem(patch: Partial<GridItem> = {}): GridItem {
  return { id: uid('g'), icon: 'user', label: '', value: '', ...patch }
}

export function createSkill(patch: Partial<SkillItem> = {}): SkillItem {
  return { id: uid('s'), name: '', level: 80, ...patch }
}

/**
 * 模块的位置与对齐设置。
 * indent / extraGap 用像素便于做微调；columns 为 'auto' 时按内容自适应。
 */
export const DEFAULT_SECTION_LAYOUT: SectionLayout = {
  align: 'inherit',
  indent: 0,
  extraGap: 0,
  indentRight: 0,
  extraGapBottom: 0,
  columns: 'auto',
}

/**
 * 按模块类型创建空白模块。
 *
 * 新建模块里的条目一律留空，把示例文字放到输入框的 placeholder 里。
 * 这个区别不是洁癖：写进数据的示例文字会被当成真实内容，
 * 一路渲染到纸面、导出到 PDF、同步到云端。用户点了「添加」却没填，
 * 导出时纸上就会印着「项目名 / 内容 / 技能」—— 那是最难堪的一种 bug：
 * 它不报错，只是在别人看到的简历里。
 *
 * @param {string} type grid | entries | skills | text
 * @param {string} title 模块标题
 */
export function createSection(type: SectionType, title = '新模块'): Section {
  const base = {
    id: uid('sec'),
    type,
    title,
    visible: true,
    layout: { ...DEFAULT_SECTION_LAYOUT },
  }

  switch (type) {
    case 'grid':
      return {
        ...base,
        type: 'grid',
        items: [createGridItem({ label: '', value: '' })],
      } as GridSection
    case 'skills':
      return {
        ...base,
        type: 'skills',
        fields: [createMeta('', '')],
        items: [createSkill({ name: '', level: 80 })],
        showBars: false,
      } as SkillsSection
    case 'text':
      return { ...base, type: 'text', content: '' } as TextSection
    case 'entries':
    default:
      return { ...base, type: 'entries', items: [createEntry()], showLogo: false } as EntriesSection
  }
}

/**
 * 常用模块预设。
 * 依据简历结构通行做法整理：个人信息、教育背景、工作经历为必需模块；
 * 应届生可用实习经历、项目经历、校园经历替代工作经历。
 */
export interface SectionPreset {
  key: string
  title: string
  type: SectionType
  desc: string
  seed?: () => (GridItem | EntryItem | SkillItem)[]
}

export const SECTION_PRESETS: SectionPreset[] = [
  {
    key: 'intent',
    title: '求职意向',
    type: 'grid',
    desc: '岗位、城市、期望薪资、到岗时间',
    seed: () => [
      createGridItem({ icon: 'briefcase', label: '求职岗位', value: '' }),
      createGridItem({ icon: 'location', label: '意向城市', value: '' }),
      createGridItem({ icon: 'coin', label: '期望薪资', value: '' }),
      createGridItem({ icon: 'clock', label: '到岗时间', value: '' }),
    ],
  },
  {
    key: 'edu',
    title: '教育背景',
    type: 'entries',
    desc: '必需模块，建议附 GPA 或专业排名',
    seed: () => [
      createEntry({
        meta: [createMeta('专业成绩', 'GPA 3.8/4.0（专业前 5%）')],
        bullets: [],
      }),
    ],
  },
  {
    key: 'work',
    title: '工作经历',
    type: 'entries',
    desc: '必需且最重要，按时间倒序排列',
    seed: () => [createEntry()],
  },
  {
    key: 'intern',
    title: '实习经历',
    type: 'entries',
    desc: '应届生替代工作经历；毕业一年以上可考虑删除',
    seed: () => [createEntry()],
  },
  {
    key: 'project',
    title: '项目经历',
    type: 'entries',
    desc: '可添加多段项目，每段突出产出与数据',
    seed: () => [createEntry(), createEntry()],
  },
  {
    key: 'campus',
    title: '校园经历',
    type: 'entries',
    desc: '社团、学生会、志愿服务、竞赛经历',
    seed: () => [createEntry()],
  },
  {
    key: 'honor',
    title: '荣誉奖项',
    type: 'grid',
    desc: '带上名次或比例的奖项才有说服力',
    seed: () => [
      createGridItem({ icon: 'star', label: '奖学金', value: '校级一等奖学金（专业前 5%）' }),
    ],
  },
  {
    key: 'skill',
    title: '技能特长',
    type: 'skills',
    desc: '技术栈、语言能力，建议按熟练程度排序',
  },
  {
    key: 'cert',
    title: '证书',
    type: 'grid',
    desc: '语言与职业资格类证书',
    seed: () => [createGridItem({ icon: 'award', label: '证书名称', value: '' })],
  },
  {
    key: 'portfolio',
    title: '作品集',
    type: 'grid',
    desc: '个人主页、代码仓库、作品链接',
    seed: () => [
      createGridItem({ icon: 'link', label: '个人主页', value: '' }),
      createGridItem({ icon: 'github', label: '代码仓库', value: '' }),
    ],
  },
  {
    key: 'eval',
    title: '自我评价',
    type: 'text',
    desc: '有数据支撑再写，否则建议删掉',
  },
]

/**
 * 按预设创建模块，返回可直接推入 resume.sections 的对象。
 * @param {string} key SECTION_PRESETS 中的 key
 */
export function createSectionFromPreset(key: string): Section {
  const preset = SECTION_PRESETS.find((item) => item.key === key)
  const section = createSection(preset?.type || 'entries', preset?.title || '新模块')
  const seed = preset?.seed?.()
  if (seed) (section as { items: unknown[] }).items = seed
  return section
}

/**
 * 返回一份完整示例简历。
 */
export function createResume(): Resume {
  return {
    version: 2 as const,
    template: 'classic',
    theme: { ...DEFAULT_THEME },
    basics: {
      name: '张伟',
      jobTitle: '前端开发工程师',
      avatar: '',
      showAvatar: true,
      avatarShape: 'square',
      avatarWidth: DEFAULT_AVATAR.width,
      avatarHeight: DEFAULT_AVATAR.height,
      /* 相对模板默认位置的偏移（毫米），由预览区拖拽或面板滑杆调整 */
      avatarPos: { dx: 0, dy: 0 },
      fields: [
        createGridItem({ icon: 'cake', label: '年龄', value: '28岁' }),
        createGridItem({ icon: 'user', label: '性别', value: '男' }),
        createGridItem({ icon: 'briefcase', label: '工作年限', value: '5年经验' }),
        createGridItem({ icon: 'phone', label: '联系电话', value: '13800000000' }),
        createGridItem({ icon: 'mail', label: '联系邮箱', value: 'zhangwei@example.com' }),
        createGridItem({ icon: 'location', label: '现居城市', value: '上海' }),
      ],
    },
    sections: [
      {
        id: uid('sec'),
        type: 'grid',
        title: '求职意向',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        items: [
          createGridItem({ icon: 'briefcase', label: '求职岗位', value: '前端开发工程师' }),
          createGridItem({ icon: 'location', label: '意向城市', value: '上海 / 杭州' }),
          createGridItem({ icon: 'coin', label: '期望薪资', value: '25K-35K' }),
          createGridItem({ icon: 'clock', label: '到岗时间', value: '一个月内' }),
        ],
      },
      {
        id: uid('sec'),
        type: 'entries',
        title: '工作经历',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        showLogo: false,
        items: [
          createEntry({
            time: '2022-06 - 至今',
            org: '某某科技有限公司',
            role: '高级前端开发工程师',
            bullets: [
              createBullet(
                '主导公司中后台微前端体系改造，将 12 个子应用接入统一基座，构建耗时从 8 分钟降至 90 秒。',
              ),
              createBullet(
                '搭建组件库与脚手架，沉淀 60+ 业务组件，新项目初始化时间由 2 天缩短至 2 小时。',
              ),
              createBullet(
                '推动前端监控与性能治理，首屏 LCP 从 3.2s 优化至 1.4s，线上白屏率下降 76%。',
              ),
            ],
          }),
          createEntry({
            time: '2019-07 - 2022-05',
            org: '某某网络技术有限公司',
            role: '前端开发工程师',
            bullets: [
              createBullet('负责电商 C 端活动页开发，支撑大促期间单日 300 万 PV 稳定运行。'),
              createBullet('推动项目由 jQuery 迁移至 Vue3，代码量减少 40%，迭代效率明显提升。'),
            ],
          }),
        ],
      },
      {
        id: uid('sec'),
        type: 'entries',
        title: '项目经历',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        showLogo: false,
        items: [
          createEntry({
            time: '2023-03 - 2023-11',
            org: '企业数据可视化平台',
            role: '前端负责人',
            bullets: [
              createBullet(
                '负责整体技术选型与架构设计，采用 Vue3 + ECharts 实现 20+ 图表类型与自由拖拽看板。',
              ),
              createBullet(
                '针对万级数据渲染卡顿问题，引入虚拟滚动与增量更新，渲染帧率稳定在 55FPS 以上。',
              ),
            ],
          }),
          createEntry({
            time: '2022-09 - 2023-02',
            org: '组件库与脚手架建设',
            role: '核心贡献者',
            bullets: [
              createBullet('沉淀 60+ 业务组件与配套文档站，新项目初始化时间由 2 天缩短至 2 小时。'),
              createBullet('建立视觉走查与单元测试流程，组件回归问题下降 62%。'),
            ],
          }),
        ],
      },
      {
        id: uid('sec'),
        type: 'skills',
        title: '技能特长',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        fields: [
          createMeta(
            '技术栈',
            '熟练使用 Vue3、TypeScript、Vite、Node.js，具备完整的前端工程化落地经验。',
          ),
          createMeta('语言能力', '大学英语六级，可无障碍阅读英文技术文档并进行日常技术交流。'),
        ],
        items: [
          createSkill({ name: 'Vue / TypeScript', level: 92 }),
          createSkill({ name: '工程化与构建', level: 85 }),
          createSkill({ name: 'Node / 全栈', level: 70 }),
        ],
        showBars: false,
      },
      {
        id: uid('sec'),
        type: 'entries',
        title: '教育背景',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        showLogo: false,
        items: [
          createEntry({
            time: '2015-09 - 2019-06',
            org: '某某大学',
            role: '计算机科学与技术（本科）',
            meta: [createMeta('专业成绩', 'GPA 3.7/4.0，专业排名前 5%')],
            bullets: [
              createBullet('主修课程：数据结构、计算机网络、操作系统、数据库原理、软件工程。'),
            ],
          }),
        ],
      },
      {
        id: uid('sec'),
        type: 'text',
        title: '自我评价',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        content:
          '五年前端开发经验，擅长从零搭建项目工程体系与组件抽象，对性能优化与工程化有较深实践。做事注重结果与数据，习惯用可量化的方式验证方案效果；沟通主动，能独立对接产品、设计与后端团队推进复杂需求落地。持续关注前端技术演进，保持技术博客输出与开源项目参与。',
      },
    ],
  }
}

/**
 * 返回一份应届生示例简历：2027 届本科、后端开发（Java 主线）。
 *
 * 与示例简历（五年经验社招）配套 —— 新建 → 应届生 即得到这份预填内容，
 * 结构按应届生线：求职意向 → 教育背景 → 实习经历 → 项目经历 → 技能特长
 * （自我评价可省略，不放）。内容按当下校招行情写：实习与项目都有量化数据，
 * 技能围绕 Java / Spring Boot / MySQL / Redis / 消息队列这一条后端主线，
 * 期望薪资给应届本科的常见区间。用户拿到的就是这份，替换成自己的信息即可。
 */
export function createGraduateResume(): Resume {
  return {
    version: 2 as const,
    template: 'classic',
    theme: { ...DEFAULT_THEME },
    basics: {
      name: '李昂',
      jobTitle: '后端开发工程师（2027 届）',
      avatar: '',
      showAvatar: true,
      avatarShape: 'square',
      avatarWidth: DEFAULT_AVATAR.width,
      avatarHeight: DEFAULT_AVATAR.height,
      avatarPos: { dx: 0, dy: 0 },
      fields: [
        createGridItem({ icon: 'cake', label: '年龄', value: '22岁' }),
        createGridItem({ icon: 'phone', label: '联系电话', value: '13800000001' }),
        createGridItem({ icon: 'mail', label: '联系邮箱', value: 'liang@example.com' }),
        createGridItem({ icon: 'location', label: '现居城市', value: '上海' }),
      ],
    },
    sections: [
      {
        id: uid('sec'),
        type: 'grid',
        title: '求职意向',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        items: [
          createGridItem({ icon: 'briefcase', label: '求职岗位', value: '后端开发工程师（Java）' }),
          createGridItem({ icon: 'location', label: '意向城市', value: '上海 / 杭州' }),
          createGridItem({ icon: 'coin', label: '期望薪资', value: '15K-20K' }),
          createGridItem({ icon: 'clock', label: '到岗时间', value: '2027 届秋招，可随时实习' }),
        ],
      },
      {
        id: uid('sec'),
        type: 'entries',
        title: '教育背景',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        showLogo: false,
        items: [
          createEntry({
            time: '2023-09 - 2027-06',
            org: '某某大学',
            role: '计算机科学与技术（本科）',
            meta: [createMeta('专业成绩', 'GPA 3.6/4.0（专业前 15%）')],
            bullets: [
              createBullet(
                '主修课程：数据结构、操作系统、计算机网络、数据库原理、Java 程序设计、分布式系统入门。',
              ),
            ],
          }),
        ],
      },
      {
        id: uid('sec'),
        type: 'entries',
        title: '实习经历',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        showLogo: false,
        items: [
          createEntry({
            time: '2026-06 - 2026-09',
            org: '某某互联网科技有限公司',
            role: '后端开发实习生',
            bullets: [
              createBullet(
                '参与营销活动服务的迭代开发，独立负责 3 个接口从表设计、开发到上线，覆盖日均 50 万次调用。',
              ),
              createBullet(
                '为热点活动接口引入 Redis 缓存与本地缓存两级结构，接口平均耗时从 180ms 降至 45ms。',
              ),
              createBullet(
                '排查并优化 6 条慢 SQL，补齐联合索引与深分页改写，订单查询接口 P99 耗时下降 60%。',
              ),
            ],
          }),
        ],
      },
      {
        id: uid('sec'),
        type: 'entries',
        title: '项目经历',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        showLogo: false,
        items: [
          createEntry({
            time: '2025-10 - 2026-02',
            org: '短链接生成服务',
            role: '独立开发',
            bullets: [
              createBullet(
                '基于 Spring Boot + Redis + MySQL 实现短链生成与 302 跳转，支持自定义短码与过期策略。',
              ),
              createBullet(
                '用布隆过滤器拦截无效长链查询，结合缓存空值与互斥锁解决缓存击穿，单机压测 QPS 8000+。',
              ),
              createBullet(
                '访问明细经 RabbitMQ 异步落库削峰，数据库写入压力降低 70%，并产出每日访问报表。',
              ),
            ],
          }),
          createEntry({
            time: '2025-03 - 2025-06',
            org: '校园活动报名平台',
            role: '后端负责人（3 人团队）',
            bullets: [
              createBullet(
                '负责报名与签到模块的表结构设计与接口开发，活动开启瞬间用 Redis 预扣名额、消息队列异步落库。',
              ),
              createBullet(
                '设计定时对账任务解决超卖与重复报名，支撑全校 3000 人同时抢报，零超卖事故。',
              ),
            ],
          }),
        ],
      },
      {
        id: uid('sec'),
        type: 'skills',
        title: '技能特长',
        visible: true,
        layout: { ...DEFAULT_SECTION_LAYOUT },
        fields: [
          createMeta('后端语言', 'Java 基础扎实，熟悉集合、并发编程与 JVM 常见问题的排查思路。'),
          createMeta(
            '常用框架',
            '熟练使用 Spring Boot、MyBatis-Plus，了解 Spring Cloud 微服务组件。',
          ),
          createMeta(
            '数据存储',
            '熟悉 MySQL 索引与事务，掌握 Redis 缓存设计、分布式锁与 RabbitMQ 异步处理。',
          ),
          createMeta('工程工具', '熟练使用 Linux、Git、Maven 与 Docker，了解 CI/CD 流程。'),
        ],
        items: [
          createSkill({ name: 'Java 后端开发', level: 88 }),
          createSkill({ name: '数据库与缓存', level: 82 }),
          createSkill({ name: '消息队列', level: 72 }),
          createSkill({ name: '计算机基础', level: 80 }),
        ],
        showBars: false,
      },
    ],
  }
}
