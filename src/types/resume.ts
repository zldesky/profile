/**
 * 简历领域类型。
 *
 * 以 server/sanitize.ts 的白名单与 normalizeResume 的归一化结果为准：
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

/**
 * 技能条目。
 * level（0~100）与所在模块的 showBars 是旧「熟练度进度条」的遗留字段：
 * 该功能已整套移除，两者都保留未删（旧简历与旧备份照常加载），但不再被渲染或导出。
 */
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
  /** 字段级间距微调，按字段身份串索引；缺省表示全部为 0 */
  fieldLayouts?: FieldLayouts
  items: GridItem[]
}

/** 条目列表模块 */
export interface EntriesSection extends Identified {
  type: 'entries'
  title: string
  visible: boolean
  layout: SectionLayout
  fieldLayouts?: FieldLayouts
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
  fieldLayouts?: FieldLayouts
  /** 旧「熟练度进度条」的开关，已不再被读取（保留字段以兼容旧数据） */
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
  fieldLayouts?: FieldLayouts
  content: string
}

export type Section = GridSection | EntriesSection | SkillsSection | TextSection

/**
 * 模块的位置与对齐设置（间距一律用像素，便于微调）。
 *
 * 四个方向各自独立：
 *  - indent / extraGap 是历史上就有的「左 / 上」，保留原名以免破坏已存的数据；
 *  - indentRight / extraGapBottom 是后补的「右 / 下」，默认 0。
 *
 * 分成四个标量而不是一个 padding 简写，是因为模板里它们是分别叠加到
 * 主题间距之上的：上/下要接 `--gap`，左/右是纯偏移。
 */
export interface SectionLayout {
  align: 'inherit' | 'left' | 'center' | 'right'
  /** 左缩进 px */
  indent: number
  /** 上方间距 px（叠加在主题模块间距之上） */
  extraGap: number
  /** 右缩进 px */
  indentRight: number
  /** 下方间距 px（叠加在主题模块间距之上） */
  extraGapBottom: number
  /** 'auto' 时按内容自适应，否则为列数字符串（'1' | '2' | '3' | '4'） */
  columns: string
}

/**
 * 单个字段的间距微调（叠加在模块级 SectionLayout 之上）。
 *
 * 键为字段身份串（见 utils/fieldLayout.ts 的 fieldLayoutKey），
 * 值是四个方向的额外位移（px）。缺省的轴视为 0。
 */
export interface FieldLayout {
  /** 左缩进 px */
  indent: number
  /** 右缩进 px */
  indentRight: number
  /** 上方间距 px */
  extraGap: number
  /** 下方间距 px */
  extraGapBottom: number
}

/** 按字段身份串索引的间距设置表 */
export type FieldLayouts = Record<string, FieldLayout>

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
