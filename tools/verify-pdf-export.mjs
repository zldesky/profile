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

import { chromium } from '../server/node_modules/playwright-core/index.mjs'
import { startPdfServer } from './pdf-harness.mjs'

const appBase = process.env.APP_BASE || 'http://localhost:5173'
const outDir = mkdtempSync(join(tmpdir(), 'rs-pdf-export-'))

const results = []
function record(label, ok, detail) {
  results.push({ label, ok })
  console.log(`  ${ok ? '✓' : '***'} ${label}${detail ? ` — ${detail}` : ''}`)
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
// 服务脚手架的清理函数：无论成功失败都要收掉，否则会留下游离的 node 进程
let started = null
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

  /* ---------- 2. 起一个额度不受限的临时服务，发 /api/pdf ---------- */
  /*
   * 不打用户本机那个 3001：导出有每日额度（默认全站 20 次），
   * 验证脚本一跑就要出好几份 PDF，反复跑几轮就把额度用光，
   * 之后接口返 429 —— 那时的失败跟被测代码毫无关系。
   */
  console.log('\n启动临时服务（额度不受限）：')
  const server = await startPdfServer()
  const apiBase = server.base
  const password = server.password
  started = server.cleanup
  console.log(`  ${apiBase} · 脚本口令通道已确认可用`)

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

    /* ---------- 3. 长简历必须能正常分页（内容不能被截断） ---------- */
    /*
     * 这一条比「默认简历是 1 页」更重要。
     * 打印样式里为了压掉多余的一页，写了不少重置（`.paper` 的 min-height/padding、
     * `body > *:not(#app)` 的隐藏…）。万一哪条重置把内容**截断**在一页里，
     * 用户不会看到报错 —— 只会拿到一份**缺了后半截**的 PDF。
     * 所以必须验证：内容变长时，页数要跟着涨。
     * 「页数涨了」是「没有截断」的有效证据：真被截断的话，页数会一直是 1。
     */
    console.log('\n长简历的分页：')
    const longResume = JSON.parse(JSON.stringify(resume))
    const entriesSection = longResume.sections.find((s) => s.type === 'entries')
    if (entriesSection && Array.isArray(entriesSection.items)) {
      const template = entriesSection.items[0]
      // 把条目复制到 12 条，足以跨过一页
      for (let i = 0; i < 11; i += 1) {
        const copy = JSON.parse(JSON.stringify(template))
        copy.org = `${copy.org || '公司'}（第 ${i + 2} 段）`
        for (const b of copy.bullets || []) b.text = `${b.text}`
        entriesSection.items.push(copy)
      }
    }

    const res2 = await fetch(`${apiBase}/api/pdf`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${password}`,
      },
      body: JSON.stringify({ resume: longResume, filename: `长简历-${stamp}` }),
    })
    if (!res2.ok) {
      record('长简历导出成功', false, `HTTP ${res2.status}`)
    } else {
      const bytes2 = Buffer.from(await res2.arrayBuffer())
      const info2 = inspectPdf(bytes2)
      record(
        '长简历分出多页（内容没有被截断）',
        info2.pageCount >= 2,
        `${info2.pageCount} 页 · ${Math.round(bytes2.length / 1024)} KB（单页版为 ${Math.round(bytes.length / 1024)} KB）`,
      )
      // 页数差距过大同样是异常（比如某个元素每页都撑出一片空白）
      record('页数没有异常膨胀', info2.pageCount <= 8, `${info2.pageCount} 页（12 条经历）`)
    }
  }
} catch (error) {
  console.log(`\n*** 中断：${error.message}`)
  results.push({ label: '执行未中断', ok: false })
} finally {
  if (browser) await browser.close()
  if (typeof started === 'function') started()
  rmSync(outDir, { recursive: true, force: true })
}

const passed = results.filter((r) => r.ok).length
console.log(`\n服务端 PDF 导出：${passed}/${results.length} 项通过`)
for (const r of results.filter((x) => !x.ok)) console.log(`  *** 未通过：${r.label}`)
process.exit(passed === results.length ? 0 : 1)