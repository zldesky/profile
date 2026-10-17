/**
 * 真实浏览器度量（一次性审计脚本，不进构建）。
 *
 * 起因：静态 grep 只能查「写法」（transition:all、渐变颜色），查不出「渲染结果」。
 * 界面真正的毛病——对比度不够、点击目标太小、键盘焦点看不见、换行处拥挤——
 * 都得在真的浏览器里量。思路来自开源清单 taste-skill 的 scripts/inspect.mjs
 * （它就是「真的渲染、真的量、真的截图」），但那个脚本是为落地页写的
 * （量 hero 行数、空白屏占比），对编辑器应用不对症，所以这里按同样思路做了对症版。
 *
 * 用法：node tools/audit-ui.mjs [url]
 * 依赖：本机 Edge（与 PDF 渲染同一个内核）+ playwright-core。
 * 注意 playwright-core 装在 server/node_modules（PDF 渲染用它），
 * 根目录没有，因此从那个路径直接导入，不额外给根项目加一份依赖。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv[2] || 'http://127.0.0.1:3001/'
/** 桌面两档 + 手机一档；断点在 900px，所以要跨过它看 */
const WIDTHS = [
  { w: 1440, h: 900, name: '桌面' },
  { w: 1024, h: 800, name: '窄桌面' },
  { w: 390, h: 844, name: '手机' },
]
/** WCAG AA：正文 4.5，大字号（≥18.66px 粗体或 ≥24px）3.0，图形与控件边界 3.0 */
const AA_TEXT = 4.5
const AA_LARGE = 3
/** 触屏最小点击目标；WCAG 2.2 AA 为 24，iOS/Android 人机指南推荐 44 */
const MIN_TAP = 24

/**
 * 在页面里跑的采集逻辑，返回纯数据。
 * 阈值必须作为参数传入：page.evaluate 的函数体是在浏览器里求值的，
 * 拿不到本模块作用域的常量（第一版就踩了这个，报 AA_TEXT is not defined）。
 */
function collect(limits) {
  const { AA_TEXT, AA_LARGE, MIN_TAP } = limits
  const px = (v) => Number.parseFloat(v) || 0

  function parseColor(css) {
    const m = css.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,/]/).map((s) => s.trim())
    return {
      r: px(p[0]),
      g: px(p[1]),
      b: px(p[2]),
      a: p[3] === undefined ? 1 : px(p[3]),
    }
  }

  /** 把半透明前景合成到背景上，否则半透明文字会被算成低对比 */
  function over(fg, bg) {
    const a = fg.a
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    }
  }

  function luminance(c) {
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }

  function ratio(fg, bg) {
    const a = luminance(fg)
    const b = luminance(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }

  /**
   * 向上找到第一个不透明的背景色；页面根节点兜底为白。
   *
   * 遇到渐变直接返回 null（该项跳过）：渐变写在 background-image 上，
   * background-color 是 transparent，脚本按「透明就继续往上找」会一路找成白底，
   * 于是白字配深色渐变按钮被算成 1.0 —— 第一版就这样误报了两处。
   * 渐变要逐像素取样才准，不值得为此把脚本做复杂：宁可漏报，不可误报。
   */
  function effectiveBg(el) {
    let node = el
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node)
      if (s.backgroundImage && s.backgroundImage !== 'none') return null
      const c = parseColor(s.backgroundColor)
      if (c && c.a > 0.95) return c
      node = node.parentElement
    }
    const html = getComputedStyle(document.documentElement)
    const body = getComputedStyle(document.body)
    if (html.backgroundImage !== 'none' || body.backgroundImage !== 'none') return null
    const h = parseColor(html.backgroundColor)
    if (h && h.a > 0.95) return h
    const b = parseColor(body.backgroundColor)
    if (b && b.a > 0.95) return b
    return { r: 255, g: 255, b: 255, a: 1 }
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && px(s.opacity) > 0.05
  }

  const label = (el) =>
    (el.tagName.toLowerCase() +
      (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '')).slice(0, 54)

  /* ---------- 1. 文字对比度 ---------- */
  const contrast = []
  const seenText = new Set()
  for (const el of document.querySelectorAll('body *')) {
    // 只取直接含文字的元素，避免父节点重复计入
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own || !visible(el)) continue
    const s = getComputedStyle(el)
    const fg = parseColor(s.color)
    if (!fg) continue
    const key = label(el) + s.fontSize
    if (seenText.has(key)) continue
    seenText.add(key)

    const bg = effectiveBg(el)
    if (!bg) continue // 背景是渐变，本脚本不判（见 effectiveBg 的说明）
    const r = ratio(over(fg, bg), bg)
    const size = px(s.fontSize)
    const bold = px(s.fontWeight) >= 700
    const large = size >= 24 || (bold && size >= 18.66)
    const need = large ? AA_LARGE : AA_TEXT
    if (r < need) {
      contrast.push({
        el: label(el),
        text: (el.textContent || '').trim().slice(0, 30),
        ratio: Math.round(r * 100) / 100,
        need,
        size: Math.round(size * 10) / 10,
      })
    }
  }

  /* ---------- 2. 点击目标尺寸 ---------- */
  const small = []
  const seenTap = new Set()
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    const w = Math.round(r.width)
    const h = Math.round(r.height)
    const key = label(el)
    if (seenTap.has(key + w + h)) continue
    seenTap.add(key + w + h)
    if (w >= MIN_TAP && h >= MIN_TAP) continue

    /*
     * 盒子偏小之后要复核「真实可控区域」，否则会稳定误报两类最常见的
     * 「看着小、其实好点」：
     *  - 用伪元素扩过命中区的（引导圆点，盒子 7×7 但上下各 6px 仍命中它）；
     *  - 包在 label 里的复选框（点 label 一样触发，该按 label 的高度算）。
     * 判定「可触发该控件」时，命中它自己、它的内部、或承载它的 label 都算。
     */
    const cx = r.left + r.width / 2
    const triggers = (y) => {
      const hit = document.elementFromPoint(cx, y)
      if (!hit) return false
      if (hit === el || el.contains(hit)) return true
      const lb = el.closest('label')
      return Boolean(lb && lb.contains(hit))
    }
    const extended = triggers(r.top - 6) && triggers(r.bottom + 6)
    const lb = el.closest('label')
    const labelH = lb ? Math.round(lb.getBoundingClientRect().height) : 0
    if (extended || labelH >= MIN_TAP) continue

    small.push({ el: key, w, h, labelH })
  }

  /* ---------- 3. 键盘焦点可见性 ---------- */
  const focusables = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(visible)
    .slice(0, 25)

  /* ---------- 4. 令牌实际生效情况 ---------- */
  const root = getComputedStyle(document.documentElement)
  const tokens = ['--ed-radius-sm', '--ed-radius-xl', '--ed-line-3', '--ed-text-5', '--ed-overlay', '--ed-canvas']
  const tokenState = tokens.map((t) => ({ token: t, value: (root.getPropertyValue(t) || '').trim().slice(0, 40) }))

  /* ---------- 5. 文本溢出 / 拥挤（真实排版问题） ---------- */
  const overflowing = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const s = getComputedStyle(el)
    if (s.overflow === 'visible' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (own) overflowing.push({ el: label(el), text: (el.textContent || '').trim().slice(0, 24), scrollW: el.scrollWidth, clientW: el.clientWidth })
    }
  }

  return { contrast, small, focusables: focusables.length, tokenState, overflowing, title: document.title, bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60) }
}

const browser = await chromium.launch({ channel: 'msedge' })
const report = { url, viewports: [], focus: [], errors: [] }

for (const vp of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } })
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(`[${vp.name}] ${m.text().slice(0, 120)}`)
  })
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  } catch (e) {
    report.errors.push(`[${vp.name}] 打开失败: ${String(e.message).slice(0, 100)}`)
  }
  await page.waitForTimeout(600)
  const data = await page.evaluate(collect, { AA_TEXT, AA_LARGE, MIN_TAP })
  report.viewports.push({ ...vp, ...data, finalUrl: page.url() })
  if (vp.name === '桌面') {
    // 键盘焦点：逐个 Tab，看获得焦点的元素有没有可见的 outline / box-shadow
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab')
      const f = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const s = getComputedStyle(el)
        const outline = s.outlineStyle !== 'none' && Number.parseFloat(s.outlineWidth) > 0
        const ring = s.boxShadow !== 'none'
        return {
          el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''),
          visible: outline || ring,
          how: outline ? 'outline' : ring ? 'box-shadow' : '无',
        }
      })
      if (f) report.focus.push(f)
    }
  }
  await page.close()
}

await browser.close()

/* ---------------- 输出 ---------------- */
const line = (s) => console.log(s)
line(`UI 审计  ${report.url}`)
line('='.repeat(72))
for (const v of report.viewports) {
  line(`\n▌${v.name} ${v.w}×${v.h}   （${v.finalUrl}）`)
  line(`  对比度不足 : ${v.contrast.length} 处`)
  for (const c of v.contrast.slice(0, 12)) {
    line(`      ${c.ratio} (需 ${c.need})  ${c.size}px  ${c.el}  「${c.text}」`)
  }
  // 注意：这里量的是元素盒子。用伪元素扩展过命中区的元素（如引导圆点）会在此误报，
  // 其真实命中区要用 tools/probe-el.mjs 的 elementFromPoint 验证。
  line(`  点击目标不达标(<${MIN_TAP}px，已复核真实可控区): ${v.small.length} 处`)
  for (const s of v.small.slice(0, 10)) line(`      盒子 ${s.w}×${s.h}  承载 label 高 ${s.labelH}  ${s.el}`)
  line(`  文本溢出    : ${v.overflowing.length} 处`)
  for (const o of v.overflowing.slice(0, 8)) line(`      ${o.scrollW}>${o.clientW}  ${o.el}  「${o.text}」`)
  if (v.name === '桌面') {
    line(`  正文首选字体: ${v.bodyFont}`)
    line(`  令牌生效    :`)
    for (const t of v.tokenState) line(`      ${t.token.padEnd(16)} ${t.value || '*** 空 ***'}`)
  }
}
line(`\n▌键盘焦点（前 ${report.focus.length} 次 Tab）`)
const noFocus = report.focus.filter((f) => !f.visible)
line(`  不可见 : ${noFocus.length} / ${report.focus.length}`)
for (const f of report.focus) line(`      ${f.visible ? '可见' : '*** 不可见 ***'}  ${f.how.padEnd(10)} ${f.el}`)
if (report.errors.length) {
  line(`\n▌控制台错误 ${report.errors.length} 条`)
  for (const e of report.errors.slice(0, 8)) line('      ' + e)
}
line('')