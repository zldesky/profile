/**
 * 把宿主主题渲染成图片，用于肉眼检查排版。
 * 用法：node tools/preview-host-theme.mjs
 * 产物：markdown-hosts/preview/屏幕.png、打印.png、打印.pdf
 *
 * 为什么需要它：主题排得难看比没有主题更糟。而 CSS 光看代码是看不出问题的
 * （栏标题竖条的位置、联系方式那一行会不会溢出、条目会不会被拆到两页），
 * 必须真的渲染一次。
 *
 * **这里只是一个「够用」的子集渲染器**，不是通用 Markdown 解析器：
 * 它只认本项目格式用到的那几个结构（h1/h2/h3/列表/段落/分隔线/粗体/注释）。
 * 真正的宿主（VSCode / Typora / Obsidian）用的是完整渲染器，
 * 所以这里看到的是**近似**结果 —— 用来判断版式走向足够，不能当作逐像素依据。
 * 这一点值得写清楚：工具的结论也有适用范围。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATE = join(ROOT, 'markdown-hosts', 'templates', 'resume.md')
const CSS = join(ROOT, 'markdown-hosts', 'resume.css')
const OUT_DIR = join(ROOT, 'markdown-hosts', 'preview')

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 行内标记：只处理粗体，其余按字面输出 */
const inline = (text) =>
  escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

/** 本项目格式的子集 → HTML */
function renderSubset(markdown) {
  const out = []
  let inList = false
  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()

    // HTML 注释（类型提示）在渲染时不可见 —— 与真实宿主一致
    if (!line || /^<!--.*-->$/.test(line)) {
      closeList()
      continue
    }
    if (/^-{3,}$/.test(line)) {
      closeList()
      out.push('<hr>')
      continue
    }
    const h3 = /^###\s+(.*)$/.exec(line)
    if (h3) {
      closeList()
      out.push(`<h3>${inline(h3[1])}</h3>`)
      continue
    }
    const h2 = /^##\s+(.*)$/.exec(line)
    if (h2) {
      closeList()
      out.push(`<h2>${inline(h2[1])}</h2>`)
      continue
    }
    const h1 = /^#\s+(.*)$/.exec(line)
    if (h1) {
      closeList()
      out.push(`<h1>${inline(h1[1])}</h1>`)
      continue
    }
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (li) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}

const markdown = readFileSync(TEMPLATE, 'utf8')
const css = readFileSync(CSS, 'utf8')
/*
 * 页边距**从 CSS 里读**，而不是在这里再写一份数字 ——
 * 两处各写一份，改了 CSS 忘了改这里，量出来的尺寸就是错的，判据跟着失真。
 * --print-margin 是「上 右 下 左」，与 @page 的写法一致。
 */
const marginMatch = /--print-margin:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/.exec(css)
const [, marginTopMm, marginRightMm, marginBottomMm, marginLeftMm] = marginMatch
  ? marginMatch.map(Number)
  : [0, 12, 14, 12, 14]

/** A4 的物理尺寸 */
const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297

/** 打印时内容真正能用的尺寸 */
const printContentWidthMm = A4_WIDTH_MM - marginLeftMm - marginRightMm
const a4UsableMm = A4_HEIGHT_MM - marginTopMm - marginBottomMm

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>简历工坊 · 宿主主题预览</title>
<style>${css}</style>
<style>
  /* 预览页自身的底色，用来衬托纸张（不属于主题的一部分） */
  html { background: #f1f2f4; }
  body { margin: 0; }
  #write { background: #fff; padding: 14mm; box-shadow: 0 2px 12px rgba(0,0,0,.08); margin: 16px auto; }
  @media print { html { background: #fff; } #write { box-shadow: none; margin: 0; padding: 0; } }
</style>
</head>
<body>
<div id="write">
${renderSubset(markdown)}
</div>
</body>
</html>`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'index.html'), html, 'utf8')

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } })

await page.setContent(html, { waitUntil: 'load' })
await page.waitForTimeout(300)
await page.screenshot({ path: join(OUT_DIR, '屏幕.png'), fullPage: true })

/*
 * 打印视图的**截图**只能看排版的疏密，看不出真正的分页与 @page 页边距 ——
 * 浏览器不会在普通视口里模拟分页。所以这里再出一份真 PDF：
 * preferCSSPageSize 让它按 CSS 的 @page（尺寸与页边距）来，而不是 Playwright 的默认值。
 * 对一份「以打印为目的」的主题，这一步才是关键验证。
 */
await page.emulateMedia({ media: 'print' })

/*
 * **必须按真实打印内容宽度来量。**
 * 先前在 900px 宽的视口里量，得到 265mm「放得下」，而实际 PDF 是 2 页 ——
 * 因为 A4 减去左右页边距后内容区只有约 182mm（≈688px），
 * 更窄 → 换行更多 → 更高。量错了参照系，结论自然不对。
 */
const pxPerMm = 96 / 25.4
await page.setViewportSize({
  width: Math.round(printContentWidthMm * pxPerMm),
  height: Math.round(a4UsableMm * pxPerMm),
})
await page.waitForTimeout(250)
await page.screenshot({ path: join(OUT_DIR, '打印.png'), fullPage: true })

const pdfPath = join(OUT_DIR, '打印.pdf')
await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true })

/** 从 PDF 里数页数：/Type /Page 的出现次数（不含 /Pages） */
const pdfBytes = readFileSync(pdfPath)
const pdfText = pdfBytes.toString('latin1')
const pageCount = (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length

// 顺带量几个容易出问题的点，让「看起来没问题」有数字支撑
const metrics = await page.evaluate(() => {
  const root = document.getElementById('write')
  const h1 = root.querySelector('h1')
  const contact = root.querySelector('ul')
  const h2s = [...root.querySelectorAll('h2')]
  const bullets = [...root.querySelectorAll('li')]
  return {
    contentWidth: Math.round(root.getBoundingClientRect().width),
    h1HasRule: getComputedStyle(h1).borderBottomWidth !== '0px',
    contactIsRow: contact ? getComputedStyle(contact).display : '(无)',
    contactOverflow: contact ? contact.scrollWidth - contact.clientWidth : 0,
    sectionCount: h2s.length,
    bulletCount: bullets.length,
    bulletMarkers: bullets.filter((b) => getComputedStyle(b, '::before').content !== 'none').length,
    // 主题色是否真的生效（贴在栏标题竖条上）
    h2MarkerWidth: h2s.length ? getComputedStyle(h2s[0], '::before').width : '(无)',
    /*
     * 打印态的内容高度（mm）。**页数是简历主题的硬指标**：
     * 项目自己的 A4 纸面对同一份示例内容是放得下的，
     * 所以主题若是 2 页，就说明排版比纸面松，而不是「内容本来就多」。
     * A4 可用高度 = 297 - 上下页边距。
     */
    contentHeightMm: +(root.getBoundingClientRect().height / (96 / 25.4)).toFixed(1),
    // 整页高度：内容之外还有 body 边距之类的东西也会占页高，量出来才好定位
    pageHeightMm: +(document.documentElement.scrollHeight / (96 / 25.4)).toFixed(1),
    bodyMarginTop: getComputedStyle(document.body).marginTop,
  }
})



console.log(`已渲染 ${OUT_DIR.replace(ROOT, '')}/`)
console.log(`  版心宽度    ${metrics.contentWidth}px`)
console.log(`  姓名下划线  ${metrics.h1HasRule ? '有' : '*** 无 ***'}`)
console.log(`  联系方式行  display=${metrics.contactIsRow} 横向溢出=${metrics.contactOverflow}px`)
console.log(`  栏标题      ${metrics.sectionCount} 个 · 竖条宽 ${metrics.h2MarkerWidth}`)
console.log(`  列表项      ${metrics.bulletCount} 个 · 带标记的 ${metrics.bulletMarkers} 个`)
console.log(
  `  打印内容高  ${metrics.contentHeightMm}mm · 在 ${printContentWidthMm}mm 宽的内容区里量（A4 可用高 ${a4UsableMm}mm）`,
)
console.log(`  导出 PDF    ${pageCount} 页（${Math.round(pdfBytes.length / 1024)} KB）· 按 CSS @page 尺寸与页边距`)

const fitsOnePage = metrics.contentHeightMm <= a4UsableMm - 1

const ok =
  fitsOnePage &&
  pageCount === 1 &&
  metrics.h1HasRule &&
  metrics.contactIsRow === 'flex' &&
  metrics.contactOverflow <= 0 &&
  metrics.sectionCount > 0 &&
  metrics.bulletMarkers === metrics.bulletCount
if (!fitsOnePage) {
  console.log(
    `\n  *** 默认模板放不进一页：超出 ${(metrics.contentHeightMm - a4UsableMm).toFixed(1)}mm。` +
      '示例内容是完整简历，项目自己的 A4 纸面能放下，所以这是排版偏松。',
  )
}
console.log(ok ? '\n主题渲染：正常' : '\n主题渲染：*** 有异常 ***')

await browser.close()
process.exit(ok ? 0 : 1)