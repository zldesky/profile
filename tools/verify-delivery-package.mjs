/**
 * 验证「投递包」：真的下载到 zip、真的能解开、里面的三份文件都对。
 *
 * 用法：node tools/verify-delivery-package.mjs
 *
 * 为什么必须真下载再真解压：
 *  - 单测能验 ZIP 的字节结构（tests/zip.test.js 有 14 例），但验不了
 *    「点菜单 → 走服务端导出 → 组装 → 浏览器下载」这条链；
 *  - 更验不了「解压出来的 PDF 是不是真的 PDF」。这条链断在哪一环，
 *    用户看到的都是「下载了个文件，打开说已损坏」。
 *
 * 认证走 pdf-harness 的脚本口令通道：注册要过滑块验证码，对脚本不友好，
 * 而那条通道本来就是给脚本用的（见 tools/pdf-harness.mjs 头部注释）。
 * 它同时起**独立实例**，不消耗本机 3001 的导出额度。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'
import { startPdfServer } from './pdf-harness.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

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

/**
 * 起一个**指向 harness 端口**的 Vite。
 *
 * 关键点：Vite 的 `/api` 是反代到 `PDF_PORT`（见 vite.config.js）。
 * 如果复用用户本机那个 5173（它代理到 3001），请求根本不会到 harness，
 * 于是「口令正确却一直弹口令框」—— 第一版就是这么失败的，看起来像功能坏了。
 *
 * 用独立的端口（5199）而不是抢 5173：不打断用户正在用的开发服务器。
 */
async function startViteWithProxy(apiPort) {
  const port = 5199
  const base = `http://localhost:${port}`
  const probe = async () => {
    try {
      return (await fetch(`${base}/editor`)).ok
    } catch {
      return false
    }
  }
  if (await probe()) return { child: null, base }

  const child = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PDF_PORT: String(apiPort) } },
  )
  for (let i = 0; i < 80; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (await probe()) return { child, base }
  }
  child.kill()
  throw new Error('Vite 没能在 40 秒内起来')
}

/*
 * 放行 Vite 的来源：浏览器点按钮发出的请求一定带 Origin，
 * 而 harness 默认只接受不带 Origin 的脚本请求（见 pdf-harness 的函数注释）。
 * 端口写死成 5199，与 startViteWithProxy 保持一致。
 */
const pdf = await startPdfServer({ allowedOrigins: ['http://localhost:5199'] })
const apiPort = new URL(pdf.base).port

/*
 * F7：前置检查。harness 起来了不等于能打通 —— 先确认它的脚本口令通道真的可用。
 * 不可用就打印可操作的下一步并退出，而不是让后面的断言报出一堆假象。
 */
try {
  const health = await fetch(`${pdf.base}/api/health`, {
    headers: { Authorization: `Bearer ${pdf.password}` },
  })
  const body = await health.json()
  if (!health.ok || !body?.ok) throw new Error(`HTTP ${health.status}`)
  console.log(`  · harness 就绪：${pdf.base}（额度已放宽）`)
} catch (error) {
  console.error(`[--] 渲染服务没就绪：${error.message}`)
  console.error('     先跑 npm run build 确认服务端能起来，再重试本脚本')
  pdf.cleanup()
  process.exit(1)
}

const vite = await startViteWithProxy(apiPort)
console.log(`  · Vite 就绪：${vite.base}（/api 反代到 harness 的 ${apiPort}）`)
const browser = await chromium.launch({ channel: 'msedge' })
const errors = []

try {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 140)}`))

  /*
   * 口令存进 **sessionStorage**，键名 `resume-pdf-password`。
   * 与 src/composables/usePdfPassword.js 一致 —— 那里刻意用 sessionStorage
   * （关标签页即失效），若哪天改成 localStorage，这里会红，正好提醒同步。
   */
  await page.addInitScript((password) => {
    sessionStorage.setItem('resume-pdf-password', password)
  }, pdf.password)

  await page.goto(`${vite.base}/editor`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(1800)

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

  /* ---------- 1. 菜单里有入口 ---------- */

  await page.locator('button[aria-label="导出"]').click()
  await page.waitForTimeout(400)
  const hasEntry = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].some((e) =>
      (e.textContent || '').includes('投递包'),
    ),
  )
  log(hasEntry, '导出菜单里有「投递包」入口')

  /* ---------- 2. 点它，真的下载一个 zip ---------- */

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }).catch(() => null),
    page.locator('[role="menuitem"]', { hasText: '投递包' }).click(),
  ])

  log(Boolean(download), '点击后触发了文件下载')
  if (!download) {
    /*
     * A17：点开受权限门控的界面时，先确认「点下去出现的确实是目标」。
     * 这里把当时的所有弹窗与 toast 都打出来 —— 上一轮就是因为没做这件事，
     * 只看到「没下载」就去怀疑导出链路，而实际弹的是别的框。
     */
    const state = await page.evaluate(() => ({
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) =>
        d.getAttribute('aria-label'),
      ),
      toast: (document.querySelector('.editor-toast') || {}).textContent || '',
      quotaBadge: (document.querySelector('.quota-badge') || {}).textContent || '',
      exportBtn: (document.querySelector('button[aria-label="导出 PDF"]') || {}).textContent || '',
    }))
    console.log(`      实际弹窗：${JSON.stringify(state.dialogs)}`)
    console.log(`      toast：${JSON.stringify(state.toast)}`)
    console.log(`      导出按钮：${JSON.stringify(state.exportBtn)}`)
    throw new Error('没有下载，后续无法验证')
  }

  const filename = download.suggestedFilename()
  log(filename.endsWith('.zip'), `下载的是 zip（实际「${filename}」）`)
  // 命名规则：姓名_岗位_年月.zip
  log(/_\d{6}\.zip$/.test(filename), `文件名带年月标记（实际「${filename}」）`)
  log(!/[\\/:*?"<>|]/.test(filename), '文件名不含任何非法字符')

  const dir = mkdtempSync(join(tmpdir(), 'delivery-'))
  const zipPath = join(dir, filename)
  await download.saveAs(zipPath)
  const bytes = readFileSync(zipPath)
  log(bytes.length > 0, `下载到的文件非空（${bytes.length} 字节）`)
  // ZIP 签名 PK\x03\x04
  log(bytes[0] === 0x50 && bytes[1] === 0x4b, '文件头是 ZIP 签名（PK）')

  /* ---------- 3. 真的解开它 ---------- */

  const extractDir = join(dir, 'out')
  const { execFileSync } = await import('node:child_process')
  let extracted = []
  try {
    // 用系统自带解压，而不是自己写的解析器 —— 那才是「别人的电脑能不能打开」的检验
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`,
      ],
      { stdio: 'ignore' },
    )
    const { readdirSync } = await import('node:fs')
    extracted = readdirSync(extractDir)
  } catch (error) {
    log(false, `系统解压失败：${error.message}`)
  }

  log(extracted.length === 3, `解压出 3 个文件（实际 ${extracted.length} 个：${extracted.join('、')}）`)
  log(
    extracted.some((f) => f.endsWith('.pdf')),
    '包含 PDF',
  )
  log(
    extracted.some((f) => f.endsWith('.txt')),
    '包含纯文本',
  )

  /* ---------- 4. 内容对不对 ---------- */

  const pdfFile = extracted.find((f) => f.endsWith('.pdf'))
  if (pdfFile) {
    const pdfBytes = readFileSync(join(extractDir, pdfFile))
    log(pdfBytes.length > 1000, `PDF 有实际内容（${pdfBytes.length} 字节，不是空白页）`)
    log(
      pdfBytes.subarray(0, 5).toString() === '%PDF-',
      'PDF 文件头正确（%PDF-）',
    )
  }

  const txtFile = extracted.find((f) => f.endsWith('.txt') && !f.includes('说明'))
  if (txtFile) {
    const text = readFileSync(join(extractDir, txtFile), 'utf8')
    log(text.trim().length > 0, '纯文本非空')
    // 纯文本应当包含姓名，否则导错了内容
    log(text.includes('张伟'), '纯文本里含简历内容（姓名）')
  }

  const readme = extracted.find((f) => f.includes('说明'))
  log(Boolean(readme), '包含说明文件（拿到包的人能知道两份文件是什么）')

  /* ---------- 5. 成功回执如实 ---------- */

  const toastText = await page.evaluate(() => {
    const el = document.querySelector('.editor-toast')
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''
  })
  log(/投递包/.test(toastText), `回执说明了导出的是什么（实际「${toastText.slice(0, 40)}」）`)

  rmSync(dir, { recursive: true, force: true })
} catch (error) {
  log(false, `运行中断：${error.message}`)
} finally {
  await browser.close()
  pdf.cleanup()
  if (vite?.child) vite.child.kill()
}

console.log('')
console.log(`投递包验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

process.exit(failed.length ? 1 : 0)
