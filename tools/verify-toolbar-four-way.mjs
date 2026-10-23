/**
 * 验证纸面多选工具条：上/左两个方向的间距按钮真的能改到纸面，且窄屏不溢出。
 * （「下」「右」不设悬浮快捷按钮，下方间距 / 右侧缩进在编辑面板「位置与对齐」的滑杆里调，见 verify:spacing。）
 *
 * 两条踩过的坑都写在下面的 selectTwo() 与窄屏循环里，因为它们是
 * 「工具报绿、其实没测到」的典型：
 *
 * 1. **多选不是 click，是 pointerdown**（usePaperSelection.pressSection）。
 *    用 locator.click() 点在模块文字上会先触发就地编辑（.ie-layer 浮层），
 *    而且 click 路径里 Ctrl 分支是直接 return 的 —— 脚本会以为选中了，
 *    实际选中集是空的。
 * 2. **窄屏默认显示编辑器、纸面被 v-if 隐藏**，必须先点顶栏切到「预览」。
 *    第一版拿不到工具条时写的是「未出现（跳过）」并判 PASS —— 那不是通过，
 *    是根本没测到。现在拿不到就是 FAIL。
 *
 * 运行前提：另开一个终端跑 `npm run dev`（默认 5173）。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

/*
 * 站点地址。与其余 20+ 个 verify 脚本同一约定：第一个 http:// 参数可覆盖默认值。
 * 原先这里是写死的常量 —— 唯一两个不能改目标的脚本之一，想在 3001 上跑就只能改源码。
 */
const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173'

function log(ok, label, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const browser = await chromium.launch({ channel: 'msedge' })

/* ---------------- 桌面：批量按钮 ---------------- */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(`${BASE}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
for (const sel of ['.ob-skip', '.ob-close']) {
  const el = await page.$(sel)
  if (el) await el.click().catch(() => {})
}
await page.waitForTimeout(500)

/*
 * 在纸面上多选两个模块。
 *
 * 不能直接用 locator.click()：命中模块正文里的文字会先触发「就地编辑」，
 * 而且多选是在 pointerdown 里做的（usePaperSelection.pressSection），
 * 不是 click。所以这里派发真实的 pointerdown/pointerup，并落在模块的
 * 边角空白处 —— 避开文字热点，走「只选中」那条分支。
 */
async function selectTwo(targetPage) {
  const secs = targetPage.locator('.paper .r-sec')
  if ((await secs.count()) < 2) return false

  const first = await secs.nth(0).boundingBox()
  const second = await secs.nth(1).boundingBox()
  if (!first || !second) return false

  // 取左侧内边距附近、垂直居中处：那里通常没有文字节点
  const pick = (box) => ({ x: box.x + 6, y: box.y + box.height / 2 })

  const p1 = pick(first)
  await targetPage.mouse.move(p1.x, p1.y)
  await targetPage.mouse.down()
  await targetPage.mouse.up()
  await targetPage.waitForTimeout(350)

  const p2 = pick(second)
  await targetPage.keyboard.down('Control')
  await targetPage.mouse.move(p2.x, p2.y)
  await targetPage.mouse.down()
  await targetPage.mouse.up()
  await targetPage.keyboard.up('Control')
  await targetPage.waitForTimeout(600)
  return true
}
const paperSections = page.locator('.paper .r-sec')
const paperCount = await paperSections.count()
log(paperCount >= 2, '纸面至少有两个模块', `${paperCount} 个`)

await selectTwo(page)

const toolbar = page.locator('.sel-toolbar')
const toolbarVisible = await toolbar.isVisible()
log(toolbarVisible, '多选工具条出现')

if (toolbarVisible) {
  // 悬浮工具条只保留「上 / 左」两组 ——「下」「右」不设快捷按钮，改在编辑面板滑杆里调
  const groups = await toolbar.locator('.sel-group').count()
  log(groups === 2, '工具条有两组间距按钮', `${groups} 组`)

  const tips = await toolbar.locator('.sel-group .sel-tip').allInnerTexts()
  log(
    tips.join('') === '上左',
    '悬浮条方向标签为 上/左（无「下」「右」）',
    tips.join(' '),
  )

  // 点「左」的加号，纸面上两个模块的 paddingLeft 都应变化
  const beforeLeft = await paperSections.nth(0).evaluate((el) => getComputedStyle(el).paddingLeft)
  const leftGroup = toolbar.locator('.sel-group').filter({ hasText: '左' })
  await leftGroup.locator('button[title="增大左缩进"]').click()
  await page.waitForTimeout(500)
  const afterLeft = await paperSections.nth(0).evaluate((el) => getComputedStyle(el).paddingLeft)
  log(afterLeft !== beforeLeft, '「左」加号改变纸面左侧间距', `${beforeLeft} → ${afterLeft}`)

  // 点「上」的减号
  const beforeTop = await paperSections.nth(0).evaluate((el) => getComputedStyle(el).marginTop)
  const topGroup = toolbar.locator('.sel-group').filter({ hasText: '上' })
  await topGroup.locator('button[title="减小上方间距"]').click()
  await page.waitForTimeout(500)
  const afterTop = await paperSections.nth(0).evaluate((el) => getComputedStyle(el).marginTop)
  log(afterTop !== beforeTop, '「上」减号改变纸面上方间距', `${beforeTop} → ${afterTop}`)

  await page.screenshot({ path: 'gui-test-screenshots/toolbar-four-way.png' })
}

/* ---------------- 窄屏：工具条不溢出 ---------------- */
/*
 * 窄屏默认显示「编辑器」面板，纸面被 v-if 隐藏，所以选不中模块 ——
 * 必须先点顶栏的切换按钮进「预览」。这也是第一版脚本报出
 * 「未出现工具条（跳过）」的原因：那不是通过，是根本没测到。
 * 因此下面若拿不到工具条，直接判 FAIL 而不是跳过。
 */
for (const width of [720, 390, 360, 320]) {
  const p = await browser.newPage({ viewport: { width, height: 780 } })
  await p.goto(`${BASE}/editor`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1400)
  for (const sel of ['.ob-skip', '.ob-close']) {
    const el = await p.$(sel)
    if (el) await el.click().catch(() => {})
  }
  await p.waitForTimeout(400)

  // 切到预览（窄屏下这个按钮的语义是「编辑 / 预览」切换）
  const toggle = p.locator('.tb-collapse-md').last()
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click().catch(() => {})
    await p.waitForTimeout(800)
  }

  const paperVisible = await p.locator('.paper .r-sec').first().isVisible().catch(() => false)
  log(paperVisible, `${width}px 视口纸面可见`)

  if (paperVisible) {
    await selectTwo(p)
    const tb = p.locator('.sel-toolbar')
    const tbVisible = await tb.isVisible().catch(() => false)
    log(tbVisible, `${width}px 视口多选工具条出现`)

    if (tbVisible) {
      const box = await tb.boundingBox()
      const overflow = box ? box.x < -1 || box.x + box.width > width + 1 : true
      log(
        !overflow,
        `${width}px 视口工具条不溢出`,
        box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : 'no box',
      )

      // 两个方向的按钮都还在（不能因为窄屏就把某个方向藏掉）
      const groups = await tb.locator('.sel-group').count()
      log(groups === 2, `${width}px 视口上/左两方向仍齐全`, `${groups} 组`)

      const btnBox = await tb.locator('.sel-btn').first().boundingBox()
      if (btnBox) {
        // 24px 是本项目静态审计（audit-ui.mjs）沿用的点击目标门槛
        log(
          btnBox.width >= 24 && btnBox.height >= 24,
          `${width}px 视口按钮命中区 ≥24px`,
          `${Math.round(btnBox.width)}×${Math.round(btnBox.height)}`,
        )
      }
      await p.screenshot({ path: `gui-test-screenshots/toolbar-${width}.png` })
    }
  }
  await p.close()
}

const realErrors = errors.filter((e) => !/favicon|DevTools/i.test(e))
log(realErrors.length === 0, '无运行期 JS 错误', realErrors.slice(0, 2).join(' | '))

await browser.close()
console.log('\n=== 完成 ===')
