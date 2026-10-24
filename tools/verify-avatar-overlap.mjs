/**
 * 探针：头像拖到各极限位置后，是否遮盖纸面其他文字。
 *
 * 用法：node tools/probe-avatar-overlap.mjs [url]
 *   默认连 http://localhost:5173/editor（先 npm run dev）
 *
 * 把「头像不能压住其他文字」固化成能失败的断言（用户原话：拖拽头像不能遮盖其他文字）。
 * 设计承诺（见头像设置里的说明文字）：水平边界取自头像所在容器，向下最多让出一个
 * 头像的高度、页头等量撑高 —— 即拖拽限制本身就应保证不遮盖；本探针在**真实拖到极限**
 * 后量几何，验证承诺真的成立，而不是读代码相信注释。
 *
 * 判据：头像矩形与「正文模块（.r-sec）」及「页头文字（姓名/职位/联系方式）」的
 * 交集面积 > 4px² 记为遮盖（1-2px 的描边级贴合不算）。断言会打印它量的是谁。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`))

let pass = 0
const failed = []
const log = (ok, message) => {
  if (ok) {
    pass += 1
    console.log(`  [ok] ${message}`)
  } else {
    failed.push(message)
    console.log(`  *** 失败 *** ${message}`)
  }
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1300)

// 关掉首访引导
for (let i = 0; i < 6; i += 1) {
  const clicked = await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
    if (!skip) return false
    skip.click()
    return true
  })
  if (!clicked) break
  await page.waitForTimeout(300)
}

// 勾选「显示头像」（已勾选则跳过）
const shown = await page.evaluate(() => {
  const box = [...document.querySelectorAll('input[type=checkbox]')].find((b) => {
    const label = b.closest('label')?.textContent || ''
    return label.includes('显示头像')
  })
  if (!box) return null
  if (!box.checked) box.click()
  return true
})
if (shown === null) {
  console.log('*** 未找到「显示头像」开关，探针无法继续 ***')
  await browser.close()
  process.exit(1)
}
await page.waitForTimeout(700)

/** 真实拖动头像：按住头像中心，位移 (dx, dy) 屏幕像素，分步移动 */
const dragAvatar = async (dx, dy) => {
  const box = await page.locator('.paper .r-avatar').first().boundingBox()
  if (!box) return false
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  const steps = 14
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(startX + (dx * i) / steps, startY + (dy * i) / steps)
    await page.waitForTimeout(24)
  }
  await page.mouse.up()
  await page.waitForTimeout(450)
  return true
}

/**
 * 量遮盖：返回与头像相交的元素清单（> 4px² 交集才算）。
 * 分两组报：正文模块（.r-sec，绝不允许）与页头文字（.r-name/.r-job/联系方式 span）。
 */
const measureOverlap = () =>
  page.evaluate(() => {
    const avatar = document.querySelector('.paper .r-avatar')
    if (!avatar) return { avatar: null, body: [], header: [] }
    const a = avatar.getBoundingClientRect()
    const intersects = (el) => {
      const r = el.getBoundingClientRect()
      const w = Math.min(a.right, r.right) - Math.max(a.left, r.left)
      const h = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top)
      return w > 2 && h > 2 ? w * h : 0
    }
    const describe = (el) =>
      `${el.className || el.tagName}「${(el.textContent || '').trim().slice(0, 10)}」`
    const body = [...document.querySelectorAll('.paper .r-sec')]
      .filter((el) => intersects(el) > 4)
      .map(describe)
    const header = [...document.querySelectorAll('.paper [data-field]')]
      .filter((el) => el.closest('.r-sec') === null)
      .filter((el) => intersects(el) > 4)
      .map(describe)
    return {
      avatar: { x: Math.round(a.left), y: Math.round(a.top), w: Math.round(a.width) },
      body,
      header,
    }
  })

/* 拖动步长：屏幕 px。头像约 90px 宽，一次拖 260px 足够越过任何边界（会被夹住） */
const moves = [
  ['极左', -260, 0],
  ['极右', 260, 0],
  ['极下', 0, 260],
  ['极上', 0, -260],
  ['左下角', -260, 260],
]

for (const [name, dx, dy] of moves) {
  const ok = await dragAvatar(dx, dy)
  if (!ok) {
    log(false, `${name}：找不到头像，无法拖动`)
    continue
  }
  const m = await measureOverlap()
  log(
    m.body.length === 0,
    `${name}拖到极限：头像不遮盖正文模块${m.body.length ? `（遮盖了 ${m.body.join('、')}）` : ''}`,
  )
  log(
    m.header.length === 0,
    `${name}拖到极限：头像不遮盖页头文字${m.header.length ? `（遮盖了 ${m.header.join('、')}）` : ''}`,
  )
}

console.log('')
console.log(`头像遮盖探针：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)
