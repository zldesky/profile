/**
 * 端到端验证纸面「点文字就地编辑」与「点模块跳转」。
 * 用法：node tools/verify-paper-edit.mjs [url]
 *
 * 为什么必须有一个常驻脚本：这两件事都是**交互**，
 *   - 静态审计看不到（它不点击纸面）；
 *   - 单测只覆盖 resolveEditTarget 这类纯逻辑，不挂载 PreviewPane。
 * 而它们曾经真的坏过：页头字段不在任何 .r-sec 里，于是按在其文字上会落到
 * 「框选」分支，而框选一上来就 preventDefault + setPointerCapture，
 * **吃掉后续 click**，就地编辑整个失效 —— 编译、类型、单测、静态审计全都发现不了。
 *
 * 前两版探针的教训（都记在这里，避免重犯）：
 *  1. 只判「有没有编辑框」会读到**上一次遗留的框**（实测「职位」读到了「张伟」）；
 *  2. 点击坐标可能落在视口外（靠后的模块在折叠线以下），elementFromPoint 返回 null，
 *     看起来像「功能坏了」，其实是探针没点到。
 * 所以这一版只做用户视角的判定：点文字 → 输入新值 → 提交 → 纸面上真的出现新值。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 110)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 110))
})

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button')].find(
    (x) => (x.textContent || '').trim() === '跳过引导',
  )
  if (s) s.click()
})
await page.waitForTimeout(400)

const findEditor = () =>
  page.evaluate(() => {
    const inp = [...document.querySelectorAll('body *')].find(
      (el) => /^ie-input/.test(String(el.className || '')) && el.offsetParent !== null,
    )
    return inp ? { value: String(inp.value ?? inp.textContent ?? '') } : null
  })

/** 点某个锚点开编辑框；返回框中当前值或失败原因 */
async function openEditorAt(field) {
  await page.keyboard.press('Escape')
  // 等旧编辑框真的消失，否则下一次会读到它
  for (let i = 0; i < 12; i += 1) {
    if (!(await findEditor())) break
    await page.waitForTimeout(80)
  }
  const box = await page.evaluate((f) => {
    const el = document.querySelector(`.paper [data-field="${f}"]`)
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + Math.max(4, r.width / 2), y: r.y + r.height / 2 }
  }, field)
  if (!box) return { ok: false, why: '纸面上没有这个锚点' }
  /*
   * 就地编辑的手势是**双击**：单击已被「选中字段微调」占用
   * （PreviewPane.onPaperDblClick / onPaperClick）。这里曾经用单击，
   * 手势改版后 5 个用例全数「没有弹出编辑框」，脚本却没人跑所以一直没发现。
   */
  await page.mouse.dblclick(box.x, box.y)
  await page.waitForTimeout(450)
  const editor = await findEditor()
  return editor ? { ok: true, ...editor } : { ok: false, why: '没有弹出编辑框' }
}

console.log('就地编辑（改值 → 提交 → 看纸面是否变）：')
let pass = 0
const CASES = [
  ['name', '页头 · 姓名'],
  ['jobTitle', '页头 · 职位'],
  ['sectionTitle', '模块标题'],
  ['gridValue', '网格项内容'],
  /*
   * 技能名原先只有一个「被 showBars 关掉」的渲染路径，锚点其实不存在 ——
   * 补回渲染后它必须也能就地编辑，所以列进来当回归用例。
   */
  ['skillName', '技能名'],
]

for (const [field, label] of CASES) {
  const opened = await openEditorAt(field)
  if (!opened.ok) {
    console.log(`  *** ${label.padEnd(12)} ${opened.why}`)
    continue
  }
  const before = opened.value
  const next = before.includes('★') ? before.replace('★', '') : `${before}★`

  const typed = await page.evaluate((val) => {
    const inp = [...document.querySelectorAll('body *')].find(
      (el) => /^ie-input/.test(String(el.className || '')) && el.offsetParent !== null,
    )
    if (!inp) return false
    const proto =
      inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    // 失焦提交（组件靠回车 / 失焦落库）
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true
  }, next)
  if (!typed) {
    console.log(`  *** ${label.padEnd(12)} 写入失败`)
    continue
  }
  await page.waitForTimeout(700)

  const onPaper = await page.evaluate((f) => {
    const el = document.querySelector(`.paper [data-field="${f}"]`)
    return (el?.textContent || '').trim()
  }, field)

  const ok = onPaper.includes('★')
  if (ok) pass += 1
  console.log(`  ${ok ? '✓' : '***'} ${label.padEnd(12)} 「${before}」→ 纸面「${onPaper}」`)
}

/* ---------- 点模块空白 → 选中 + 右侧卡片可见 ---------- */
/*
 * 先把就地编辑关掉再测跳转。
 * onPaperClick 里 openInlineEdit 优先于跳转：点到任何 [data-field] 都直接返回，
 * 不发起跳转。而上面的用例刚改过模块标题、编辑框可能还开着 ——
 * 不关就会把「跳转没生效」误判成功能缺陷（实测就是这么误判的）。
 */
await page.keyboard.press('Escape')
for (let i = 0; i < 12; i += 1) {
  if (!(await findEditor())) break
  await page.waitForTimeout(80)
}
console.log('\n点模块空白 → 跳转：')
const jump = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
  const sec = secs[secs.length - 2] || secs[0]
  if (!sec) return null
  sec.scrollIntoView({ block: 'center' })
  const r = sec.getBoundingClientRect()

  /*
   * 不再靠猜落点，而是**扫描出一个有效点**：
   * 必须在模块内、且不属于任何 [data-field]（否则 openInlineEdit 优先处理，跳转不发起）。
   * 前面三次都因为手写坐标误命中标题行而误判成「跳转坏了」——
   * 与其继续调数字，不如让页面自己找出满足条件的点。
   */
  for (let dy = 4; dy < r.height - 4; dy += 4) {
    for (let dx = 4; dx < r.width - 4; dx += 8) {
      const x = r.left + dx
      const y = r.top + dy
      const el = document.elementFromPoint(x, y)
      if (!el) continue
      if (!el.closest('.r-sec[data-sec-id]')) continue
      if (el.closest('[data-field]')) continue
      return { id: sec.dataset.secId, x, y, found: true }
    }
  }
  return { id: sec.dataset.secId, found: false }
})
let jumpOk = false
if (!jump) {
  console.log('  *** 找不到模块')
} else if (!jump.found) {
  console.log('  *** 扫遍整个模块也没找到「在模块内、且不是可编辑锚点」的点')
} else {
  const at = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return 'null（坐标在视口外）'
      return (
        `${el.tagName}.${String(el.className || '').split(' ')[0]}` +
        ` 在模块内=${Boolean(el.closest('.r-sec[data-sec-id]'))}` +
        ` 是可编辑锚点=${Boolean(el.closest('[data-field]'))}` +
        '（若为 true，openInlineEdit 会优先处理，跳转不会发起）'
      )
    },
    { x: jump.x, y: jump.y },
  )
  await page.mouse.click(jump.x, jump.y)
  await page.waitForTimeout(900)
  const res = await page.evaluate((id) => {
    const sec = document.querySelector(`.paper .r-sec[data-sec-id="${id}"]`)
    const card = document.querySelector(`.ed-card[data-section-id="${id}"]`)
    let visible = false
    if (card) {
      const cr = card.getBoundingClientRect()
      const body = card.closest('.panel-body')
      const br = body?.getBoundingClientRect()
      visible = br ? cr.top < br.bottom && cr.bottom > br.top : cr.top < window.innerHeight
    }
    return {
      selected: sec?.classList.contains('is-sec-selected') ?? false,
      hasCard: Boolean(card),
      visible,
    }
  }, jump.id)
  jumpOk = res.selected && res.visible
  console.log(`  落点元素: ${at}`)
  console.log(
    `  ${jumpOk ? '✓' : '***'} 选中=${res.selected} · 卡片存在=${res.hasCard} · 卡片在可视区=${res.visible}`,
  )
}

/* ---------- 按住模块文字拖动 → 换序 ---------- */
/*
 * 「点击=编辑、拖动=移动」是同一个起点上的两种意图，必须同时成立。
 * 早先为了修就地编辑，在这里对 [data-field] 一律早退，代价是**从文字上无法起手拖动**；
 * 后来发现真正的元凶是指针捕获（已推迟到拖拽激活时），于是两者可以共存。
 * 这条断言就是钉住这个共存关系 —— 任一行为退化都会在这里失败。
 */
console.log('\n按住模块文字拖动：')
let dragOk = false
let groupOk = false
{
  const titlesOf = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.paper .r-sec[data-sec-id]')].map((x) =>
        (x.querySelector('[data-field="sectionTitle"]')?.textContent || '').trim(),
      ),
    )

  // 落点必须让整块中心越过相邻模块的**中点** —— 这是 computeReorder 的判据
  const before = await titlesOf()
  const plan = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const i = Math.min(2, all.length - 2)
    const sec = all[i]
    const next = all[i + 1]
    if (!sec || !next) return null
    sec.scrollIntoView({ block: 'center' })
    const title = sec.querySelector('[data-field="sectionTitle"]')
    const tr = title?.getBoundingClientRect()
    const nr = next.getBoundingClientRect()
    return {
      // 从模块**标题文字**上起手 —— 正是早先被早退挡掉的那一类
      from: { x: tr.x + Math.min(40, tr.width / 2), y: tr.y + tr.height / 2 },
      to: { x: tr.x + Math.min(40, tr.width / 2), y: nr.top + nr.height / 2 + 30 },
      startTitle: (title?.textContent || '').trim(),
    }
  })

  if (!plan) {
    console.log('  *** 拿不到模块标题坐标')
  } else {
    await page.mouse.move(plan.from.x, plan.from.y)
    await page.mouse.down()
    for (let i = 1; i <= 22; i += 1) {
      await page.mouse.move(plan.from.x, plan.from.y + ((plan.to.y - plan.from.y) * i) / 22)
      await page.waitForTimeout(30)
    }
    await page.waitForTimeout(150)
    await page.mouse.up()
    await page.waitForTimeout(700)
    const after = await titlesOf()
    dragOk = JSON.stringify(before) !== JSON.stringify(after)
    console.log(`  ${dragOk ? '✓' : '***'} 从文字起手拖动 → ${dragOk ? '顺序已变' : '顺序未变'}`)
    if (dragOk) console.log(`      ${before.join(' / ')}  →  ${after.join(' / ')}`)
  }

  /* ---------- 框选多个模块后拖动整组 ---------- */
  console.log('\n框选后拖动整组：')
  const base = await titlesOf()
  const band = await page.evaluate(() => {
    const paper = document.querySelector('.paper')
    const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    secs[0]?.scrollIntoView({ block: 'start' })
    const r = paper.getBoundingClientRect()
    const first = secs[0]?.getBoundingClientRect()
    const third = secs[2]?.getBoundingClientRect()
    return {
      from: { x: r.left + 6, y: (first?.top ?? 0) + 4 },
      to: { x: r.right - 6, y: (third?.bottom ?? 0) - 4 },
    }
  })
  await page.mouse.move(band.from.x, band.from.y)
  await page.mouse.down()
  for (let i = 1; i <= 24; i += 1) {
    await page.mouse.move(
      band.from.x + ((band.to.x - band.from.x) * i) / 24,
      band.from.y + ((band.to.y - band.from.y) * i) / 24,
    )
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
  const selInfo = await page.evaluate(() => {
    const pick = (x) => (x.querySelector('[data-field="sectionTitle"]')?.textContent || '').trim()
    const all = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const selected = all.filter((x) => x.classList.contains('is-sec-selected')).map(pick)
    return { count: selected.length, titles: selected, allTitles: all.map(pick) }
  })
  const selCount = selInfo.count
  console.log(`  框选到 ${selCount} 个模块：${selInfo.titles.join(' / ')}`)

  if (selCount >= 2) {
    const move = await page.evaluate(() => {
      const sec = document.querySelector('.paper .r-sec.is-sec-selected')
      const all = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
      if (!sec) return null
      const idx = all.indexOf(sec)
      const target = all[all.length - 1]
      // 扫描一个有效起点（在模块内、非可编辑锚点）
      const r = sec.getBoundingClientRect()
      let from = null
      for (let dy = 2; dy < r.height - 2 && !from; dy += 3) {
        for (let dx = 2; dx < r.width - 2; dx += 10) {
          const x = r.left + dx
          const y = r.top + dy
          const el = document.elementFromPoint(x, y)
          if (!el || !el.closest('.r-sec[data-sec-id]') || el.closest('[data-field]')) continue
          from = { x, y }
          break
        }
      }
      if (!from || !target) return null
      const tr = target.getBoundingClientRect()
      return { from, to: { x: from.x, y: tr.top + tr.height / 2 + 30 }, idx }
    })
    if (!move) {
      console.log('  *** 拿不到整组拖动的坐标')
    } else {
      await page.mouse.move(move.from.x, move.from.y)
      await page.mouse.down()
      for (let i = 1; i <= 30; i += 1) {
        await page.mouse.move(move.from.x, move.from.y + ((move.to.y - move.from.y) * i) / 30)
        await page.waitForTimeout(28)
      }
      await page.waitForTimeout(150)
      await page.mouse.up()
      await page.waitForTimeout(700)
      const afterGroup = await titlesOf()
      const changed = JSON.stringify(base) !== JSON.stringify(afterGroup)
      /*
       * 「整组」的意义在于整组一起移动 —— 所以除了「顺序变了」，
       * 还要断言被选中的那几项在结果里**仍然连续**。
       * 只查「变了」会放过「组被打散」这种坏法：看起来动了，实际把一组拆开了。
       */
      const positions = selInfo.titles
        .map((t) => afterGroup.indexOf(t))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)
      const contiguous =
        positions.length === selInfo.titles.length &&
        positions.every((v, i) => i === 0 || v === positions[i - 1] + 1)
      groupOk = changed && contiguous
      console.log(
        `  ${groupOk ? '✓' : '***'} 整组拖动 → ${changed ? '顺序已变' : '顺序未变'} · 组内仍连续 = ${contiguous}`,
      )
      if (changed) console.log(`      ${afterGroup.join(' / ')}`)
      if (!contiguous) {
        console.log(
          `      *** 组被打散：选中「${selInfo.titles.join(' / ')}」在新顺序里的位置为 ${positions.join(',')}`,
        )
      }
    }
  } else {
    console.log('  *** 框选不足 2 个模块，无法验证整组拖动')
  }
}

/* ---------- 默认简历必须正好是一页 A4 ---------- */
/*
 * 这是一条**内容体积的回归闸门**，加它的原因是一次真实事故：
 * 为了让技能名显示出来，我在纸面上补了一个技能名列表（3 行）——
 * 结果示例简历从 1 页变成 2 页（纸面高度 1123px → 1143px），
 * 而示例简历原本**正好卡在一页的高度上**，任何增加都会溢出。
 *
 * 「总长度」这类模糊断言拦不住这种问题（少三个词多三个词，长度可能一样），
 * 「几页」是干净的硬指标。默认简历是给用户看的第一眼，它必须是一页。
 */
console.log('\n默认简历的页数：')
// 两条分支都要赋值：lint 会指出「初始值没被用到」，而且这里也确实需要覆盖「找不到纸面」的情况
let pagesOk
{
  const paging = await page.evaluate(() => {
    /*
     * 量的是**内容**高度，不是 .paper 的高度。
     * .paper 有 `min-height: 一页 A4`，所以它的高度恰好等于 1123px ——
     * 拿它去比 A4，永远得出「余量 0px」，完全看不出还有多少空间。
     * （这一条我自己先量错过一次：报告「余量 0px」，实际余量 28px。）
     *
     * 真正该比的是：内容容器高度 vs 纸面**去掉内边距后**的可用高度。
     */
    const paper = document.querySelector('.paper')
    if (!paper) return null
    const cs = getComputedStyle(paper)
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const available = paper.clientHeight - pad
    // 内容 = 纸面里实际承载模板的那个子元素（取最高的）
    const content = Math.max(
      0,
      ...[...paper.children].map((el) => el.getBoundingClientRect().height),
    )
    const shown = /(\d+)\s*页/.exec(document.body.innerText || '')
    return {
      available: Math.round(available),
      content: Math.round(content),
      shownPages: shown ? Number(shown[1]) : null,
    }
  })

  if (!paging) {
    pagesOk = false
    console.log('  *** 找不到 .paper，无法判断页数')
  } else {
    const slack = paging.available - paging.content
    pagesOk = paging.shownPages === 1 && slack >= 0
    console.log(
      `  ${pagesOk ? '✓' : '***'} 界面显示 ${paging.shownPages} 页 · 内容 ${paging.content}px / 可用 ${paging.available}px · ${
        slack >= 0 ? `余量 ${slack}px` : `*** 超出 ${-slack}px`
      }`,
    )
    if (!pagesOk) {
      console.log('      *** 默认简历不是一页：内容体积增加了。')
      console.log(
        '          要么收排版，要么这属于「默认简历本来就该更长」的有意决定（那就调整本断言）。',
      )
    } else if (slack < 10) {
      // 余量太小时提示：不同机器的字体度量略有差异，卡得太紧会在别处溢出成两页
      console.log(
        `      （余量偏小，仅 ${slack}px。字体度量在不同机器上会有差异，太紧容易在别处溢出）`,
      )
    }
  }
}

console.log('')
console.log(
  `就地编辑 ${pass}/${CASES.length} · 跳转 ${jumpOk ? 1 : 0}/1 · 文字拖动换序 ${dragOk ? 1 : 0}/1 · 整组拖动 ${groupOk ? 1 : 0}/1 · 一页 ${pagesOk ? 1 : 0}/1`,
)
console.log('运行时错误:', errors.length ? errors.join(' | ') : '无')
const ok = pass === CASES.length && jumpOk && dragOk && groupOk && pagesOk && !errors.length
console.log(ok ? '纸面行为：全部通过' : '纸面行为：*** 有未通过项 ***')
await browser.close()
process.exit(ok ? 0 : 1)
