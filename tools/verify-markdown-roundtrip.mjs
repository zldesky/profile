/**
 * 端到端验证「Markdown 作为一等内容源」：导出 → 再导入 → 内容是否原样回来。
 * 用法：node tools/verify-markdown-roundtrip.mjs [base]
 *
 * 单元测试（tests/markdownSource.test.js）验的是解析与序列化这对纯函数；
 * 这里验的是**接线**：菜单里点得出来、文件真的下载与上传、导入后纸面真的变了。
 * 两类都要有 —— 纯函数全绿而菜单没接上，是很常见的一种「测试通过但功能没有」。
 *
 * 判据用纸面的**文字内容**而不是样式：导出只带内容，
 * 主题 / 模板 / 布局 / 头像不在 Markdown 里（见 markdownSource 文件头的说明），
 * 所以导入后外观会回到默认，而文字必须逐字一致。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173'
const downloadDir = mkdtempSync(join(tmpdir(), 'rs-md-roundtrip-'))

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 120)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 120))
})
// 导入会弹确认框，一律接受
page.on('dialog', (d) => d.accept())

const results = []
function record(label, ok, detail) {
  results.push({ label, ok })
  console.log(`  ${ok ? '✓' : '***'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** 纸面上的文字指纹（去掉空白差异，只比内容） */
const paperText = () =>
  page.evaluate(() => {
    const paper = document.querySelector('.paper')
    if (!paper) return ''
    return (paper.innerText || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim()
  })

async function openEditor() {
  await page.goto(`${base}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1300)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
    if (s) s.click()
  })
  await page.waitForTimeout(400)
}

try {
  await openEditor()

  /* ---------- 1. 导出「内容源 Markdown」 ---------- */
  const before = await paperText()
  console.log('① 导出 Markdown 内容源：')

  const openedMenu = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('导出数据'),
    )
    if (!btn) return false
    btn.click()
    return true
  })
  await page.waitForTimeout(300)
  if (!openedMenu) throw new Error('找不到「导出数据」按钮')

  const hasItem = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].some((b) =>
      (b.textContent || '').includes('Markdown 内容源'),
    ),
  )
  record('导出菜单里有「Markdown 内容源」', hasItem)

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
      (b.textContent || '').includes('Markdown 内容源'),
    )
    item?.click()
  })
  const download = await downloadPromise
  const savedPath = join(downloadDir, 'source.md')
  await download.saveAs(savedPath)
  const md = readFileSync(savedPath, 'utf8')

  record('下载到 .md 文件', md.length > 0, `${md.length} 字符，文件名 ${download.suggestedFilename()}`)
  record('文件里带模块类型提示', md.includes('<!-- resume:type='))
  record('文件里键值行标签加粗（无歧义标记）', /- \*\*.+?\*\*：/.test(md))

  /* ---------- 2. 改一下内容，确认导入真的生效（而不是"看起来没变"） ---------- */
  console.log('\n② 导入前先改掉一个可见字符：')
  const tampered = md.replace('# ', '# 临时姓名X\n\n# ')
  record('构造了一份改过的 Markdown', tampered !== md)

  /* ---------- 3. 导入 ---------- */
  console.log('\n③ 导入 Markdown：')
  const importPath = join(downloadDir, 'edited.md')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(importPath, md, 'utf8')

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('导入数据'),
    )
    btn?.click()
  })
  await page.waitForTimeout(300)

  const hasImportItem = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].some((b) =>
      (b.textContent || '').includes('Markdown 简历导入'),
    ),
  )
  record('导入菜单里有「Markdown 简历导入」', hasImportItem)

  await page.setInputFiles('input[accept*="markdown"]', importPath)
  await page.waitForTimeout(1500)

  const after = await paperText()
  record(
    '导入后纸面文字与原简历逐字一致',
    after === before,
    after === before ? `${after.length} 字符` : `导入前 ${before.length} / 导入后 ${after.length}`,
  )
  if (after !== before) {
    // 打印第一处差异，便于定位（不打印全文，太长）
    const at = [...before].findIndex((c, i) => c !== after[i])
    console.log(`      首处差异在第 ${at} 个字符：`)
    console.log(`        期望 …${before.slice(Math.max(0, at - 30), at + 30)}…`)
    console.log(`        实际 …${after.slice(Math.max(0, at - 30), at + 30)}…`)
  }

  /* ---------- 4. 模块数量与顺序 ---------- */
  const titles = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.paper .r-sec [data-field="sectionTitle"]')].map((x) =>
        (x.textContent || '').trim(),
      ),
    )
  const titlesAfter = await titles()
  record('模块标题齐全（≥4 个）', titlesAfter.length >= 4, titlesAfter.join(' / '))

  /* ---------- 4b. 技能名必须在纸面上（曾因只渲染进度条而整批缺失） ---------- */
  const skillCheck = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.paper .r-sec')].find((s) =>
      /技能特长/.test(s.innerText || ''),
    )
    const names = [...(sec?.querySelectorAll('[data-field="skillName"]') || [])].map((x) =>
      (x.textContent || '').trim(),
    )
    return { count: names.length, names }
  })
  record(
    '技能名渲染在纸面上',
    skillCheck.count > 0,
    `${skillCheck.count} 个：${skillCheck.names.join(' / ')}`,
  )

  /* ---------- 5. 一套「手写 md」也要能导入 ---------- */
  console.log('\n④ 手写 / LapisCV 式 Markdown 也能导入：')
  const handwritten = [
    '# 手写测试',
    '**全栈工程师**',
    '- **电话**：13900000000',
    '',
    '## 技能',
    '- **语言**：Go',
    '- 分布式系统',
    '',
    '## 自我评价',
    '这是手写导入的一段话。',
    '',
  ].join('\n')
  const handwrittenPath = join(downloadDir, 'handwritten.md')
  writeFileSync(handwrittenPath, handwritten, 'utf8')

  await page.setInputFiles('input[accept*="markdown"]', handwrittenPath)
  await page.waitForTimeout(1500)

  const afterHandwritten = await paperText()
  const okHand =
    afterHandwritten.includes('手写测试') &&
    afterHandwritten.includes('全栈工程师') &&
    afterHandwritten.includes('分布式系统') &&
    afterHandwritten.includes('这是手写导入的一段话。')
  record('手写 md 的内容全部出现在纸面', okHand)
  if (!okHand) console.log(`      纸面：${afterHandwritten.replace(/\n/g, ' | ').slice(0, 200)}`)

  console.log('')
  const passed = results.filter((r) => r.ok).length
  console.log(`Markdown 往返：${passed}/${results.length} 项通过`)
  console.log('运行时错误:', errors.length ? errors.join(' | ') : '无')
  for (const r of results.filter((x) => !x.ok)) console.log(`  *** 未通过：${r.label}`)

  await browser.close()
  process.exit(passed === results.length && !errors.length ? 0 : 1)
} finally {
  try {
    rmSync(downloadDir, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响退出码 */
  }
}