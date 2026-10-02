/**
 * 头像裁剪的几何计算，纯函数，可在 Node 下直测。
 *
 * 坐标约定：裁剪框尺寸为「框像素」，图片按 scale 缩放后平移 (dx, dy)。
 * dx/dy 都 ≤ 0（图片左上角不得进入框内），且缩放后的图片必须始终完整
 * 盖住裁剪框，不允许露底。
 */

/** 图片按 cover 方式铺满裁剪框所需的最小缩放（初始缩放） */
export function coverScale(imgW, imgH, frameW, frameH) {
  return Math.max(frameW / imgW, frameH / imgH)
}

/**
 * 平移边界收敛：图片不得露底（dx ≥ frameW - 渲染宽），也不得把内容
 * 拖离可视区（dx ≤ 0）。
 */
export function clampPan(dx, dy, imgW, imgH, scale, frameW, frameH) {
  const minX = frameW - imgW * scale
  const minY = frameH - imgH * scale
  return {
    dx: Math.min(0, Math.max(minX, dx)),
    dy: Math.min(0, Math.max(minY, dy)),
  }
}

/**
 * 判断图片比例与目标框是否一致（相对容差 1%）。
 * 一致时无需弹裁剪框，保持原上传体验。
 */
export function aspectMatches(imgW, imgH, frameW, frameH, tolerance = 0.01) {
  const target = frameW / frameH
  return Math.abs(imgW / imgH - target) <= tolerance * target
}

/**
 * 把当前框内可见区域换算成原图上的取样矩形，供 drawImage 精确裁剪。
 */
export function computeSourceRect(imgW, imgH, scale, dx, dy, frameW, frameH) {
  const sw = frameW / scale
  const sh = frameH / scale
  return {
    sx: Math.max(0, Math.min(imgW - sw, -dx / scale)),
    sy: Math.max(0, Math.min(imgH - sh, -dy / scale)),
    sw,
    sh,
  }
}
