/**
 * 交互态审计：键盘焦点、悬停反馈、禁用态。
 * 用法：node tools/audit-interaction.mjs [url] [--token <session>] [--shots]
 *
 * 为什么单独一个脚本：audit-ui.mjs 测的是**静态**状态（对比度、点击目标、文本溢出）。
 * 但一个控件在静止时合规、按 Tab 走到它却看不出在哪，体验照样是坏的 ——
 * 而那类问题静态测不出来，必须真的按 Tab 走一遍、真的把鼠标移上去。
 *
 * 两条被判定的规则（都能客观验证，不靠主观判断）：
 *  1. **焦点可见**：按 Tab 聚焦后，计算样式必须与未聚焦时**至少有一处不同**
 *     （outline / border / box-shadow / background）。只靠「我觉得看得见」不算数。
 *     注意必须用键盘 Tab 而不是 element.focus() —— :focus-visible 只在键盘导航下匹配，
 *     程序化聚焦测不出真实情况，这是最容易写出「假通过」的地方。
 *  2. **悬停有反馈**：把鼠标移到元素上后，计算样式必须发生变化。完全没有反馈的
 *     可点元素是「看着能点、但让人不确定」的来源。禁用项（disabled）排除在外。
 *
 * 已知取舍：只比较「变没变」，不比较「变化后是否好看/对比度是否足够」。
 * 判定后者需要定义「悬停后背景」并重新算对比度，误报会很多（渐变、图片底、伪元素遮罩），
 * 宁可漏报不可误报 —— 与 audit-ui.mjs 里对渐变背景的处理同一原则。
 *
 * 悬停检查**只针对真正可点的控件**（button / a / role=button 等）。第一版把
 * input / select / textarea 也算进来，结果 40 条报告里大半是输入框 —— 它们本来
 * 就不该有悬停态，那种规则只会淹掉真问题。这一点是实测后改的。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const tokenFlag = argv.indexOf('--token')
const token = tokenFlag >= 0 ? argv[tokenFlag + 1] : null
const shots = argv.includes('--shots')
const url = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/editor'

const VIEWPORTS = [
  { name: '桌面', width: 1440, height: 900 },
  { name: '手机', width: 390, height: 844 },
]

const browser = await chromium.launch({ channel: 'msedge' })

/** 在页面里收集交互元素并取其「外观指纹」，用于对比前后差异 */
const COLLECT = () => {
  const KINDS = [
    'background-color',
    // 渐变按钮的 background-color 是 transparent，背景全在 background-image 上。
    // 漏掉它就会把「渐变变了」看成「没变化」—— 主按钮因此躲过了第一版审计。
    'background-image',
    'color',
    'border-color',
    'box-shadow',
    'outline-color',
    'outline-width',
    // 主按钮的悬停反馈用亮度滤镜实现（默认主题下渐变三档同色，换色看不出来）
    'filter',
  ]
  const fp = (el) => {
    const s = getComputedStyle(el)
    return KINDS.map((k) => s.getPropertyValue(k)).join('|')
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  }
  const label = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24) || el.tagName.toLowerCase()

  const nodes = [
    ...document.querySelectorAll(
      'button, a[href], [role="button"], [role="menuitem"], [role="tab"], summary',
    ),
  ].filter(visible)

  return {
    fingerprint: fp,
    items: nodes.map((el, i) => {
      el.dataset.axIndex = String(i)
      return {
        i,
        label: label(el),
        tag: el.tagName.toLowerCase(),
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        bg: fp(el),
      }
    }),
  }
}

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  if (token) await context.addCookies([{ name: 'rs_session', value: token, url: new URL(url).origin }])
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(900)

  // 关掉新手引导，否则会挡住焦点顺序
  await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '跳过引导')
    if (skip) skip.click()
  })
  await page.waitForTimeout(400)

  const { items } = await page.evaluate(COLLECT)
  const active = items.filter((x) => !x.disabled)
  console.log(`\n▌${vp.name} ${vp.width}×${vp.height}  可交互元素 ${items.length} 个（其中禁用 ${items.length - active.length} 个）`)

  /* ---------- 1. 键盘焦点可见性：真的按 Tab 走 ---------- */
  const focusProblems = []
  const focusCount = Math.min(active.length, 40)
  const seen = new Set()
  for (let step = 0; step < focusCount; step += 1) {
    await page.keyboard.press('Tab')
    const state = await page.evaluate(
      (KINDS) => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const s = getComputedStyle(el)
        return {
          key: el.tagName + '#' + (el.dataset.axIndex ?? '?'),
          label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 24),
          focused: KINDS.map((k) => s.getPropertyValue(k)).join('|'),
          // 焦点圈也可能画在祖先上（:focus-within），一并看
          parent: el.parentElement
            ? KINDS.map((k) => getComputedStyle(el.parentElement).getPropertyValue(k)).join('|')
            : '',
        }
      },
      ['background-color', 'background-image', 'color', 'border-color', 'box-shadow', 'outline-color', 'outline-width', 'filter'],
    )
    if (!state) continue
    if (seen.has(state.key)) continue
    seen.add(state.key)

    // 与「同一元素未聚焦时」比较：临时失焦取一次指纹，再复原
    const idle = await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return null
      const i = el.dataset.axIndex
      const target = i !== undefined ? document.querySelector(`[data-ax-index="${i}"]`) : null
      if (!target) return null
      const had = document.activeElement
      target.blur()
      const s = getComputedStyle(target)
      const fp = [
        'background-color',
        'background-image',
        'color',
        'border-color',
        'box-shadow',
        'outline-color',
        'outline-width',
        'filter',
      ]
        .map((k) => s.getPropertyValue(k))
        .join('|')
      if (had && had.focus) had.focus()
      return fp
    })

    if (idle !== null && state.focused === idle && state.parent === idle) {
      focusProblems.push(state.label || state.key)
    }
  }
  console.log(`  键盘焦点    : 走过 ${seen.size} 个元素，无可见反馈 ${focusProblems.length} 个`)
  for (const l of focusProblems.slice(0, 8)) console.log(`      · ${l}`)

  /* ---------- 2. 悬停反馈 ---------- */
  const noHover = []
  const sample = active.slice(0, 60)
  let skipped = 0
  for (const item of sample) {
    const sel = `[data-ax-index="${item.i}"]`
    const loc = page.locator(sel).first()
    /*
     * 先滚进视口再悬停。不滚的话，编辑面板里排在下面的元素拿不到坐标、
     * 或者鼠标落到别的元素上 —— 正因如此才有一批元素「未能悬停到」，
     * 而那种「漏测」会让报告看起来干净，其实什么都没测到。
     */
    await loc.scrollIntoViewIfNeeded().catch(() => {})
    // 盒子必须**现取现用**：滚动后旧坐标就失效了
    const box = await loc.boundingBox().catch(() => null)
    if (!box) continue
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(60)
    const after = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      // 先确认鼠标真的在这个元素上。否则「样式没变」只说明没hover到，
      // 却被记成「这个元素没有悬停反馈」—— 误报正是这么来的。
      if (!el.matches(':hover')) return { hovered: false }
      const s = getComputedStyle(el)
      return {
        hovered: true,
        fp: ['background-color', 'background-image', 'color', 'border-color', 'box-shadow', 'outline-color', 'outline-width', 'filter']
          .map((k) => s.getPropertyValue(k))
          .join('|'),
      }
    }, sel)
    if (after === null) continue
    if (!after.hovered) {
      skipped += 1
    } else if (after.fp === item.bg) {
      noHover.push(item.label)
    }
    // 移开，避免影响下一个元素
    await page.mouse.move(2, 2)
    await page.waitForTimeout(30)
  }
  console.log(
    `  悬停反馈    : 试过 ${sample.length} 个元素，完全无变化 ${noHover.length} 个（另有 ${skipped} 个未能悬停到，已排除）`,
  )
  for (const l of noHover.slice(0, 10)) console.log(`      · ${l}`)

  if (shots) {
    const { mkdirSync } = await import('node:fs')
    mkdirSync('tools/shots', { recursive: true })
    const f = `tools/shots/交互-${vp.name}.png`
    await page.screenshot({ path: f })
    console.log(`  截图        : ${f}`)
  }

  await context.close()
}

await browser.close()