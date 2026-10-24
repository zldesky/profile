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
/** 打印每次 Tab 的落点，用于诊断「走到 / 可聚焦」的差额是归并还是漏测 */
const debugFocus = argv.includes('--debug-focus')
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

  /*
   * [role="separator"] 是面板宽度分隔条。它虽然是拖拽控件，但焦点与悬停
   * 反馈一样必须有（键盘用户靠方向键调宽度），所以纳入覆盖。
   * 它是 7px 宽的竖条，触屏点击目标规则不适用 —— 理由写在 audit-ui.mjs 里。
   */
  const nodes = [
    ...document.querySelectorAll(
      'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="separator"], summary',
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
        /*
         * 静止指纹在这里就取好。
         * 原来是在焦点循环里对元素 blur() 再 focus() 现取基线 ——
         * 那等于**每测一个元素就把焦点挪两次**：blur 会改变 :focus-within、
         * 甚至触发「失焦即关闭」的弹窗，DOM 与 Tab 顺序随之中断，
         * 后面的元素就走不到了（实测 54 个可聚焦里只走到 40 个）。
         * 基线必须在任何聚焦发生之前一次性取完。
         */
        idleFp: fp(el),
      }
    }),
  }
}

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  if (token)
    await context.addCookies([{ name: 'rs_session', value: token, url: new URL(url).origin }])
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(900)

  // 关掉新手引导，否则会挡住焦点顺序
  await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find(
      (b) => (b.textContent || '').trim() === '跳过引导',
    )
    if (skip) skip.click()
  })
  await page.waitForTimeout(400)

  const { items } = await page.evaluate(COLLECT)
  const active = items.filter((x) => !x.disabled)
  console.log(
    `\n▌${vp.name} ${vp.width}×${vp.height}  可交互元素 ${items.length} 个（其中禁用 ${items.length - active.length} 个）`,
  )

  /* ---------- 1. 键盘焦点可见性：真的按 Tab 走 ---------- */
  const focusProblems = []
  /**
   * 按「焦点外观指纹」归并：同种外观只算一类，用于回答「有几种焦点样式」。
   * focusHits 是 Tab 实际落到的次数（含重复落到同一元素）。
   */
  const focusLooks = new Set()
  let focusHits = 0
  /*
   * 上限只为防跑飞，不为「抽样」——但**触发时必须报出来**。
   * 一个静默的上限会让报告看起来是全覆盖，实际只走了一部分：
   * 这与本项目反复踩到的「工具报绿、覆盖是假的」是同一类问题。
   */
  /*
   * 终止条件是「焦点回到已见过的元素」——说明已经遍历了一圈 —— 而不是按可聚焦元素数硬算步数。
   *
   * 原来用 Math.min(active.length, 400) 当次数：Tab 顺序里还夹着**不在收集列表里**的元素
   * （面板输入框、下拉框，以及纸面那个 contenteditable 的 DIV），它们没有 data-ax-index
   * 却照样吃掉一次 Tab，于是 54 次 Tab 走不完 54 个目标元素 —— 实测只走到 40 个。
   * 那看起来像「14 个元素键盘不可达」，实际只是步数被无关元素占掉了。
   * 上限仍保留，但只为防跑飞，且触发时会明确报出来。
   */
  const MAX_TABS = 800
  const seen = new Set()
  let step = 0
  for (; step < MAX_TABS; step += 1) {
    await page.keyboard.press('Tab')
    const state = await page.evaluate(
      (KINDS) => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const s = getComputedStyle(el)
        return {
          key: el.tagName + '#' + (el.dataset.axIndex ?? '?'),
          index: el.dataset.axIndex ?? null,
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
      [
        'background-color',
        'background-image',
        'color',
        'border-color',
        'box-shadow',
        'outline-color',
        'outline-width',
        'filter',
      ],
    )
    if (!state) continue
    focusHits += 1
    if (debugFocus) console.log(`      Tab#${step + 1} → ${state.key}  ${state.label}`)
    /*
     * 只有**收集列表内的元素**才算数：它们带 data-ax-index。
     * Tab 顺序里还夹着面板输入框 / 下拉框 / 纸面 contenteditable，
     * 这些没有 index，label 会退化成「?#?」这类占位键 ——
     * 若拿它们判「绕回」，第一个重复出现的 INPUT#? 就会让遍历提前中止
     * （实测按 28 次就停了，只覆盖 27 个元素）。
     */
    const inTargetList = state.index !== null && state.index !== '?'
    if (!inTargetList) continue
    if (seen.has(state.key)) break
    seen.add(state.key)

    /*
     * 与收集阶段取好的静止指纹比较，**不再 blur()/focus() 现取基线**。
     *
     * 那两次焦点操作是有副作用的：blur 会改变 :focus-within、可能触发
     * 「失焦即关闭」的弹窗，使 DOM 与 Tab 顺序中断 —— 实测正是它让 54 个
     * 可聚焦元素里只走到 40 个。基线已在 collect 阶段取好。
     */
    const baseline = items[Number(state.index)]?.idleFp ?? null

    if (baseline !== null && state.focused === baseline && state.parent === baseline) {
      focusProblems.push(state.label || state.key)
    } else if (baseline !== null) {
      focusLooks.add(state.focused)
    }
  }
  /*
   * 报三个数而不是一个：走到了多少个不同元素、可聚焦总数是多少、焦点样式有几种。
   * 只报第一个数时，读者无法判断「是不是所有可聚焦元素都走到了」——
   * 若两者不等，差额是「被 Tab 走到但焦点外观与已见重复、因而被归并」的那些，
   * 而不是漏测；把总数摆出来，这个结论才是可核对的。
   */
  console.log(
    `  键盘焦点    : 走到 ${seen.size} / ${active.length} 个可聚焦元素（共按 ${focusHits} 次 Tab），` +
      `焦点样式 ${focusLooks.size} 种，无可见反馈 ${focusProblems.length} 个`,
  )
  if (step >= MAX_TABS) {
    console.log(`  ⚠ 按了 ${MAX_TABS} 次 Tab 仍未绕回起点，遍历可能未覆盖全部元素`)
  }
  for (const l of focusProblems.slice(0, 8)) console.log(`      · ${l}`)

  /* ---------- 2. 悬停反馈 ---------- */
  const noHover = []
  /** 基线过期（收集阶段与悬停时不是同一状态）而被排除的数量 */
  let staleBaseline = 0
  const HOVER_CAP = 300
  const sample = active.slice(0, HOVER_CAP)
  if (active.length > HOVER_CAP) {
    console.log(
      `  ⚠ 可交互元素 ${active.length} 个，超出悬停上限 ${HOVER_CAP}，本次只试了前 ${HOVER_CAP} 个`,
    )
  }
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
        fp: [
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
          .join('|'),
      }
    }, sel)
    if (after === null) continue
    if (!after.hovered) {
      skipped += 1
    } else if (after.fp === item.bg) {
      /*
       * 这里对比的是「收集阶段的基线」与「悬停后的取值」。
       *
       * 实测踩过：主按钮在手机视口被判「无变化」，而手动复现时
       * 渐变与 filter 都变了。原因是基线取自**收集阶段**（那时元素可能还没滚动到位、
       * 或正处于另一种状态），与悬停时的基线不是同一时刻的。
       *
       * 处理方式不是放宽判据，而是**复核一次**：把鼠标移开、等一帧，
       * 重新取一次「未悬停」的值。若那时与悬停时也不同，说明元素本来就有变化，
       * 之前的判定是基线过期 —— 记入 stale，不算失败。
       * 只有「移开后重新取基线，仍与悬停时完全相同」才真正判定无反馈。
       */
      await page.mouse.move(2, 2)
      await page.waitForTimeout(60)
      const idle = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const s = getComputedStyle(el)
        return [
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
      }, sel)
      if (idle !== null && idle !== after.fp) {
        staleBaseline += 1
      } else {
        noHover.push(item.label)
      }
    }
    // 移开，避免影响下一个元素
    await page.mouse.move(2, 2)
    await page.waitForTimeout(30)
  }
  console.log(
    `  悬停反馈    : 试过 ${sample.length} 个元素，完全无变化 ${noHover.length} 个（另有 ${skipped} 个未能悬停到、${staleBaseline} 个基线过期已复核，均排除）`,
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
