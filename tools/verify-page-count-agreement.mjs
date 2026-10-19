/**
 * 对照「编辑器显示的页数」与「导出 PDF 的真实页数」。
 * 用法：node tools/verify-page-count-agreement.mjs [apiBase]
 *   环境变量：APP_BASE、PDF_ACCESS_PASSWORD、PDF_OUT
 *
 * 为什么需要它：编辑器显示的页数是一个**估算**（usePageMetrics），
 * 而导出的分页由 Chromium 真正决定。两者若不一致，用户就会看到
 * 「编辑器说 1 页，导出来是 2 页」—— 这正是用户报「导出有问题」时的现象形态。
 *
 * 估算与真实分页有一处**结构性差异**：`.r-sec` / `.r-entry` 都带 `break-inside: avoid`，
 * 一个块在剩余空间里放不下时会**整块挪到下一页**，于是真实页数可能多于
 * 「按总高度除以页高」算出来的值。这个工具就是拿真实产物去量这个差异有多大。
 *
 * 做法：构造内容长度递增的一组简历，逐个注入 localStorage（服务端也是这么喂数据的），
 * 读编辑器显示的页数，再走 /api/pdf 出真 PDF 数页数。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'
import { startPdfServer } from './pdf-harness.mjs'

const appBase = process.env.APP_BASE || 'http://localhost:5173'
const STORAGE_KEY = 'resume-studio-v1'
const outDir = mkdtempSync(join(tmpdir(), 'rs-pages-'))

function pageCountOf(bytes) {
  const t = bytes.toString('latin1')
  const counts = (t.match(/\/Count\s+(\d+)/g) || []).map((s) => Number(s.replace(/\D/g, '')))
  return counts.length ? Math.max(...counts) : 0
}

/** 取一份真实的简历 JSON 当基准 */
async function grabResume(browser) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  await page.goto(`${appBase}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1400)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
    if (s) s.click()
  })
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('导出数据'),
    )
    btn?.click()
  })
  await page.waitForTimeout(250)
  const dl = page.waitForEvent('download')
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
      (b.textContent || '').includes('JSON'),
    )
    i?.click()
  })
  const download = await dl
  const p = join(outDir, 'r.json')
  await download.saveAs(p)
  const resume = JSON.parse(readFileSync(p, 'utf8'))
  await context.close()
  return resume
}

/** 把某一模块的条目复制若干份，得到更长的一版简历 */
function lengthen(resume, extra) {
  const copy = JSON.parse(JSON.stringify(resume))
  if (extra <= 0) return copy
  const section = copy.sections.find((s) => s.type === 'entries' && s.items?.length)
  if (!section) return copy
  const template = section.items[0]
  for (let i = 0; i < extra; i += 1) {
    const item = JSON.parse(JSON.stringify(template))
    item.org = `${item.org}（第 ${i + 2} 段）`
    section.items.push(item)
  }
  return copy
}

const browser = await chromium.launch({ channel: 'msedge' })

/*
 * 先探一次开发服务再往下走。
 * 不探的话，服务没起时会直接抛 page.goto 的堆栈（ERR_CONNECTION_REFUSED），
 * 读起来像脚本坏了 —— 而这只是"环境没准备好"，两件事不该混在一起。
 */
try {
  const ping = await fetch(`${appBase}/editor`, { signal: AbortSignal.timeout(5000) })
  if (!ping.ok) throw new Error(`HTTP ${ping.status}`)
} catch (error) {
  console.log(`\n*** 打不开编辑器页面 ${appBase}/editor：${error.message}`)
  console.log('    这个工具要在**开发服务**上跑（它要读编辑器显示的页数）：')
  console.log('      npm run dev')
  await browser.close()
  process.exit(1)
}

const base = await grabResume(browser)

/*
 * 用**自己的**临时服务验证：正式服务的导出有每日额度（默认全站 20 次），
 * 而这个工具一次就要出 7 份 PDF。打在正式服务上会把额度用光，
 * 之后得到的 429 会让「页数不一致」这种假象盖住真实原因。
 */
const server = await startPdfServer()
const apiBase = server.base
const password = server.password

console.log('编辑器显示页数 vs 导出 PDF 真实页数：\n')
console.log('  递增条数   编辑器   导出   一致')
let mismatches = 0
let failures = 0

for (const extra of [0, 2, 4, 6, 8, 10, 14]) {
  const resume = lengthen(base, extra)

  // 编辑器：注入数据 → 读显示页数
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await context.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [STORAGE_KEY, JSON.stringify(resume)],
  )
  await page.goto(`${appBase}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
    if (s) s.click()
  })
  await page.waitForTimeout(700)
  const shown = await page.evaluate(() => {
    const m = /(\d+)\s*页/.exec(document.body.innerText || '')
    return m ? Number(m[1]) : null
  })

  // 详细模式（PAGES_DEBUG=1）：打印块几何，核对估算公式看到的东西
  let blocks = null
  if (process.env.PAGES_DEBUG) {
    blocks = await page.evaluate(() => {
      const el = document.querySelector('.paper')
      const zoom = Number(getComputedStyle(el).zoom) || 1
      const toLayout = (px) => px / zoom
      const paperTop = el.getBoundingClientRect().top
      const out = {
        zoom,
        paperH: Math.round(toLayout(el.getBoundingClientRect().height)),
        paddingTop: Math.round(toLayout(parseFloat(getComputedStyle(el).paddingTop))),
        sections: [],
      }
      for (const s of el.querySelectorAll('.r-sec')) {
        const r = s.getBoundingClientRect()
        out.sections.push({
          title: (s.querySelector('[data-field="sectionTitle"]')?.textContent || '').trim(),
          top: Math.round(toLayout(r.top - paperTop)),
          height: Math.round(toLayout(r.height)),
        })
      }
      return out
    })

    // 估算器自己看到的块（应用在开发态挂了 window.__pageMetrics）
    const est = await page.evaluate(() => {
      const d = window.__pageMetrics?.debugBlocks?.()
      return d || null
    })
    if (est) blocks.estimate = est
  }
  await context.close()

  // 导出：真发一次请求，数页树的 /Count
  const res = await fetch(`${apiBase}/api/pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${password}` },
    body: JSON.stringify({ resume, filename: `页数对照-${extra}-${Date.now().toString(36)}` }),
  })
  let real = null
  let why = ''
  if (res.ok) {
    const bytes = Buffer.from(await res.arrayBuffer())
    real = pageCountOf(bytes)
    if (process.env.PDF_OUT && extra === 0) writeFileSync(process.env.PDF_OUT, bytes)
  } else {
    /*
     * 「量不到」和「量出来不一致」是两回事，必须分开报。
     * 早先这里用 -1 兜底，于是导出请求失败（比如额度用尽）
     * 被显示成「页数不一致」—— 把工具故障说成了产品问题。
     */
    why = `导出失败 HTTP ${res.status} ${(await res.text()).slice(0, 80)}`
  }

  if (blocks) {
    const usable = 297 * (96 / 25.4) - 12 * (96 / 25.4) * 2
    console.log(
      `      [调试] zoom=${blocks.zoom} 纸高=${blocks.paperH} 上内边距=${blocks.paddingTop} 可用高=${Math.round(usable)}`,
    )
    for (const s of blocks.sections) {
      console.log(`        top=${String(s.top).padStart(4)} h=${String(s.height).padStart(4)}  ${s.title}`)
    }
    if (blocks.estimate) {
      console.log(`      [调试] 估算器可用高=${blocks.estimate.usableHeight}，块数=${blocks.estimate.blocks.length}`)
      for (const b of blocks.estimate.blocks) {
        console.log(`        块 top=${String(b.top).padStart(5)} h=${String(b.height).padStart(5)}`)
      }
    } else {
      console.log('      [调试] 拿不到 window.__pageMetrics（应用是生产构建？）')
    }
  }

  const agree = real !== null && shown === real
  if (real === null) failures += 1
  else if (!agree) mismatches += 1
  console.log(
    `  +${String(extra).padStart(2)} 条     ${String(shown).padStart(2)} 页   ${
      real === null ? ' ? 页' : `${String(real).padStart(2)} 页`
    }   ${agree ? '是' : real === null ? `*** ${why}` : '*** 否'}`,
  )
}

await browser.close()
server.cleanup()
rmSync(outDir, { recursive: true, force: true })

if (failures) {
  console.log(`\n*** 有 ${failures} 组**没能导出**（见上面的 HTTP 原因），无法比较 —— 这是工具没量到，不是页数不一致`)
}
if (mismatches) {
  console.log(`\n*** 有 ${mismatches} 组不一致：编辑器的估算与真实分页不同 —— 用户会看到「说 1 页、导出 2 页」`)
}
if (!failures && !mismatches) console.log('\n页数一致：编辑器显示与导出结果全部相符')
process.exit(!failures && !mismatches ? 0 : 1)