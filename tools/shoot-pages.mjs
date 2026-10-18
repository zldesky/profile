/**
 * 给指定路径截图（公开页面的现状体检）。
 * 用法：node tools/shoot-pages.mjs [--base http://127.0.0.1:3001] [--w 1440,390]
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const baseFlag = argv.indexOf('--base')
const base = baseFlag >= 0 ? argv[baseFlag + 1] : 'http://127.0.0.1:3001'
const wFlag = argv.indexOf('--w')
const widths = (wFlag >= 0 ? argv[wFlag + 1] : '1440,390').split(',').map(Number)

const PAGES = [
  { path: '/', name: '首页(官网)' },
  { path: '/collection', name: '合集页' },
  { path: '/login', name: '登录页' },
]

const browser = await chromium.launch({ channel: 'msedge' })
const { mkdirSync } = await import('node:fs')
const dir = './tools/shots'
mkdirSync(dir, { recursive: true })

for (const w of widths) {
  const context = await browser.newContext({ viewport: { width: w, height: w > 600 ? 900 : 844 } })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 100))
  })
  for (const p of PAGES) {
    try {
      await page.goto(base + p.path, { waitUntil: 'networkidle', timeout: 30000 })
    } catch (e) {
      console.log(`  ${p.name} 打开失败: ${String(e.message).slice(0, 70)}`)
      continue
    }
    await page.waitForTimeout(900)
    const info = await page.evaluate(() => {
      // 卡片与内部纸张的真实宽度 → 换算出缩放比，判断缩略图是否可读
      const card = document.querySelector('.cc-card')
      const vp = document.querySelector('.cc-viewport')
      const paper = document.querySelector('.cc-paper')
      const cards = document.querySelectorAll('.cc-card')
      const first = card?.getBoundingClientRect()
      const grid = document.querySelector('.cl-grid') || card?.parentElement
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
      const txt = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
      return {
        url: location.pathname,
        chars: txt.length,
        head: txt.slice(0, 120),
        hasHeader: Boolean(document.querySelector('header')),
        h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 40),
        // 空状态标志
        emptyish: txt.length < 220,
        cols,
        cardW: first ? Math.round(first.width) : 0,
        paperW: paper ? Math.round(paper.getBoundingClientRect().width) : 0,
        paperH: paper ? Math.round(paper.getBoundingClientRect().height) : 0,
        vpW: vp ? Math.round(vp.getBoundingClientRect().width) : 0,
        vpH: vp ? Math.round(vp.getBoundingClientRect().height) : 0,
        cards: cards.length,
      }
    })
    const file = `${dir}/${p.name}-${w}.png`
    await page.screenshot({ path: file, fullPage: false })
    console.log(`  ${p.name} @${w}  → ${file}`)
    console.log(`      路径 ${info.url} · 正文 ${info.chars} 字 · h1=「${info.h1}」 · 卡片 ${info.cards}${info.emptyish ? '  ⚠ 内容很少（可能是空状态）' : ''}`)
    if (info.cols) {
      const scale = info.paperW && info.vpW ? Math.round((info.paperW / 794) * 100) : 0
      console.log(
        `      栅格 ${info.cols} 列 · 卡片 ${info.cardW}px · 视口 ${info.vpW}×${info.vpH} · 纸张渲染宽 ${info.paperW}px（缩放约 ${scale}%）`,
      )
    }
    console.log(`      开头：${info.head}`)
  }
  if (errors.length) console.log(`  控制台错误（${w}px）：${errors.slice(0, 4).join(' | ')}`)
  await context.close()
}
await browser.close()