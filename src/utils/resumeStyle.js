/**
 * 简历纸张的样式计算（纯函数，无 Vue 依赖）。
 * 编辑器 store 与分享只读页共用，保证「分享出去的」和「编辑器里的」像素级一致。
 */
import { FONTS, PAGE } from '@/data/presets'
import { clamp, hexToRgb } from '@/utils/helpers'

/**
 * 纸张容器的 CSS 变量（主色、字体、字号、头像几何等）。
 * @param {object} resume 已 normalize 的简历对象
 */
export function computePageStyle(resume) {
  const t = resume.theme
  const basics = resume.basics

  // 底边线按百分比长度换算起始偏移：居中和右对齐时需扣除自身长度
  const lineWidth = clamp(Number(t.titleBottomWidth) || 0, 10, 100)
  const lineLeft =
    t.titleBottomAlign === 'center'
      ? `${(100 - lineWidth) / 2}%`
      : t.titleBottomAlign === 'right'
        ? `${100 - lineWidth}%`
        : '0%'

  /** 头像当前偏在哪一侧，决定正文从哪边避让 */
  const contentWidthMm = PAGE.width - t.mh * 2
  const width = Number(basics.avatarWidth) || 0
  const dx = Number(basics.avatarPos?.dx) || 0
  const left = contentWidthMm - width + dx
  const side = left >= contentWidthMm / 2 ? 'right' : 'left'

  // 头像绝对定位、不占横向空间，占位宽度就是它本身的宽度
  const gap = 4
  const pad =
    side === 'right'
      ? { left: 0, right: Math.max(0, contentWidthMm - left + gap) }
      : { left: Math.max(0, left + width + gap), right: 0 }
  const bodyWidthMm = contentWidthMm - pad.left - pad.right

  return {
    '--accent': t.accent,
    '--accent-rgb': hexToRgb(t.accent),
    '--text': t.text,
    '--font': FONTS[t.fontKey]?.stack || FONTS.yahei.stack,
    '--fs': t.fs,
    '--lh': t.lh,
    '--gap': t.gap,
    '--mv': `${t.mv}mm`,
    '--mh': `${t.mh}mm`,
    '--avatar-w': `${basics.avatarWidth}mm`,
    '--avatar-h': `${basics.avatarHeight}mm`,
    '--avatar-dx': `${Number(basics.avatarPos?.dx) || 0}mm`,
    '--avatar-dy': `${Number(basics.avatarPos?.dy) || 0}mm`,
    // 向下拖拽时撑开页头高度，避免压到下方模块
    '--avatar-extra-h': `${Math.max(0, Number(basics.avatarPos?.dy) || 0)}mm`,
    '--avatar-pad-left': `${pad.left}mm`,
    '--avatar-pad-right': `${pad.right}mm`,
    // 正文被头像挤到不足 120mm 时，联系方式退回单列而不是两列硬挤
    '--contact-cols': bodyWidthMm < 120 ? '1' : '2',

    '--title-gap': `${t.titleGap}em`,
    '--title-margin': `${t.titleMargin}em`,
    '--title-line-w': `${lineWidth}%`,
    '--title-line-left': lineLeft,
    '--title-line-size': `${t.titleBottomThickness}px`,
    '--title-line-gap': `${t.titleBottomGap}px`,
  }
}

/** 打印页边距的 @page 规则，注入到 document 供打印与渲染服务使用 */
export function computePrintCss(resume) {
  const t = resume.theme
  return `@page{size:A4;margin:${t.mv}mm ${t.mh}mm;}`
}
