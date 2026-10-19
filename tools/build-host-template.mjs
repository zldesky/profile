/**
 * 从应用自身导出「内容源 Markdown」，写成宿主模板文件。
 * 用法：node tools/build-host-template.mjs [base]
 *
 * 为什么要从应用里取，而不是手写一份模板：
 * 手写的模板一定会与格式漂移 —— 格式改了（比如键值行的加粗标记、类型提示的写法），
 * 模板没人记得同步，于是在 VSCode / Typora / Obsidian 里看起来就不对了。
 * 这里让模板由**同一个导出器**产出，格式一致性由构造保证，而不是靠人记。
 *
 * 需要开发服务在跑（默认 5173）：它要真的点菜单、真的下载文件。
 * 顺带这也验证了「导出这条路是通的」。
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'markdown-hosts', 'templates', 'resume.md')
const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173'

const downloadDir = mkdtempSync(join(tmpdir(), 'rs-host-template-'))
const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

try {
  await page.goto(`${base}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1300)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
    if (s) s.click()
  })
  await page.waitForTimeout(400)

  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('导出数据'),
    )
    if (!btn) return false
    btn.click()
    return true
  })
  if (!opened) throw new Error('找不到「导出数据」按钮 —— 开发服务起来了吗？')
  await page.waitForTimeout(300)

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
      (b.textContent || '').includes('Markdown 内容源'),
    )
    item?.click()
  })
  const download = await downloadPromise
  const tmpPath = join(downloadDir, 'resume.md')
  await download.saveAs(tmpPath)

  const md = readFileSync(tmpPath, 'utf8')
  if (!md.includes('<!-- resume:type=')) {
    throw new Error('导出的文件里没有类型提示 —— 格式可能变了，先确认 resumeToSourceMarkdown')
  }

  mkdirSync(join(ROOT, 'markdown-hosts', 'templates'), { recursive: true })
  // 用 copy 而不是 rename：临时目录在系统盘、项目可能在其他盘，跨设备 rename 会 EXDEV
  copyFileSync(tmpPath, OUT)

  console.log(`已写入 ${OUT.replace(ROOT, '')}`)
  console.log(`  ${md.length} 字符 · ${md.split('\n').length} 行`)
  console.log(`  含类型提示：${(md.match(/<!-- resume:type=/g) || []).length} 处`)
  console.log('  可在外编辑器里直接打开（主题见 markdown-hosts/resume.css）')
} finally {
  await browser.close()
  try {
    rmSync(downloadDir, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结果 */
  }
}