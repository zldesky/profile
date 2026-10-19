/**
 * 端到端验证：分享链接自动屏蔽个人敏感信息。
 * 用法：node tools/verify-share-privacy.mjs
 *   环境变量：SHOT_DIR（可选）把分享页与分享弹窗各截一张图，便于肉眼核对排版
 *
 * 三层都验，因为三层各自会漏：
 *  1. **接口层**：匿名请求 /api/share/:id 拿不到手机号 / 邮箱原文
 *     （只在前端不显示是"看不见"，不是"不暴露"）；
 *  2. **分享页**：纸面上显示的是屏蔽后的形态，并且有一行说明告诉浏览者
 *     「联系方式是有意隐藏的」—— 否则招聘方会以为对方漏填了；
 *  3. **打印**：那行说明不能被印进 PDF（它是给屏幕看的提示，不是简历内容）。
 *
 * 另有一条界面检查：分享弹窗要**说明**会自动屏蔽、并给出显式的例外开关。
 * 屏蔽是自动的，但不该是悄悄发生的 —— 用户有权知道分享出去的内容被改动过。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'
import { startPdfServer } from './pdf-harness.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const outDir = mkdtempSync(join(tmpdir(), 'rs-share-'))

/** 目录下最新的修改时间（用于判断构建产物是否比源码旧） */
function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full))
    else newest = Math.max(newest, statSync(full).mtimeMs)
  }
  return newest
}

const results = []
function record(label, ok, detail) {
  results.push({ label, ok })
  console.log(`  ${ok ? '✓' : '***'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** 一份带敏感信息的简历 */
const SENSITIVE_RESUME = {
  version: 2,
  template: 'classic',
  theme: { accent: '#1f2937', mv: 12, mh: 14, fs: 1, lh: 1.75, gap: 1 },
  basics: {
    name: '隐私验证',
    jobTitle: '前端开发工程师',
    fields: [
      { icon: 'phone', label: '联系电话', value: '13800001111' },
      { icon: 'mail', label: '联系邮箱', value: 'privacy@example.com' },
      { icon: 'cake', label: '年龄', value: '30岁' },
      { icon: 'location', label: '现居城市', value: '上海' },
    ],
  },
  sections: [
    {
      type: 'text',
      title: '自我评价',
      content: '可加微信 privacy_wx 或致电 13900002222 详谈。',
    },
  ],
}

const RAW_VALUES = ['13800001111', 'privacy@example.com', '30岁', '13900002222']

let browser
let server = null
try {
  /* ---------- 起独立服务并注册账号（注册要过滑块，harness 已关掉） ---------- */
  console.log('起独立服务并建号：')
  server = await startPdfServer()
  const base = server.base
  const username = `privacy${Date.now().toString(36)}`
  const password = 'Privacy!23456'

  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const setCookies = reg.headers.getSetCookie?.() || []
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
  const sessionLine = setCookies.find((c) => c.startsWith('rs_session='))
  const sessionToken = sessionLine ? sessionLine.split(';')[0].slice('rs_session='.length) : ''
  if (!reg.ok || !cookie || !sessionToken) throw new Error(`建号失败：HTTP ${reg.status}`)
  record('建号并拿到会话', true, username)

  /* ---------- 1. 接口层：分享快照里没有原文 ---------- */
  console.log('\n① 接口层（匿名请求）：')
  const created = await fetch(`${base}/api/share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ resume: SENSITIVE_RESUME }),
  })
  const createdBody = await created.json()
  if (!created.ok || !createdBody.ok) throw new Error(`创建分享失败：HTTP ${created.status}`)
  const shareId = createdBody.id
  record('创建分享成功', true, `id=${shareId}`)
  record(
    '回执告知屏蔽了哪些字段',
    Array.isArray(createdBody.redacted?.labels) && createdBody.redacted.labels.length > 0,
    createdBody.redacted?.labels?.join('、') || '(无)',
  )

  // 裸 fetch：没有任何 cookie，模拟"拿到链接的陌生人"
  const anon = await fetch(`${base}/api/share/${shareId}`)
  const anonRaw = await anon.text()
  const leaked = RAW_VALUES.filter((v) => anonRaw.includes(v))
  record('匿名读取拿不到任何原文', leaked.length === 0, leaked.length ? `泄漏：${leaked.join('、')}` : '无泄漏')
  record('返回的是屏蔽后的形态', anonRaw.includes('138****1111'))

  /* ---------- 2/3. 分享页与打印 ---------- */
  console.log('\n② 分享页（浏览器打开）：')
  browser = await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 120))
  })

  await page.goto(`${base}/share/${shareId}`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForSelector('.paper', { timeout: 20000 })
  await page.waitForTimeout(700)

  // 可选截图：文字断言说明不了排版好不好看
  if (process.env.SHOT_DIR) {
    mkdirSync(process.env.SHOT_DIR, { recursive: true })
    await page.screenshot({ path: join(process.env.SHOT_DIR, '分享页.png'), fullPage: true })
  }

  const onPage = await page.evaluate(() => document.body.innerText || '')
  const leakedOnPage = RAW_VALUES.filter((v) => onPage.includes(v))
  record('纸面上看不到任何原文', leakedOnPage.length === 0, leakedOnPage.length ? `泄漏：${leakedOnPage.join('、')}` : '无泄漏')
  record('纸面显示屏蔽后的手机号', onPage.includes('138****1111'))
  record('年龄等字段显示为 **', onPage.includes('**'))

  const notice = await page.evaluate(() => {
    const el = document.querySelector('.sp-masked')
    return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : ''
  })
  record('有「联系方式已隐藏」的说明', notice.length > 0, notice.slice(0, 60))

  // 打印态：说明条不能被印进 PDF
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(250)
  const printVisible = await page.evaluate(() => {
    const el = document.querySelector('.sp-masked')
    if (!el) return false
    return getComputedStyle(el).display !== 'none'
  })
  record('打印时说明条被隐藏（不印进 PDF）', !printVisible)
  await page.emulateMedia({ media: 'screen' })

  record('分享页无运行时错误', errors.length === 0, errors.length ? errors.join(' | ') : '无')

  /* ---------- 4. 弹窗文案（在同一台服务上，且带着会话） ---------- */
  /*
   * 这里刻意**不**去打本机 5173：分享按钮要求登录，未登录时点它会拉起登录弹窗，
   * 于是拿不到分享弹窗的内容（我第一版就是这么误判的）。
   * 而 harness 这台服务上我刚注册过，把会话 cookie 塞进浏览器 context 即可。
   *
   * 注意它渲染的是构建产物 dist（不像 Vite 那样用源码），所以要**先确认 dist 不比源码旧** ——
   * 否则就在对着旧界面验证（PITFALLS 的 A10）。
   */
  console.log('\n③ 分享弹窗的说明与例外开关：')
  {
    const newestSrc = newestMtime(join(ROOT, 'src'))
    const distIndex = join(ROOT, 'dist', 'index.html')
    const distMtime = existsSync(distIndex) ? statSync(distIndex).mtimeMs : 0
    const fresh = distMtime >= newestSrc
    record('dist 不比源码旧（否则验的是旧界面）', fresh, fresh ? '新鲜' : 'dist 偏旧，请先 npm run build')

    await page.context().addCookies([
      { name: 'rs_session', value: sessionToken, domain: '127.0.0.1', path: '/' },
    ])
    await page.goto(`${base}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
    await page.waitForTimeout(1500)
    await page.evaluate(() => {
      const s = [...document.querySelectorAll('button')].find(
        (x) => (x.textContent || '').trim() === '跳过引导',
      )
      if (s) s.click()
    })
    await page.waitForTimeout(400)
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.getAttribute('aria-label') || '') === '分享',
      )
      if (!btn) return false
      btn.click()
      return true
    })
    await page.waitForTimeout(700)
    if (!opened) console.log('  *** 找不到「分享」按钮（aria-label="分享"）')

    const dialog = await page.evaluate(() => {
      const text = document.body.innerText || ''
      const boxes = [...document.querySelectorAll('input[type="checkbox"]')].map((b) => {
        const label = b.closest('label')
        return {
          checked: b.checked,
          text: label ? (label.innerText || '').replace(/\s+/g, ' ').trim() : '',
        }
      })
      return {
        hasPrivacyNote: text.includes('自动屏蔽'),
        mentionsPhone: /138\*\*\*\*0000|手机号/.test(text),
        revealBox: boxes.find((b) => b.text.includes('保留真实的联系方式')) || null,
      }
    })

    if (process.env.SHOT_DIR) {
      mkdirSync(process.env.SHOT_DIR, { recursive: true })
      const card = await page.$('.sh-card, [role="dialog"]')
      if (card) await card.screenshot({ path: join(process.env.SHOT_DIR, '分享弹窗.png') })
      else await page.screenshot({ path: join(process.env.SHOT_DIR, '分享弹窗.png') })
    }

    record('弹窗说明会自动屏蔽', dialog.hasPrivacyNote)
    record('说明里举了屏蔽后的形态', dialog.mentionsPhone)
    record(
      '有「保留真实联系方式」的例外开关，且默认不勾选',
      Boolean(dialog.revealBox) && dialog.revealBox.checked === false,
      dialog.revealBox ? `「${dialog.revealBox.text.slice(0, 40)}…」默认 ${dialog.revealBox.checked}` : '(没找到)',
    )
  }
} catch (error) {
  console.log(`\n*** 中断：${error.message}`)
  results.push({ label: '执行未中断', ok: false })
} finally {
  if (browser) await browser.close()
  if (server) server.cleanup()
  rmSync(outDir, { recursive: true, force: true })
}

const passed = results.filter((r) => r.ok).length
console.log(`\n分享隐私屏蔽：${passed}/${results.length} 项通过`)
for (const r of results.filter((x) => !x.ok)) console.log(`  *** 未通过：${r.label}`)
process.exit(passed === results.length ? 0 : 1)