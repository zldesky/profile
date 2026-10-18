/**
 * 量移动端布局：顶栏占多高、有没有按钮被挤出屏幕、重复控件在哪。
 * 用法：node tools/probe-mobile.mjs [url]
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/editor'
const WIDTHS = [390, 360, 320]

const browser = await chromium.launch({ channel: 'msedge' })
for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: 844 } })
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  // 关掉新手引导，否则它遮住界面、也干扰测量
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find(
      (b) => (b.textContent || '').trim() === '跳过引导',
    )
    if (skip) skip.click()
  })
  await page.waitForTimeout(400)

  const m = await page.evaluate(() => {
    const vw = window.innerWidth
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right) }
    }
    const label = (el) =>
      (el.tagName.toLowerCase() +
        (typeof el.className === 'string' && el.className
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '')) +
      '「' +
      (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '')
        .trim()
        .slice(0, 14) +
      '」'

    // 溢出视口的元素（右边界超出或左边界为负）
    const overflow = []
    for (const el of document.querySelectorAll('header *, .editor-topbar *')) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none') continue
      if (r.right > vw + 1 || r.left < -1) {
        overflow.push({ el: label(el), ...rect(el) })
      }
    }

    const topbar = document.querySelector('.editor-topbar')
    const main = document.querySelector('.editor-main')
    const toolbar = document.querySelector('.editor-tools')
    const panel = document.querySelector('.editor-panel')
    const stage = document.querySelector('.editor-stage')

    return {
      vw,
      topbar: topbar ? rect(topbar) : null,
      main: main ? rect(main) : null,
      toolbar: toolbar ? rect(toolbar) : null,
      panel: panel ? rect(panel) : null,
      stage: stage ? rect(stage) : null,
      // 顶栏有几行按钮（按 top 值分组）
      topbarRows: topbar
        ? new Set([...topbar.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top))).size
        : 0,
      topbarButtons: topbar ? topbar.querySelectorAll('button').length : 0,
      visibleButtons: [...document.querySelectorAll('.editor-topbar button')].filter((b) => {
        const r = b.getBoundingClientRect()
        return r.width > 2 && r.height > 2
      }).length,
      // 找出「比父级还宽」的元素，定位横向溢出的真凶
      wide: (() => {
        const out = []
        for (const el of document.querySelectorAll('.editor-main *')) {
          const r = el.getBoundingClientRect()
          if (r.width < 5) continue
          const ps = el.parentElement ? el.parentElement.getBoundingClientRect() : null
          if (ps && r.width > ps.width + 1) {
            out.push({
              el:
                el.tagName.toLowerCase() +
                (typeof el.className === 'string' && el.className
                  ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                  : ''),
              w: Math.round(r.width),
              pw: Math.round(ps.width),
              scrollW: el.scrollWidth,
            })
          }
        }
        return out.slice(0, 12)
      })(),
      overflowCount: overflow.length,
      overflow: overflow.slice(0, 10),
      buttonList: [...document.querySelectorAll('.editor-topbar button, .editor-topbar a')]
        .filter((b) => {
          const r = b.getBoundingClientRect()
          return r.width > 2 && r.height > 2
        })
        .map((b) => {
          const r = b.getBoundingClientRect()
          return {
            t: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
            label:
              (b.textContent || '').trim().slice(0, 12) ||
              (b.getAttribute('title') || '').slice(0, 12) ||
              (b.getAttribute('aria-label') || '').slice(0, 12) ||
              '(仅图标)',
          }
        }),
    }
  })

  console.log(`\n▌${w}px  （视口 ${m.vw}）`)
  console.log(`  顶栏 ${m.topbar ? m.topbar.w + '×' + m.topbar.h : '—'}   占视口高度的 ${m.topbar ? Math.round((m.topbar.h / 844) * 100) : 0}%`)
  console.log(`  顶栏按钮 ${m.topbarButtons} 个，排成 ${m.topbarRows} 行`)
  console.log(`  主体 ${m.main ? m.main.w + '×' + m.main.h : '—'}`)
  console.log(`  悬浮工具条 ${m.toolbar ? m.toolbar.w + '×' + m.toolbar.h + ' @' + m.toolbar.l : '无'}`)
  console.log(`  编辑面板 ${m.panel ? m.panel.w + '×' + m.panel.h : '（未显示）'}`)
  console.log(`  预览舞台 ${m.stage ? m.stage.w + '×' + m.stage.h : '（未显示）'}`)
  console.log(`  溢出视口的元素 ${m.overflowCount} 个`)
  if (m.wide.length) {
    console.log(`  比父级更宽的元素（横向溢出的真凶）：`)
    for (const x of m.wide) console.log(`      ${x.w} > 父 ${x.pw}  scrollW=${x.scrollW}  ${x.el}`)
  }
  for (const o of m.overflow) {
    console.log(`      ${o.w}×${o.h} left=${o.l} right=${o.r}  ${o.el}`)
  }
  // 按行分组列出按钮，看清哪一行放了什么
  const rows = new Map()
  for (const b of m.buttonList) {
    if (!rows.has(b.t)) rows.set(b.t, [])
    rows.get(b.t).push(b)
  }
  console.log(`  顶栏按钮逐行：`)
  for (const [top, list] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const sum = list.reduce((n, x) => n + x.w, 0)
    console.log(`      y=${top}  ${list.length} 个，宽合计 ${sum}：${list.map((x) => x.label + '(' + x.w + ')').join(' ')}`)
  }
  await page.close()
}
await browser.close()