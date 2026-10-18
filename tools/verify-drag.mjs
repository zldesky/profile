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

let passCount = 0

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
    if (changed) passCount += 1
    console.log(`  ${changed ? '✓' : '***'} 顺序 ${changed ? '已改变' : '未变'}`)
  }
}

/* ---------------- 2. 各列表型模块内的条目换序 ---------------- */

/**
 * 取容器内每个子项的「身份」用于比对顺序。
 * 不能用「第 N 段」这类按位置现算的文本 —— 换序后它仍然是 第1段|第2段，
 * 会把「顺序已变」误判成「未变」。改用输入框里的真实值（公司 / 职位 / 标签 / 技能名）。
 * 排除 range：技能熟练度滑块的 value 是百分比，不表示条目身份。
 */

// 展开全部卡片，让各类模块的列表都渲染出来
await page.evaluate(() => {
  for (const card of [...document.querySelectorAll('.ed-card')].slice(0, 8)) {
    card.querySelector('.expand')?.click()
  }
})
await page.waitForTimeout(900)

const lists = await page.evaluate(() => {
  const out = []
  for (const sel of ['.entry-list', '.ed-sub-list']) {
    ;[...document.querySelectorAll(sel)].forEach((el, i) => {
      const kids = [...el.children]
      if (kids.length >= 2 && el.querySelectorAll('.ed-drag').length >= 2) {
        out.push({ sel, i, count: kids.length })
      }
    })
  }
  return out
})
console.log(`\n② 列表型模块内条目拖拽：共发现 ${lists.length} 个可拖列表`)

let listPass = 0
for (const { sel, i, count } of lists) {
  const labelsOf = () =>
    page.evaluate(
      ({ sel: s2, i: i2 }) => {
        const key = (el) =>
          [...el.querySelectorAll('input:not([type=range]), textarea')]
            .map((n) => String(n.value || '').trim())
            .filter(Boolean)
            .slice(0, 2)
            .join('/') || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16)
        const el = [...document.querySelectorAll(s2)][i2]
        return [...(el?.children || [])].map((c) => key(c))
      },
      { sel, i },
    )

  const before = await labelsOf()
  const pts = await page.evaluate(
    ({ sel: s2, i: i2 }) => {
      const list = [...document.querySelectorAll(s2)][i2]
      const kids = [...list.children]
      const h = kids[1]?.querySelector('.ed-drag')
      if (!h) return null
      kids[0].scrollIntoView({ block: 'center' })
      const rh = h.getBoundingClientRect()
      const rt = kids[0].getBoundingClientRect()
      return {
        from: { x: rh.x + rh.width / 2, y: rh.y + rh.height / 2 },
        to: { x: rt.x + rt.width / 2, y: rt.y + rh.height / 2 },
      }
    },
    { sel, i },
  )
  if (!pts) {
    console.log(`  *** ${sel}[${i}] 拿不到手柄坐标`)
    continue
  }
  await drag(pts.from, pts.to)
  const after = await labelsOf()
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  if (changed) listPass += 1
  console.log(
    `  ${changed ? '✓' : '***'} ${sel}[${i}]（${count} 项）${changed ? '已改变' : '未变'}`,
  )
  if (!changed) console.log(`      前后都是: ${before.join(' | ')}`)
}

/* ---------------- 汇总 ---------------- */
const pass = passCount + listPass
const total = 1 + lists.length

console.log('')
console.log(
  `拖拽验证：${pass}/${total} 项通过（模块卡片 ${passCount}/1 · 列表内条目 ${listPass}/${lists.length}）`,
)
console.log('运行时错误:', errors.length ? errors.join(' | ') : '无')

await browser.close()
process.exit(pass === total && !errors.length ? 0 : 1)