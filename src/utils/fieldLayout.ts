/**
 * 字段级的间距微调。
 *
 * 模块级布局（SectionLayout）只能整块挪动；而简历里常需要单独把一个字段推一点：
 * 「时间」想右对齐一点、「要点」想比标题多缩进半格……于是加了一层「按字段」的
 * 间距设置，存在 section.fieldLayouts 上，键是字段的身份串（见 fieldLayoutKey）。
 *
 * 每个字段各有自己的可调范围（FIELD_RANGES）：要点这类正文允许收得更紧、推得更开，
 * 而「时间 / 机构」这种短标签不需要那么大范围。范围只在**这里**维护一份，
 * 交互（WASD）、换算成样式、服务端清洗三处都引用它，避免「这边能到 60、那边卡在 48」。
 *
 * 字段间距是「叠加在模块级布局之上」的额外位移，不作为绝对 padding 写死，
 * 这样用户仍可以整体调模块、再单独微调某个字段，两层互不覆盖。
 */
import type { FieldLayout, Section } from '@/types/resume'

/** 四个方向键，顺序即 WASD 的语义方向 */
export const FIELD_AXES = ['indent', 'indentRight', 'extraGap', 'extraGapBottom'] as const
export type FieldAxis = (typeof FIELD_AXES)[number]

/** 每个字段身份对应的可调范围（单位 px）。未单列的字段走 DEFAULT_RANGE。 */
export const FIELD_RANGES: Record<FieldAxis, { min: number; max: number }> = {
  indent: { min: -32, max: 64 },
  indentRight: { min: -32, max: 64 },
  extraGap: { min: -16, max: 48 },
  extraGapBottom: { min: -16, max: 48 },
}

/** 单个字段一组轴的范围：大部分字段用统一默认，特殊字段可覆盖 */
export type FieldRange = Record<FieldAxis, { min: number; max: number }>

/**
 * 按字段种类给出范围。
 *
 * 「要点 / 正文」是长文本，缩进收放的空间更大；「时间 / 机构 / 职位」是短标签，
 * 大幅缩进会把同行内容挤得换行，所以范围收窄。这样「每个字段都有自己的调整范围」
 * 落到实处，而不是所有字段共用一个筐。
 */
export function rangeForField(field: string): FieldRange {
  if (field === 'bulletText' || field === 'content' || field === 'metaValue') {
    return {
      indent: { min: -48, max: 96 },
      indentRight: { min: -32, max: 64 },
      extraGap: { min: -16, max: 48 },
      extraGapBottom: { min: -16, max: 48 },
    }
  }
  if (field === 'entryTime' || field === 'entryOrg' || field === 'entryRole') {
    return {
      indent: { min: -24, max: 48 },
      indentRight: { min: -24, max: 48 },
      extraGap: { min: -12, max: 32 },
      extraGapBottom: { min: -12, max: 32 },
    }
  }
  return {
    indent: { ...FIELD_RANGES.indent },
    indentRight: { ...FIELD_RANGES.indentRight },
    extraGap: { ...FIELD_RANGES.extraGap },
    extraGapBottom: { ...FIELD_RANGES.extraGapBottom },
  }
}

/** 空（清零）的字段间距 */
export const ZERO_FIELD_LAYOUT: FieldLayout = {
  indent: 0,
  indentRight: 0,
  extraGap: 0,
  extraGapBottom: 0,
}

/**
 * 字段身份串：字段种类 + 条目 id（没有条目则为空）。
 *
 * 同一种 field 在不同条目里要分别记（第 2 条要点的缩进和第 1 条无关），
 * 所以带上 itemId；模块标题、正文这种整段字段没有 itemId，用空字符串即可。
 */
export function fieldLayoutKey(field: string, itemId = ''): string {
  return itemId ? `${field}:${itemId}` : field
}

/** 取某字段的间距设置（缺失时返回零值，不返回 undefined，方便直接读） */
export function getFieldLayout(section: Section, key: string): FieldLayout {
  return { ...ZERO_FIELD_LAYOUT, ...(section.fieldLayouts?.[key] || {}) }
}

/** 把范围钳制进去 */
export function clampAxis(field: string, axis: FieldAxis, value: number): number {
  const range = rangeForField(field)[axis]
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

/**
 * 换算成作用于**字段元素**的内联样式。
 *
 * 与模块级 sectionLayoutStyle 一样，为 0 的轴一律不写，交给样式表默认值，
 * 避免内联 0 把主题自带的缩进锁死。字段间距是「额外位移」：
 * 用 margin 而非 padding，这样它作用在行内/块级元素上都表现为整体平移，不改变文字排版。
 */
export interface FieldLayoutStyle {
  marginLeft?: string
  marginRight?: string
  marginTop?: string
  marginBottom?: string
}

export function fieldLayoutStyle(layout: FieldLayout | undefined): FieldLayoutStyle {
  const style: FieldLayoutStyle = {}
  if (!layout) return style
  if (Number(layout.indent)) style.marginLeft = `${layout.indent}px`
  if (Number(layout.indentRight)) style.marginRight = `${layout.indentRight}px`
  if (Number(layout.extraGap)) style.marginTop = `${layout.extraGap}px`
  if (Number(layout.extraGapBottom)) style.marginBottom = `${layout.extraGapBottom}px`
  return style
}
