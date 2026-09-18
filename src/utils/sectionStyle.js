/**
 * 把模块的位置与对齐设置换算成作用于 .r-sec 的内联样式。
 *
 * 未设置的项一律留空，让主题变量与样式表默认值继续生效，
 * 避免内联样式把主题里的全局调整「锁死」。
 */

/** 内容对齐到 flex 主轴分布的映射 */
const ALIGN_MAP = {
  left: { text: 'left', item: 'flex-start' },
  center: { text: 'center', item: 'center' },
  right: { text: 'right', item: 'flex-end' },
  justify: { text: 'justify', item: 'flex-start' },
}

/**
 * @param {object} section 模块数据
 * @returns {object} 可直接绑定到 :style 的对象
 */
export function sectionLayoutStyle(section) {
  const layout = section.layout || {}
  const style = {}

  const align = ALIGN_MAP[layout.align]
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
