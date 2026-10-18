/**
 * 逐个模板验证：切到每个模板后纸面是否真的渲染出内容。
 * 用法：node tools/verify-templates.mjs [--token <会话>]
 *
 * 为什么需要它：模板组件迁 TS 时改的是 props 声明（`{ type: Object, required: true }`
 * → `defineProps<{ resume: Resume }>()`）。这类改动**编译不会报错、类型也通过**，
 * 但万一 prop 名或形状写错，模板就会静默渲染成空白 —— 单测（模板注册表）
 * 和构建都发现不了。所以要真的切一遍、真的数一数纸上有多少可见文字。
 *
 * 判定：每个模板都必须渲染出可辨识的文字量（阈值取得很低，只要不是空白即可），
 * 并且纸面高度要为正 —— 高度为 0 说明组件根本没挂上。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const tokenFlag = argv.indexOf('--token')
const token = tokenFlag >= 0 ? argv[tokenFlag + 1] : ''
const base = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001'

/** 模板清单与 TEMPLATES 的 id 一致（src/data/presets.ts） */
const TEMPLATES = [
  'classic',
  'sidebar',
  'twocol',
  'timeline',
  'minimal',
  'banner',
  'business',
  'cards',
  'rightbar',
  'labelcol',
  'flowcols',
  'custom',
]

/** 低于这个字数就认为「没渲染出来」，而不是「内容本来就少」 */
const MIN_CHARS = 40

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
if (token) {
  await context.addCookies([
    { name: 'rs_session', value: token, url: new URL(base).origin },
  ])
}
const page = await context.newPage()
await page.goto(`${base}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1000)
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
  if (s) s.click()
})
await page.waitForTimeout(300)

/**
 * 驱动真实 UI 来切换模板。
 *
 * 第一版想直接改 Pinia store（`#app.__vue_app__` → `$pinia` → 找 setTemplate），
 * 实测拿不到：app 上没挂 pinia 实例，12 个模板全报 apply=no-store —— 那是**工具坏了**，
 * 却看起来像 12 个模板都渲染失败。黑盒点按钮反而更稳，而且验的是真实路径。
 */
async function setTemplate(name) {
  // 切到「设计」页签，模板选择器在那一栏
  const tabOk = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.panel-tabs button')].find(
      (b) => (b.textContent || '').trim() === '设计',
    )
    if (!btn) return false
    btn.click()
    return true
  })
  if (!tabOk) return 'no-design-tab'
  await page.waitForTimeout(200)

  // 按 title 找那枚模板按钮（title 形如「切换到「左侧色栏」」）
  return page.evaluate((templateName) => {
    const btn = [...document.querySelectorAll('.tpl-card')].find((b) =>
      (b.getAttribute('title') || '').includes(templateName),
    )
    if (!btn) return 'not-found'
    if (btn.disabled) return 'locked'
    btn.click()
    return 'ok'
  }, name)
}

/** 模板 id → 中文名（与 src/data/presets.ts 的 TEMPLATES 一致） */
const TEMPLATE_NAMES = {
  classic: '经典单栏',
  sidebar: '左侧色栏',
  twocol: '双栏紧凑',
  timeline: '时间轴',
  minimal: '极简留白',
  banner: '通栏色带',
  business: '居中正式',
  cards: '卡片分区',
  rightbar: '右侧色栏',
  labelcol: '标题左列',
  flowcols: '双栏流式',
  custom: '自由定制',
}

const results = []
for (const id of TEMPLATES) {
  const applied = await setTemplate(TEMPLATE_NAMES[id] ?? id)
  await page.waitForTimeout(450)
  const stat = await page.evaluate(() => {
    const paper = document.querySelector('.paper')
    if (!paper) return { chars: 0, height: 0, cls: '' }
    const text = (paper.innerText || '').replace(/\s+/g, '')
    return {
      chars: text.length,
      height: Math.round(paper.getBoundingClientRect().height),
      cls: paper.firstElementChild?.className || '',
    }
  })
  const ok = applied === 'ok' && stat.chars >= MIN_CHARS && stat.height > 200
  results.push({ id, applied, ...stat, ok })
  const flag = ok ? '✓' : '*** 失败 ***'
  console.log(
    `  ${flag} ${id.padEnd(9)} 文字 ${String(stat.chars).padStart(4)} 字 · 纸高 ${String(stat.height).padStart(4)}px · ${stat.cls}`,
  )
}

const bad = results.filter((r) => !r.ok)
console.log('')
console.log(`模板渲染验证：${results.length - bad.length}/${results.length} 通过`)
if (bad.length) {
  console.log('未通过的模板：')
  for (const b of bad) console.log(`  · ${b.id}（apply=${b.applied} 文字=${b.chars} 纸高=${b.height}）`)
}

await browser.close()
process.exit(bad.length ? 1 : 0)