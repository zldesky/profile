/**
 * 端到端验证服务端 PDF 导出：从应用里取真实简历 JSON → 真发 /api/pdf → 真检查产出的 PDF。
 * 用法：node tools/verify-pdf-export.mjs [apiBase]
 *   环境变量：APP_BASE（默认 http://localhost:5173）、PDF_ACCESS_PASSWORD
 *
 * 为什么要有这一条：现有集成测试只断言 `/api/pdf` 匿名返回 401，
 * **从来没有真的生成过一份 PDF 并检查它**。而「导出」正是这个产品的主要交付物 ——
 * 页数、纸张尺寸、内容是否真的画上去了，都该有断言。
 *
 * 认证走 Bearer 脚本通道（`.env` 里的 PDF_ACCESS_PASSWORD）：
 * 注册要过滑块验证码，对脚本不友好；这个口令通道本来就是给脚本用的。
 *
 * 检查项：
 *  - 返回的是真 PDF（%PDF 魔数）
 *  - 纸张是 A4（MediaBox 595×842 附近），不是美式 Letter（612×792）
 *  - 页数与简历内容相称（默认简历应为 1 页）
 *  - PDF 里有字体资源（说明真的画了字，不是空白页）
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const appBase = process.env.APP_BASE || 'http://localhost:5173'
const apiBase = process.argv.find((a) => a.startsWith('http://127')) || 'http://127.0.0.1:3001'
const outDir = mkdtempSync(join(tmpdir(), 'rs-pdf-export-'))

const results = []
function record(label, ok, detail) {
  results.push({ label, ok })
  console.log(`  ${ok ? '✓' : '***'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** 从 .env 里读脚本口令（环境变量优先） */
function readAccessPassword() {
  if (process.env.PDF_ACCESS_PASSWORD) return process.env.PDF_ACCESS_PASSWORD.trim()
  try {
    const env = readFileSync(join(ROOT, '.env'), 'utf8')
    const m = /^\s*PDF_ACCESS_PASSWORD\s*=\s*(.*)$/m.exec(env)
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

/** 从 PDF 里读权威元数据：页树的 /Count、/MediaBox、字体资源 */
function inspectPdf(bytes) {
  const text = bytes.toString('latin1')
  const counts = (text.match(/\/Count\s+(\d+)/g) || []).map((s) => Number(s.replace(/\D/g, '')))
  const boxes = (text.match(/\/MediaBox\s*\[([^\]]*)\]/g) || []).map((s) =>
    s
      .replace(/[^\d.\s]/g, '')
      .trim()
      .split(/\s+/)
      .map(Number),
  )
  const box = boxes[0] || null
  return {
    magic: bytes.subarray(0, 5).toString('latin1'),
    // 页数用页树的 /Count（权威），不用数 /Type /Page 那种自制解析
    pageCount: counts.length ? Math.max(...counts) : 0,
    width: box ? Math.round(box[2] - box[0]) : 0,
    height: box ? Math.round(box[3] - box[1]) : 0,
    fontCount: (text.match(/\/Type\s*\/Font/g) || []).length,
  }
}

let browser
try {
  /* ---------- 1. 从应用里取真实简历 JSON ---------- */
  console.log('取简历数据（应用自己的 JSON 导出）：')
  browser = await chromium.launch({ channel: 'msedge' })
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  await page.goto(`${appBase}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
    if (s) s.click()
  })
  await page.waitForTimeout(500)

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('导出数据'),
    )
    btn?.click()
  })
  await page.waitForTimeout(300)
  const dl = page.waitForEvent('download', { timeout: 15000 })
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
      (b.textContent || '').includes('JSON 数据备份'),
    )
    item?.click()
  })
  const download = await dl
  const jsonPath = join(outDir, 'resume.json')
  await download.saveAs(jsonPath)
  const resume = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const sectionCount = Array.isArray(resume.sections) ? resume.sections.length : 0
  record(
    '拿到简历 JSON',
    sectionCount > 0,
    `${resume.basics?.name || '(无姓名)'} · ${sectionCount} 个模块`,
  )
  await browser.close()
  browser = null

  /* ---------- 2. 发 /api/pdf ---------- */
  const password = readAccessPassword()
  if (!password) {
    console.log('\n*** 没有可用的脚本口令：`.env` 里没配 PDF_ACCESS_PASSWORD，环境变量也没有。')
    console.log('    这是服务端脚本通道的必要条件；也可以临时设环境变量后再跑，例如：')
    console.log('      $env:PDF_ACCESS_PASSWORD="..."; node tools/verify-pdf-export.mjs')
    process.exit(1)
  }

  /*
   * 文件名必须每次不同。
   * 服务端的 pdfCache 以「简历内容 + 文件名」为键（见 server/index.ts 的 cacheKeyOf），
   * 用固定文件名会让第二次之后的验证**直接命中缓存**，拿到的还是上一次的产物 ——
   * 于是「改完代码再验证」得到的是旧结果，白高兴或白担心一场。
   * （这一类我栽过：verify-selects 曾对着旧 dist 假通过两轮。）
   */
  const stamp = Date.now().toString(36)
  console.log('\n请求导出：')
  const res = await fetch(`${apiBase}/api/pdf`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${password}`,
    },
    body: JSON.stringify({ resume, filename: `导出验证-${stamp}` }),
  })
  record('POST /api/pdf 成功', res.ok, `HTTP ${res.status}`)

  if (!res.ok) {
    const t = await res.text()
    console.log(`  响应：${t.slice(0, 300)}`)
  } else {
    const bytes = Buffer.from(await res.arrayBuffer())
    const pdfPath = join(outDir, 'out.pdf')
    writeFileSync(pdfPath, bytes)
    // 设了 PDF_OUT 就把产物留到指定路径，便于人工/工具看一眼（默认随临时目录清理）
    if (process.env.PDF_OUT) {
      mkdirSync(dirname(process.env.PDF_OUT), { recursive: true })
      writeFileSync(process.env.PDF_OUT, bytes)
      console.log(`  （已保留产物：${process.env.PDF_OUT}）`)
    }
    const info = inspectPdf(bytes)

    record(
      '返回的是真 PDF',
      info.magic.startsWith('%PDF'),
      `${info.magic} · ${Math.round(bytes.length / 1024)} KB`,
    )

    // A4 = 595×842pt；Letter = 612×792pt
    const isA4 = Math.abs(info.width - 595) <= 3 && Math.abs(info.height - 842) <= 3
    record('纸张是 A4', isA4, `${info.width}×${info.height}pt（A4 = 595×842，Letter = 612×792）`)

    record('画了字（有字体资源）', info.fontCount > 0, `${info.fontCount} 个字体对象`)
    record('页数与默认简历相称（1 页）', info.pageCount === 1, `${info.pageCount} 页`)
  }
} catch (error) {
  console.log(`\n*** 中断：${error.message}`)
  results.push({ label: '执行未中断', ok: false })
} finally {
  if (browser) await browser.close()
  rmSync(outDir, { recursive: true, force: true })
}

const passed = results.filter((r) => r.ok).length
console.log(`\n服务端 PDF 导出：${passed}/${results.length} 项通过`)
for (const r of results.filter((x) => !x.ok)) console.log(`  *** 未通过：${r.label}`)
process.exit(passed === results.length ? 0 : 1)