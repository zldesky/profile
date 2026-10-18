/**
 * 验证右侧内容面板的拖拽排序。
 * 用法：node tools/verify-drag.mjs [url]
 *
 * 覆盖两级：
 *  1. **模块卡片**换序；
 *  2. **模块内条目**换序（体验 / 项目等 entries 模块里的「第 N 段」）。
 * 两者都是纯交互，静态审计看不到、单测不挂载组件，所以必须真的拖一次。
 *
 * 一个反复踩到的前提：卡片/条目在面板里可能**远在视口之外**
 * （实测模块手柄 y=1918 而窗口仅 900 高），不先滚进视口的话鼠标事件落空，
 * 会被误判成「拖拽没生效」。所以每次拖之前都先 scrollIntoView。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 110)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 110))
})

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
  if (s) s.click()
})
await page.waitForTimeout(400)

const sectionIds = () =>
  page.evaluate(() => [...document.querySelectorAll('.ed-card')].map((c) => c.dataset.sectionId))

/**

/**
 * 一次性取两个元素的中心点。
 * 不能用 centerOf 分别取：它为每个元素各做一次 scrollIntoView，
 * 第二次滚动会把第一次量到的坐标作废 —— 拖动就从错误的位置开始，
 * 表现出来就是「拖了但没反应」。这是本轮第三次栽在坐标系上。
 */
async function centersOf(fromSel, fromIdx, toSel, toIdx, anchor = 'from') {
  return page.evaluate(
    ({ a, ai, b, bi, anchorEl }) => {
      const ea = [...document.querySelectorAll(a)][ai]
      const eb = [...document.querySelectorAll(b)][bi]
      if (!ea || !eb) return null
      /*
       * 滚一次、同时读两点。以谁为准可选：
       * 条目拖拽要以**目标**为准 —— 条目在卡片内部，以源为准时第二段会落到
       * 折叠线以下（实测 to.y=1193，视口只有 900），鼠标拖到那儿等于没拖到。
       */
      ;(anchorEl === 'to' ? eb : ea).scrollIntoView({ block: 'center' })
      const ra = ea.getBoundingClientRect()
      const rb = eb.getBoundingClientRect()
      const vis = (r) => r.top > 0 && r.bottom < window.innerHeight
      return {
        from: { x: ra.x + ra.width / 2, y: ra.y + ra.height / 2 },
        to: { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 },
        fromVisible: vis(ra),
        toVisible: vis(rb),
      }
    },
    { a: fromSel, ai: fromIdx, b: toSel, bi: toIdx, anchorEl: anchor },
  )
}

async function drag(from, to) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 20, from.y + ((to.y - from.y) * i) / 20)
    await page.waitForTimeout(35)
  }
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(800)
}

let pass = 0

/* ---------------- 1. 模块卡片换序 ---------------- */
console.log('① 模块卡片拖拽：')
const beforeIds = await sectionIds()
{
  const pts = await centersOf('.ed-card .ed-drag', 0, '.ed-card', 2)
  if (!pts) {
    console.log('  *** 找不到卡片或手柄')
  } else {
    console.log(`  源 ${Math.round(pts.from.x)},${Math.round(pts.from.y)}(可见=${pts.fromVisible}) → 目标 ${Math.round(pts.to.x)},${Math.round(pts.to.y)}(可见=${pts.toVisible})`)
    await drag(pts.from, pts.to)
    const afterIds = await sectionIds()
    const changed = JSON.stringify(beforeIds) !== JSON.stringify(afterIds)
    if (changed) pass += 1
    console.log(`  ${changed ? '✓' : '***'} 顺序 ${changed ? '已改变' : '未变'}`)
  }
}

/* ---------------- 2. 模块内条目换序 ---------------- */
console.log('\n② 模块内条目拖拽：')
// 展开一个 entries 模块的卡片（含「第 N 段」）
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.ed-card')]
  const withEntries = cards.find((c) => /第 \d+ 段/.test(c.innerText || ''))
  if (withEntries) {
    withEntries.scrollIntoView({ block: 'center' })
    return
  }
  /*
   * 展开卡片要点 .expand —— 那是唯一绑了 toggle 的元素。
   * 先前写 `card.querySelector('button')` 点到的是别的按钮（可见性开关等），
   * 卡片根本没展开，于是报「找不到条目」。
   */
  for (const card of cards.slice(0, 5)) card.querySelector('.expand')?.click()
})
await page.waitForTimeout(800)

const entryInfo = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.entry-list')].find((l) =>
    /第 \d+ 段/.test(l.innerText || ''),
  )
  if (!list) return null
      // 取条目「身份」用真实内容（公司/职位等），不能用按位置现算的「第 N 段」
      const entryKey = (el) =>
        [...el.querySelectorAll('input, textarea')]
          .map((i) => String(i.value || '').trim())
          .filter(Boolean)
          .slice(0, 2)
          .join('/') || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16)
  const entries = [...list.children]
  return {
    count: entries.length,
    handles: list.querySelectorAll('.ed-drag').length,
    labels: entries.map((e) => entryKey(e)),
  }
})
console.log(
  `  条目列表: ${entryInfo ? `${entryInfo.count} 段，手柄 ${entryInfo.handles} 个` : '未找到（可能没有多段经历）'}`,
)

if (entryInfo && entryInfo.count >= 2 && entryInfo.handles >= 2) {
  const beforeLabels = entryInfo.labels
  const pts = await centersOf('.entry-list > * .ed-drag', 1, '.entry-list > *', 0, 'to')
  if (pts) {
    console.log(`  源 ${Math.round(pts.from.x)},${Math.round(pts.from.y)}(可见=${pts.fromVisible}) → 目标 ${Math.round(pts.to.x)},${Math.round(pts.to.y)}(可见=${pts.toVisible})`)
    await drag(pts.from, pts.to)
    const afterLabels = await page.evaluate(() => {
      const entryKey = (el) =>
        [...el.querySelectorAll('input, textarea')]
          .map((i) => String(i.value || '').trim())
          .filter(Boolean)
          .slice(0, 2)
          .join('/') || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16)
      const list = [...document.querySelectorAll('.entry-list')].find((l) =>
        /第 \d+ 段/.test(l.innerText || ''),
      )
      return [...(list?.children || [])].map((e) => entryKey(e))
    })
    const changed = JSON.stringify(beforeLabels) !== JSON.stringify(afterLabels)
    if (changed) pass += 1
    console.log(`  ${changed ? '✓' : '***'} 条目顺序 ${changed ? '已改变' : '未变'}`)
    console.log(`      拖前: ${beforeLabels.join(' | ')}`)
    console.log(`      拖后: ${afterLabels.join(' | ')}`)
  } else {
    console.log('  *** 拿不到手柄或目标坐标')
  }
} else {
  console.log('  *** 条目不足 2 段，无法验证换序')
}

console.log('')
console.log(`拖拽验证：${pass}/2 项通过`)
console.log('运行时错误:', errors.length ? errors.join(' | ') : '无')

await browser.close()
process.exit(pass === 2 ? 0 : 1)