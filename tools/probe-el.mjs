/**
 * 量单个元素的盒子与命中区域（配合 audit-ui.mjs 用的临时探针）。
 * 用法：node tools/probe-el.mjs <selector> [url]
 * 之所以单独写：改完点击目标后必须确认「视觉没被改动、命中区确实变大」，
 * 而不是改完就以为成了 —— 尤其 ::::-webkit-slider-runnable-track 这类
 * 替换元素的表现必须实测，光看 CSS 推断不出来。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const selector = process.argv[2]
const url = process.argv[3] || 'http://127.0.0.1:3001/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(600)

/** 命中判定：点在扩展区上时，命中的元素可能是控件本身，也可能是承载它的 label ——
 *  两者都算命中（点 label 一样会触发控件）。只报「是否可控」比只报盒子更接近可用性真相。 */
const hitReport = (el, x, y) => {
  const hit = document.elementFromPoint(x, y)
  if (!hit) return '无元素'
  if (hit === el) return '控件本身'
  if (el.contains(hit)) return '控件内部'
  if (el.closest('label') && el.closest('label').contains(hit)) return '承载 label'
  return '未命中(' + hit.tagName.toLowerCase() + ')'
}

const info = await page.evaluate(
  ([sel, hitFn]) => {
    const fn = new Function('el', 'x', 'y', 'return (' + hitFn + ')(el, x, y)')
    const list = [...document.querySelectorAll(sel)]
    return list.slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const label = el.closest('label')
      return {
        el:
          el.tagName.toLowerCase() +
          (typeof el.className === 'string' && el.className
            ? '.' + el.className.trim().split(/\s+/)[0]
            : ''),
        box: `${Math.round(r.width)}×${Math.round(r.height)}`,
        labelBox: label
          ? `${Math.round(label.getBoundingClientRect().width)}×${Math.round(label.getBoundingClientRect().height)}`
          : '无 label',
        hitTop: fn(el, cx, r.top - 6),
        hitBottom: fn(el, cx, r.bottom + 6),
        // 顺带报出这两个点上究竟是什么元素 —— 只说「未命中」不足以判断该改哪儿
        atTop: (() => {
          const h = document.elementFromPoint(cx, r.top - 6)
          return h ? h.tagName.toLowerCase() + '.' + String(h.className || '').split(' ')[0] : 'null'
        })(),
        atBottom: (() => {
          const h = document.elementFromPoint(cx, r.bottom + 6)
          return h ? h.tagName.toLowerCase() + '.' + String(h.className || '').split(' ')[0] : 'null'
        })(),
        liBox: (() => {
          const li = el.closest('li')
          if (!li) return '无 li'
          const lr = li.getBoundingClientRect()
          return Math.round(lr.width) + '×' + Math.round(lr.height)
        })(),
      }
    })
  },
  [selector, hitReport.toString()],
)

console.log(`探针 ${selector}  @390×844`)
for (const i of info) {
  console.log(`  ${i.el}   盒子 ${i.box}   承载 label ${i.labelBox}`)
  console.log(`    上方 6px: ${i.hitTop}（实际元素 ${i.atTop}）   下方 6px: ${i.hitBottom}（实际元素 ${i.atBottom}）`)
  console.log(`    外层 li 盒子: ${i.liBox}`)
}
if (!info.length) console.log('  （未找到该选择器，页面可能未渲染该元素）')
await browser.close()