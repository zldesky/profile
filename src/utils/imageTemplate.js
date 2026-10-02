/**
 * 从简历图片推断版式骨架与主色。
 *
 * 「图片生成模板」的核心：把一张参考简历截图映射到自由定制模板的
 * customLayout 参数（mode / ratio / header）与主题主色，生成一份可继续
 * 微调的「自己的模板」。只依赖传入的 RGBA 像素，纯函数，可在 Node 下直测。
 *
 * 推断策略（启发式，宁缺毋滥：识别不了的维度一律返回 null，保留用户现状）：
 * - 通栏色带：上 16% 区域颜色均匀且非白 → header = 'banner'
 * - 左右侧栏：左右 30% 列（避开页头）颜色均匀且非白 → mode = 'railLeft' / 'railRight'
 * - 双栏：正文区存在贯穿上下的纵向留白沟，沟两侧都有内容 → mode = 'split'，
 *   沟的位置就近取 28 / 34 / 40 档位
 * - 主色：上述色块中「饱和度或深度」最突出者；全图无色块则不动主色
 */

/** 视为纸面白的最低通道值 */
const WHITE_MIN = 238
/** 区域内通道标准差低于该值视为纯色块 */
const UNIFORM_STD = 14
/** 有彩度：最大最小通道差 */
const SAT_MIN = 36
/** 或足够深（深灰侧栏无彩度也成立） */
const DARK_MAX = 110

/** 每个区域两条轴最多采样点数，控制大图开销 */
const SAMPLES_PER_AXIS = 48

/**
 * 区域统计：均值颜色、通道标准差、饱和度、亮度。
 * @param {Uint8ClampedArray} data RGBA 像素
 */
function regionStats(data, width, x0, y0, x1, y1) {
  const stepX = Math.max(1, Math.floor((x1 - x0) / SAMPLES_PER_AXIS))
  const stepY = Math.max(1, Math.floor((y1 - y0) / SAMPLES_PER_AXIS))
  let count = 0
  const sums = [0, 0, 0]
  const sqSums = [0, 0, 0]
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = data[i + c]
        sums[c] += v
        sqSums[c] += v * v
      }
      count++
    }
  }
  const mean = sums.map((s) => s / count)
  const std = sqSums.reduce((acc, s, c) => acc + Math.sqrt(s / count - mean[c] * mean[c]), 0) / 3
  const sat = Math.max(...mean) - Math.min(...mean)
  const lum = 0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2]
  return { mean, std, sat, lum }
}

function isSolidColor(region) {
  return (
    region.std < UNIFORM_STD &&
    !region.mean.every((v) => v >= WHITE_MIN) &&
    (region.sat >= SAT_MIN || region.lum <= DARK_MAX)
  )
}

function toHex(mean) {
  return `#${mean
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** 色块作为主色候选的打分：彩度优先，深色块次之 */
function accentScore(region) {
  if (region.sat >= SAT_MIN) return region.sat
  if (region.lum <= DARK_MAX) return 80 - region.lum * 0.25
  return -1
}

/**
 * 在正文区找贯穿的纵向留白沟（双栏分隔）。
 * 返回沟的起止 x（比例）或 null；要求沟两侧都有足够的内容密度。
 */
function findGutter(data, width, height) {
  const y0 = Math.floor(height * 0.25)
  const y1 = Math.floor(height * 0.9)
  if (y1 - y0 < 8) return null

  const rows = Math.ceil((y1 - y0) / 2)
  const colWhite = new Array(width).fill(0)
  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (Math.min(data[i], data[i + 1], data[i + 2]) >= WHITE_MIN) colWhite[x]++
    }
  }

  // 只在 15%~75% 宽度范围内找沟，避开两侧页边距
  const searchStart = Math.floor(width * 0.15)
  const searchEnd = Math.floor(width * 0.75)
  let best = null
  let runStart = -1
  for (let x = searchStart; x <= searchEnd; x++) {
    const isWhiteCol = x < searchEnd && colWhite[x] >= rows
    if (isWhiteCol && runStart < 0) runStart = x
    if ((!isWhiteCol || x === searchEnd) && runStart >= 0) {
      const runEnd = x
      const widthRatio = (runEnd - runStart) / width
      // 沟宽占版心 1%~14% 才像分栏，太宽更像页边距
      if (
        widthRatio >= 0.01 &&
        widthRatio <= 0.14 &&
        (!best || runEnd - runStart > best.end - best.start)
      ) {
        best = { start: runStart, end: runEnd }
      }
      runStart = -1
    }
  }
  if (!best) return null

  const hasInk = (x0, x1) => {
    let nonWhite = 0
    let total = 0
    for (let y = y0; y < y1; y += 3) {
      for (let x = Math.floor(x0); x < x1; x += 2) {
        const i = (y * width + x) * 4
        total++
        if (Math.min(data[i], data[i + 1], data[i + 2]) < WHITE_MIN) nonWhite++
      }
    }
    return total > 0 && nonWhite / total > 0.12
  }

  // 沟两侧都得有内容，纯页边距不算分栏
  if (!hasInk(width * 0.03, best.start) || !hasInk(best.end, width * 0.97)) return null
  return best
}

/**
 * 从顶部往下找连续的「色带行」：每一行内主色（按 32 级量化分桶）占比过半
 * 且主色非白。页头里混着姓名文字、头像也能通过——它们只是少数像素。
 * 色带通常只占页面高 10%~15%，因此不能框定固定区域做整体统计。
 * 返回色带主色与行数占比，未找到返回 null。
 */
function detectTopBanner(data, width, height) {
  const maxRows = Math.floor(height * 0.3)
  if (maxRows < 4) return null

  const stepX = Math.max(1, Math.floor(width / SAMPLES_PER_AXIS))
  let bannerRows = 0
  let bannerColor = null

  for (let y = 0; y < maxRows; y++) {
    const buckets = new Map()
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4
      const key = `${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`
      const bucket = buckets.get(key) || { count: 0, sums: [0, 0, 0] }
      bucket.count++
      bucket.sums[0] += data[i]
      bucket.sums[1] += data[i + 1]
      bucket.sums[2] += data[i + 2]
      buckets.set(key, bucket)
    }
    let dominant = null
    for (const bucket of buckets.values()) {
      if (!dominant || bucket.count > dominant.count) dominant = bucket
    }
    const color = dominant.sums.map((s) => s / dominant.count)
    const majority = dominant.count / Math.ceil(width / stepX)
    // 主色过半且非白才算色带行；遇到页边距或正文行即停
    if (majority < 0.55 || Math.min(...color) >= WHITE_MIN) break
    bannerRows = y + 1
    bannerColor = color
  }

  const ratio = bannerRows / height
  if (ratio < 0.08 || !bannerColor) return null
  return { color: bannerColor, ratio }
}

/** 就近取窄栏宽度档位 */
function nearestRatio(startRatio) {
  return ['28', '34', '40'].reduce((best, option) =>
    Math.abs(Number(option) - startRatio) < Math.abs(Number(best) - startRatio) ? option : best,
  )
}

/**
 * @param {Uint8ClampedArray} data 画布像素（RGBA）
 * @param {number} width
 * @param {number} height
 * @returns {{ mode: string|null, ratio: string|null, header: string|null, accent: string|null, findings: string[] }}
 */
export function analyzeResumeImage(data, width, height) {
  const findings = []
  const result = { mode: null, ratio: null, header: null, accent: null }

  const left = regionStats(
    data,
    width,
    0,
    Math.floor(height * 0.2),
    Math.floor(width * 0.3),
    Math.floor(height * 0.95),
  )
  const right = regionStats(
    data,
    width,
    Math.floor(width * 0.7),
    Math.floor(height * 0.2),
    width,
    Math.floor(height * 0.95),
  )

  const candidates = []
  const banner = detectTopBanner(data, width, height)
  if (banner) {
    result.header = 'banner'
    const sat = Math.max(...banner.color) - Math.min(...banner.color)
    const lum = 0.299 * banner.color[0] + 0.587 * banner.color[1] + 0.114 * banner.color[2]
    candidates.push({ mean: banner.color, sat, lum })
    findings.push('识别到通栏色带页头')
  }

  const leftSolid = isSolidColor(left)
  const rightSolid = isSolidColor(right)
  if (leftSolid && !rightSolid) {
    result.mode = 'railLeft'
    candidates.push(left)
    findings.push('识别到左侧色栏')
  } else if (rightSolid && !leftSolid) {
    result.mode = 'railRight'
    candidates.push(right)
    findings.push('识别到右侧色栏')
  } else {
    const gutter = findGutter(data, width, height)
    if (gutter) {
      result.mode = 'split'
      result.ratio = nearestRatio(Math.round((gutter.start / width) * 100))
      findings.push(`识别到双栏版式（窄栏约 ${result.ratio}%）`)
    }
  }

  if (candidates.length) {
    const accent = candidates.reduce((best, item) =>
      accentScore(item) > accentScore(best) ? item : best,
    )
    result.accent = toHex(accent.mean)
    findings.push(`主色取自色块（${result.accent}）`)
  } else {
    findings.push('未发现明显色块，保留当前主色')
  }

  return { ...result, findings }
}
