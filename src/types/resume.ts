/**
 * 简历领域类型。
 *
 * 以 server/sanitize.js 的白名单与 normalizeResume 的归一化结果为准：
 * 这里的类型描述的是「归一化后」的数据形态；导入的原始数据允许缺字段，
 * 由 normalizeResume 补齐成下面的形状。
 */

export type ResumeVersion = 2

export type SectionType = 'grid' | 'entries' | 'skills' | 'text'

/** 可选图标名，需与 components/SvgIcon.vue 中的定义一致 */
export type IconName =
  | 'user'
  | 'cake'
  | 'phone'
  | 'mail'
  | 'location'
  | 'briefcase'
  | 'clock'
  | 'coin'
  | 'school'
  | 'star'
  | 'award'
  | 'link'
  | 'github'
  | 'none'

/** 带自增 id 的最小约定 */
export interface Identified {
  id: string
}

/** 键值网格条目（求职意向、联系方式、荣誉等） */
export interface GridItem extends Identified {
  icon: IconName
  label: string
  value: string
}

/** 条目补充信息（如「专业成绩：GPA 3.7/4.0」） */
export interface EntryMeta extends Identified {
  label: string
  value: string
}

/** 条目要点（「动作 + 事项 + 量化结果」） */
export interface Bullet extends Identified {
  text: string
}

/** 经历条目（工作 / 项目 / 教育），时间倒序 */
export interface EntryItem extends Identified {
  time: string
  org: string
  role: string
  /** 机构图标的 DataURL，为空时用机构名首字占位 */
  logo: string
  meta: EntryMeta[]
  bullets: Bullet[]
}

/** 技能条目（level 0~100，配 showBars 渲染进度条） */
export interface SkillItem extends Identified {
  name: string
  level: number
}

/** 键值网格模块 */
export interface GridSection extends Identified {
  type: 'grid'
  title: string
  visible: boolean
  layout: SectionLayout
  items: GridItem[]
}

/** 条目列表模块 */
export interface EntriesSection extends Identified {
  type: 'entries'
  title: string
  visible: boolean
  layout: SectionLayout
  /** 机构图标默认关闭，避免非顶尖院校的校徽反成减分项 */
  showLogo: boolean
  items: EntryItem[]
}

/** 技能模块 */
export interface SkillsSection extends Identified {
  type: 'skills'
  title: string
  visible: boolean
  layout: SectionLayout
  /** 熟练度进度条默认隐藏，仅在明确开启时渲染 */
  showBars: boolean
  /** 文字描述（如「技术栈：熟练使用…」） */
  fields: EntryMeta[]
  items: SkillItem[]
}

/** 段落文本模块（自我评价） */
export interface TextSection extends Identified {
  type: 'text'
  title: string
  visible: boolean
  layout: SectionLayout
  content: string
}

export type Section = GridSection | EntriesSection | SkillsSection | TextSection

/** 模块的位置与对齐设置（indent / extraGap 用像素便于微调） */
export interface SectionLayout {
  align: 'inherit' | 'left' | 'center' | 'right'
  indent: number
  extraGap: number
  /** 'auto' 时按内容自适应，否则为列数字符串（'1' | '2' | '3' | '4'） */
  columns: string
}

/** 自由定制模板的布局参数 */
export interface CustomLayout {
  mode: string
  ratio: string
  header: string
  cards: boolean
  divider: boolean
}

export interface Theme {
  accent: string
  text: string
  fontKey: string
  fs: number
  lh: number
  gap: number
  /** 页边距（毫米） */
  mv: number
  mh: number
  /** 模块标题主体样式（枚举见 presets TITLE_STYLES） */
  titleStyle: string
  /** 标题前标记（枚举见 presets TITLE_MARKERS） */
  titleMarker: string
  titleGap: number
  titleMargin: number
  titleBottom: string
  titleBottomWidth: number
  titleBottomThickness: number
  titleBottomGap: number
  titleBottomAlign: 'left' | 'center' | 'right'
  customLayout: CustomLayout
}

export interface Basics {
  name: string
  jobTitle: string
  /** 头像 DataURL 或 IndexedDB 引用（idb-avatar:*） */
  avatar: string
  showAvatar: boolean
  avatarShape: 'square' | 'rounded' | 'circle'
  avatarWidth: number
  avatarHeight: number
  /** 相对模板默认位置的偏移（毫米），由预览区拖拽或面板滑杆调整 */
  avatarPos: { dx: number; dy: number }
  fields: GridItem[]
}

export interface Resume {
  version: ResumeVersion
  template: string
  theme: Theme
  basics: Basics
  sections: Section[]
}

/** 原始导入数据：字段可能缺失 / 版本更旧，交给 normalizeResume 补齐 */
export type RawResume = Partial<Resume> & Record<string, unknown>

/** 归一化前的模块：结构字段可信，其余字段允许缺席或为原始形态（如无 id） */
export type DraftSection = { type: SectionType; title: string; visible: boolean } & Record<
  string,
  unknown
>

/** 归一化前的基本信息（PDF 导入等生成方只保证关键字段） */
export interface DraftBasics {
  name: string
  jobTitle: string
  avatar?: string
  showAvatar?: boolean
  avatarShape?: Basics['avatarShape']
  fields?: GridItem[]
}

/** 归一化前的简历：normalizeResume 会补齐 version / theme / 各模块缺省字段 */
export interface DraftResume {
  template?: string
  basics: DraftBasics
  sections: DraftSection[]
}

/* ---------------- API 形状 ---------------- */

/** 简历合集条目（/api/collection 的摘要，不含简历正文） */
export interface CollectionItem {
  id: string
  name: string
  jobTitle: string
  template: string
  accent: string
  category: string
  createdAt: number
}

/** 一键风格预设（管理后台可编辑，key 对应 app_config 里的 styleConfig） */
export interface StylePreset {
  key: string
  name: string
  /** 胶囊上的色板：内置为渐变，运行时配置为主色实色 */
  swatch?: string
  patch: Partial<Pick<Theme, 'accent' | 'titleStyle' | 'titleMarker' | 'titleBottom' | 'fontKey'>>
}

/** 分享快照（/api/share/:id） */
export interface ShareSnapshot {
  resume: Resume
  createdAt: number
  expiresAt: number
}
