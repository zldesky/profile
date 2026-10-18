/**
 * 把模块的位置与对齐设置换算成作用于 .r-sec 的内联样式。
 *
 * 未设置的项一律留空，让主题变量与样式表默认值继续生效，
 * 避免内联样式把主题里的全局调整「锁死」。
 */
import type { Section } from '@/types/resume'

/**
 * 返回值既含标准 CSS 属性，也含自定义属性（--sec-align 等）。
 * 必须显式声明：只写 `object` 会让调用方无法绑定到 :style ——
 * 模板里 `:style="sectionLayoutStyle(section)"` 会报
 * 「object 不能赋给 HTMLAttributes」。这是模板组件迁 TS 时暴露出来的第一处，
 * 也正是迁移该抓到的东西：类型没写清楚时，JS 里一直静默地用着。
 */
export type SectionLayoutStyle = {
  paddingLeft?: string
  marginTop?: string
  '--sec-align'?: string
  '--sec-item-justify'?: string
  '--grid-template'?: string
  '--bars-template'?: string
}

/** 内容对齐到 flex 主轴分布的映射 */
const ALIGN_MAP: Record<string, { text: string; item: string }> = {
  left: { text: 'left', item: 'flex-start' },
  center: { text: 'center', item: 'center' },
  right: { text: 'right', item: 'flex-end' },
  justify: { text: 'justify', item: 'flex-start' },
}

export function sectionLayoutStyle(section: Section): SectionLayoutStyle {
  const layout = section.layout || {}
  const style: SectionLayoutStyle = {}

  const align = ALIGN_MAP[layout.align ?? '']
  if (align) {
    style['--sec-align'] = align.text
    style['--sec-item-justify'] = align.item
  }

  if (Number(layout.indent)) {
    style.paddingLeft = `${layout.indent}px`
  }

  if (Number(layout.extraGap)) {
    // 在主题模块间距的基础上叠加，负值把模块整体上提
    style.marginTop = `calc(1.15em * var(--gap) + ${layout.extraGap}px)`
  }

  // 只有显式指定列数时才覆盖；'auto' 交给 SectionBody 切到流式排布
  if (layout.columns && layout.columns !== 'auto') {
    const template = `repeat(${layout.columns}, minmax(0, 1fr))`
    style[section.type === 'skills' ? '--bars-template' : '--grid-template'] = template
  }

  return style
}
