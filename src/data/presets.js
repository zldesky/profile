/**
 * 模板、配色、字体等静态预设常量。
 */

/**
 * 字体清单。
 * 依据简历排版通行实践整理：中文优先无衬线，衬线用于更正式的岗位；
 * 英文单独列出可选字族，避免中文缺失时英文回退到系统默认字体。
 * stack 中同时给出中英文字族，保证中英混排时字重与气质统一。
 */
export const FONTS = {
  yahei: {
    name: '微软雅黑',
    category: '中文无衬线',
    recommended: true,
    desc: 'Windows 全版本内置、macOS 亦可显示，中文简历首选',
    stack: '"Microsoft YaHei","微软雅黑","PingFang SC",sans-serif',
  },
  sourceHei: {
    name: '思源黑体',
    category: '中文无衬线',
    recommended: true,
    desc: '开源可自由嵌入，跨平台显示一致性最好',
    stack: '"Source Han Sans SC","Noto Sans SC","思源黑体","Microsoft YaHei",sans-serif',
  },
  pingfang: {
    name: '苹方',
    category: '中文无衬线',
    desc: 'macOS 与 iOS 系统字体，苹果设备上最清晰',
    stack: '"PingFang SC","苹方","Microsoft YaHei",sans-serif',
  },
  dengxian: {
    name: '等线',
    category: '中文无衬线',
    desc: 'Office 自带，比雅黑纤细，适合内容较满的简历',
    stack: '"DengXian","等线","Microsoft YaHei",sans-serif',
  },
  heiti: {
    name: '黑体',
    category: '中文无衬线',
    desc: '字重厚重，只建议用于标题',
    stack: '"SimHei","黑体","Microsoft YaHei",sans-serif',
  },
  sourceSong: {
    name: '思源宋体',
    category: '中文衬线',
    recommended: true,
    desc: '衬线更正式，适合国企、事业单位与学术岗位',
    stack: '"Source Han Serif SC","Noto Serif SC","思源宋体","SimSun",serif',
  },
  songti: {
    name: '宋体',
    category: '中文衬线',
    desc: '最通用的中文衬线，印刷感强，小字号下偏细',
    stack: '"SimSun","宋体",serif',
  },
  fangsong: {
    name: '仿宋',
    category: '中文衬线',
    desc: '公文常用字体，适合体制内投递',
    stack: '"FangSong","仿宋","SimSun",serif',
  },
  kaiti: {
    name: '华文楷体',
    category: '中文衬线',
    recommended: true,
    desc: '投行与对外正式文件的常用字体（STKaiti）',
    stack: '"STKaiti","华文楷体","KaiTi","楷体",serif',
  },
  arial: {
    name: 'Arial',
    category: '英文推荐',
    desc: '兼容性最好的无衬线英文字体，最保险的选择',
    stack: 'Arial,"Helvetica Neue",Helvetica,"PingFang SC","Microsoft YaHei",sans-serif',
  },
  helvetica: {
    name: 'Helvetica',
    category: '英文推荐',
    desc: '中性克制的现代无衬线，外企与咨询常用',
    stack: 'Helvetica,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif',
  },
  times: {
    name: 'Times New Roman',
    category: '英文推荐',
    desc: '经典衬线，学术与英文学术向岗位适用',
    stack: '"Times New Roman",Times,"Songti SC","SimSun",serif',
  },
  georgia: {
    name: 'Georgia',
    category: '英文推荐',
    desc: '屏幕显示友好的衬线字体，数字比例舒适',
    stack: 'Georgia,"Times New Roman","Songti SC",serif',
  },
  calibri: {
    name: 'Calibri',
    category: '英文推荐',
    desc: 'Office 默认字体，圆润易读',
    stack: 'Calibri,"Segoe UI",Arial,"Microsoft YaHei",sans-serif',
  },
}

export const FONT_OPTIONS = Object.entries(FONTS).map(([value, font]) => ({
  value,
  ...font,
}))

/** 按类别分组，供下拉框的 optgroup 使用 */
export const FONT_GROUPS = ['中文无衬线', '中文衬线', '英文推荐'].map((name) => ({
  name,
  items: FONT_OPTIONS.filter((font) => font.category === name),
}))

/** 旧版本字体键迁移，避免历史数据取不到字族 */
export const FONT_KEY_MIGRATION = {
  yh: 'yahei',
  sun: 'songti',
  hei: 'heiti',
  kai: 'kaiti',
  sy: 'sourceHei',
  deng: 'dengxian',
}

/** 正文字号层级参考，仅作面板提示用 */
export const FONT_SIZE_TIPS = '正文建议 10–10.5pt，模块标题 12–14pt，姓名 16–22pt，行距 1.15–1.5 倍。'

/** 主色预设 */
export const ACCENT_PRESETS = [
  '#2b579a',
  '#1f6f5c',
  '#8c2f39',
  '#3f3f46',
  '#5b4b8a',
  '#b45309',
  '#0e7490',
  '#9d174d',
  '#166534',
  '#1e3a8a',
]

/** 模块标题主体样式 */
export const TITLE_STYLES = [
  { value: 'fill', label: '色块' },
  { value: 'pill', label: '胶囊' },
  { value: 'gradient', label: '渐变块' },
  { value: 'underline', label: '下划线' },
  { value: 'bar', label: '左竖条' },
  { value: 'boxed', label: '描边框' },
  { value: 'center', label: '居中' },
  { value: 'leader', label: '点线延伸' },
  { value: 'plain', label: '纯文字' },
]

/** 标题前的标记形状 */
export const TITLE_MARKERS = [
  { value: 'square', label: '方块' },
  { value: 'diamond', label: '菱形' },
  { value: 'circle', label: '圆点' },
  { value: 'ring', label: '空心圆' },
  { value: 'triangle', label: '三角' },
  { value: 'bar', label: '竖条' },
  { value: 'none', label: '无' },
]

/**
 * 标题底部装饰。
 * 线型用线宽控制厚度，形状用线宽的三倍作为高度。
 */
export const TITLE_BOTTOM_STYLES = [
  { value: 'none', label: '无' },
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'gradient', label: '渐变' },
  { value: 'double', label: '双线' },
  { value: 'trapezoid', label: '梯形' },
  { value: 'ribbon', label: '彩带' },
  { value: 'chevron', label: '箭头' },
]

/** 标题底部装饰起始位置 */
export const TITLE_BOTTOM_ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
]

/** 模块内容对齐方式 */
export const SECTION_ALIGN_OPTIONS = [
  { value: 'inherit', label: '跟随主题' },
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
  { value: 'justify', label: '两端' },
]

/** 模块列数，仅对键值网格与技能进度条生效 */
export const SECTION_COLUMN_OPTIONS = [
  { value: 'auto', label: '自适应' },
  { value: '1', label: '1 列' },
  { value: '2', label: '2 列' },
  { value: '3', label: '3 列' },
  { value: '4', label: '4 列' },
]

/**
 * 头像形状。
 * 证件照本身是竖版矩形，直角最贴近真实照片；
 * 圆形需要宽高相等，否则会被拉成椭圆。
 */
export const AVATAR_SHAPES = [
  { value: 'square', label: '直角' },
  { value: 'rounded', label: '圆角' },
  { value: 'circle', label: '圆形' },
]

/** 常用证件照尺寸（毫米）：1 寸 25×35、2 寸 35×49 为国内通行规格 */
export const AVATAR_SIZE_PRESETS = [
  { label: '1 寸', width: 25, height: 35 },
  { label: '2 寸', width: 35, height: 49 },
  { label: '正方形', width: 24, height: 24 },
]

/** 头像尺寸可调范围（毫米） */
export const AVATAR_SIZE_RANGE = {
  width: { min: 15, max: 50 },
  height: { min: 15, max: 65 },
}

/**
 * 模板清单。
 * id 需与 templates/index.js 中的注册键一致。
 */
export const TEMPLATES = [
  {
    id: 'classic',
    name: '经典单栏',
    desc: '信息网格 + 色块标题，通用稳重',
    tags: ['通用', '国企'],
  },
  {
    id: 'sidebar',
    name: '左侧色栏',
    desc: '深色竖栏承载头像、联系方式与技能',
    tags: ['互联网', '设计'],
  },
  {
    id: 'twocol',
    name: '双栏紧凑',
    desc: '左右分栏，一页可容纳更多内容',
    tags: ['经验丰富'],
  },
  {
    id: 'timeline',
    name: '时间轴',
    desc: '中轴串联经历，职业路径一目了然',
    tags: ['成长清晰'],
  },
  {
    id: 'minimal',
    name: '极简留白',
    desc: '无装饰色块，适合学术与研究岗位',
    tags: ['学术', '外企'],
  },
]

/** 可选图标名，需与 components/SvgIcon.vue 中的定义一致 */
export const ICON_OPTIONS = [
  { value: 'cake', label: '生日' },
  { value: 'user', label: '性别' },
  { value: 'phone', label: '手机' },
  { value: 'mail', label: '邮箱' },
  { value: 'location', label: '城市' },
  { value: 'briefcase', label: '工作' },
  { value: 'clock', label: '时间' },
  { value: 'coin', label: '薪资' },
  { value: 'school', label: '学校' },
  { value: 'star', label: '荣誉' },
  { value: 'link', label: '链接' },
  { value: 'github', label: '代码仓库' },
  { value: 'award', label: '证书' },
  { value: 'none', label: '无图标' },
]

/** A4 纸张尺寸（毫米） */
export const PAGE = {
  width: 210,
  height: 297,
}

/** 毫米转 CSS 像素（96dpi） */
export const MM_TO_PX = 96 / 25.4
