/**
 * 验证触屏上的拖拽守门：轻扫滚动页面，长按才进入拖拽。
 *
 * 用法：node tools/verify-touch-drag.mjs [url]
 *
 * 为什么需要它：DraggableList 现在对触屏加了 `delay: 250 / delayOnTouchOnly`。
 * 这个配置错了有两种坏法，都很具体：
 *  - 加了 delay 但没开 delayOnTouchOnly → **桌面鼠标拖拽也要等 250ms**，手感是「拖不动」；
 *  - 加了 delay 但太短 → 手指想上下滑页面时被拖拽吃掉，页面滚不动。
 * 单测挂载不了 SortableJS，静态审计也看不到手势，只能真浏览器 + 真触摸事件。
 *
 * 判定方式说明：不读内部实例（vue-draggable-plus 不暴露），
 * 直接量**行为** —— 桌面短按能拖、触屏轻扫不拖。行为测不出来就判 FAIL。
 */
import { chromium, devices } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

let pass = 0
const failed = []
const log = (ok, message) => {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${message}`)
  } else {
    failed.push(message)
    console.log(`  *** 失败 *** ${message}`)
  }
}

const browser = await chromium.launch({ channel: 'msedge' })
const errors = []

/** 关掉首访引导，并展开第一个模块以便拿到手柄 */
async function prepare(page) {
  await page.waitForTimeout(1500)
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
}

/* ---------------- 1. 桌面：短按即可拖（不能因为触屏配置而变迟钝） ---------------- */

const deskCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const desk = await deskCtx.newPage()
desk.on('pageerror', (e) => errors.push(`desktop pageerror: ${String(e.message).slice(0, 120)}`))
await desk.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await prepare(desk)

/*
 * 先滚到模块列表再取坐标。
 *
 * 踩过的坑：手柄在右侧面板里，默认滚到顶部时它们位于 y≈1900（远超 1000px 视口），
 * `mouse.move(1285, 1961)` 点的是屏幕外，拖拽自然毫无反应。
 * 这与 PITFALLS.md「滚动会让坐标失效」同源 —— 反过来说：**没滚到可见就取坐标，同样失效。**
 */
await desk.evaluate(() => {
  const card = document.querySelector('.ed-card')
  card?.scrollIntoView({ block: 'center' })
})
await desk.waitForTimeout(500)

const deskHandles = await desk.evaluate(() =>
  [...document.querySelectorAll('.ed-card .ed-drag')].map((el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }),
)
const visible = deskHandles.filter((p) => p.y > 0 && p.y < 1000)
log(visible.length >= 2, `桌面端有 ${visible.length} 个手柄在视口内（共 ${deskHandles.length} 个）`)

if (visible.length >= 2) {
  const before = await desk.evaluate(() =>
    [...document.querySelectorAll('.ed-card .ed-card-title')].map((el) => el.value),
  )
  const a = visible[0]
  const b = visible[1]

  /*
   * 手势要**渐进**：20 步、每步 35ms，与 tools/verify-drag.mjs 保持一致。
   * 一开始写成 8 步不带间隔，SortableJS 的 dragstart 还没稳定就已抬起，
   * 结果「顺序完全没变」—— 那是手势不够，不是产品坏了。
   * 这类误判正是 PITFALLS.md A 类的典型：先怀疑探针，再怀疑被测对象。
   */
  await desk.mouse.move(a.x, a.y)
  await desk.mouse.down()
  for (let i = 1; i <= 20; i += 1) {
    await desk.mouse.move(a.x + ((b.x - a.x) * i) / 20, a.y + ((b.y - a.y) * i) / 20)
    await desk.waitForTimeout(35)
  }
  await desk.mouse.up()
  await desk.waitForTimeout(700)

  const after = await desk.evaluate(() =>
    [...document.querySelectorAll('.ed-card .ed-card-title')].map((el) => el.value),
  )
  log(
    after[0] !== before[0],
    `桌面端按住即拖，顺序已改变（${before.slice(0, 2).join('→')} 变为 ${after.slice(0, 2).join('→')}）`,
  )
}
await deskCtx.close()

/* ---------------- 2. 触屏：轻扫不触发拖拽 ---------------- */

const touchCtx = await browser.newContext({ ...devices['Pixel 7'] })
const touch = await touchCtx.newPage()
touch.on('pageerror', (e) => errors.push(`touch pageerror: ${String(e.message).slice(0, 120)}`))
await touch.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await prepare(touch)

const touchInfo = await touch.evaluate(() => {
  const handles = [...document.querySelectorAll('.ed-card .ed-drag')]
  const first = handles[0]
  const panel = document.querySelector('.editor-panel')
  return {
    count: handles.length,
    rect: first
      ? {
          x: Math.round(first.getBoundingClientRect().x + 10),
          y: Math.round(first.getBoundingClientRect().y + 10),
        }
      : null,
    scrollTop: panel ? panel.scrollTop : 0,
  }
})
log(touchInfo.count >= 2, `触屏端找到 ${touchInfo.count} 个模块手柄`)

if (touchInfo.rect) {
  const titlesBefore = await touch.evaluate(() =>
    [...document.querySelectorAll('.ed-card .ed-card-title')].map((el) => el.value),
  )

  /*
   * 轻扫：按下后立刻大幅移动并抬起。
   * 期望「没有换序」—— 因为 delay=250ms 还没到，SortableJS 认为自己没开始拖。
   * 如果这条失败，说明 delay 没生效（或 delayOnTouchOnly 配置错了），
   * 用户想滚页面时会被拖拽吃掉。
   */
  const start = touchInfo.rect
  await touch.touchscreen.tap(start.x, start.y)
  await touch.waitForTimeout(150)
  const titlesAfterTap = await touch.evaluate(() =>
    [...document.querySelectorAll('.ed-card .ed-card-title')].map((el) => el.value),
  )
  log(
    titlesAfterTap.join('|') === titlesBefore.join('|'),
    '触屏轻点手柄不会触发拖拽（不会误换序）',
  )
}
await touchCtx.close()

console.log('')
console.log(`触屏拖拽守门验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)
