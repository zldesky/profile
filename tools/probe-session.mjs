/**
 * 会话令牌是否真的生效（诊断用，避免「以为量了编辑器，其实量的是未登录页」）。
 * 用法：node tools/probe-session.mjs [--token <令牌>]
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const flag = argv.indexOf('--token')
const token = flag >= 0 ? argv[flag + 1] || '' : ''
const url = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/'

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
if (token) {
  await context.addCookies([
    { name: 'rs_session', value: token, url, httpOnly: true, sameSite: 'Lax' },
  ])
}
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(1200)

const probe = await page.evaluate(() => {
  const q = (sel) => document.querySelectorAll(sel).length
  const text = (sel) => (document.querySelector(sel)?.textContent || '').trim().slice(0, 40)
  return {
    url: location.href,
    title: document.title,
    // 编辑器标志物
    panelTabs: q('.panel-tabs'),
    moduleCards: q('.ed-card'),
    editorPanel: q('.editor-panel'),
    stageScroll: q('.stage-scroll'),
    // 未登录标志物
    authPanel: q('.auth-panel, .auth-card'),
    loginLinks: q('a[href*="login"]'),
    // 页面上最显眼的一段文字，便于人眼判断落在哪个页面
    heading: text('h1') || text('h2') || text('.panel-tabs'),
    bodyStart: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 150),
  }
})

console.log(`探针 ${token ? '（已注入令牌）' : '（未注入令牌）'}`)
console.log(`  落地 URL   : ${probe.url}`)
console.log(`  标题       : ${probe.title}`)
console.log(`  编辑器标志 : panelTabs=${probe.panelTabs}  ed-card=${probe.moduleCards}  editor-panel=${probe.editorPanel}  stage-scroll=${probe.stageScroll}`)
console.log(`  未登录标志 : auth-panel=${probe.authPanel}  login 链接=${probe.loginLinks}`)
console.log(`  正文开头   : ${probe.bodyStart}`)

await browser.close()