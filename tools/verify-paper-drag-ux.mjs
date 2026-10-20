/**
 * 纸面拖拽的体验验证：能不能起手、拖多远换位、拖动时有没有落点提示。
 * 用法：node tools/verify-paper-drag-ux.mjs [base]
 *
 * 这一条来自用户反馈「在简历上直接拖拽更改位置，有些无法拖拽」。
 * 逐点起手其实都能拖（见下），真正的体感问题有两个：
 *  1. **换位门槛太高**：原先用「整块中心越过相邻块中心」判定，
 *     相邻等高模块要拖满一整个模块高（实测 204px 高的模块需要拖 220px）。
 *     拖 180px 松手会弹回原位 —— 用户看到模块明明跟着手走到了别处，
 *     却什么都没发生，体感就是「拖不动」。
 *     现在改成「被拖动块的边缘越过相邻块中线」，门槛约半个模块高。
 *  2. **没有落点提示**：模块跟着手在动，但看不出松手会插到哪里，
 *     于是「拖了没换位」与「拖了但没拖够」在视觉上是同一件事。
 *     现在拖动时会在目标插入位置画一条指示线。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'msedge' })
const results = []

function record(label, ok, detail) {
  results.push({ label, ok })
  console.log(`  ${ok ? '✓' : '***'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function openEditor() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1400)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
    if (s) s.click()
  })
  await page.waitForTimeout(400)
  return page
}

const titles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.paper .r-sec[data-sec-id]')].map((s) =>
      (s.querySelector('[data-field="sectionTitle"]')?.textContent || '').trim(),
    ),
  )

/* ---------- 1. 各处的文字都能起手拖动 ---------- */
console.log('① 起手（不同位置的文字）：')
{
  const targets = [
    ['模块标题', '[data-field="sectionTitle"]'],
    ['网格项值', '[data-field="gridValue"]'],
    ['条目机构', '[data-field="entryOrg"]'],
    ['要点文本', '[data-field="bulletText"]'],
    ['技能值', '[data-field="skillValue"]'],
    ['段落正文', '[data-field="content"]'],
  ]
  for (const [label, sel] of targets) {
    const page = await openEditor()
    const pt = await page.evaluate((s) => {
      const el = document.querySelector(`.paper .r-sec ${s}`)
      if (!el) return null
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      return true
    }, sel)
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    const p = await page.evaluate((s) => {
      const el = document.querySelector(`.paper .r-sec ${s}`)
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, sel)
    if (!pt || !p) {
      record(`${label} 可起手`, false, '元素不存在')
      await page.close()
      continue
    }
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 10, { steps: 3 })
    await page.waitForTimeout(120)
    const dragging = await page.evaluate(
      () => !!document.querySelector('.paper.is-sec-dragging'),
    )
    await page.keyboard.press('Escape')
    await page.mouse.up()
    record(`${label} 可起手`, dragging)
    await page.close()
  }
}

/* ---------- 2. 换位门槛不超过 0.7 个模块高 ---------- */
console.log('\n② 换位门槛：')
{
  const page = await openEditor()
  const plan = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const a = secs[1]
    const b = secs[2]
    if (!a || !b) return null
    a.scrollIntoView({ block: 'center', behavior: 'instant' })
    const ra = a.getBoundingClientRect()
    return { x: ra.left + ra.width / 2, y: ra.top + 10, aH: Math.round(ra.height) }
  })
  await page.close()
  if (!plan) {
    record('换位门槛', false, '拿不到模块')
  } else {
    /** 试一次：返回是否换位 */
    const attempt = async (dy) => {
      const p = await openEditor()
      const pt = await p.evaluate(() => {
        const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
        const a = secs[1]
        a.scrollIntoView({ block: 'center', behavior: 'instant' })
        const ra = a.getBoundingClientRect()
        return { x: ra.left + ra.width / 2, y: ra.top + 10 }
      })
      const before = await titles(p)
      await p.mouse.move(pt.x, pt.y)
      await p.mouse.down()
      await p.mouse.move(pt.x, pt.y + dy, { steps: 10 })
      await p.waitForTimeout(160)
      await p.mouse.up()
      await p.waitForTimeout(420)
      const after = await titles(p)
      await p.close()
      return JSON.stringify(before) !== JSON.stringify(after)
    }

    // 门槛应当明显小于一个模块高；0.7 倍高度内必须能换位
    const limit = Math.round(plan.aH * 0.7)
    const ok = await attempt(limit)
    record(
      `拖 ${limit}px（0.7 个模块高，模块高 ${plan.aH}px）就能换位`,
      ok,
      ok ? '换位成功' : '仍未换位 —— 门槛还是太高',
    )
    // 反向确认：小位移不该误触发
    const noMove = await attempt(20)
    record('拖 20px 不会误换位（保留防抖）', !noMove)
  }
}

/* ---------- 3. 拖动时出现落点指示线 ---------- */
console.log('\n③ 落点提示：')
{
  const page = await openEditor()
  const pt = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const a = secs[1]
    a.scrollIntoView({ block: 'center', behavior: 'instant' })
    const ra = a.getBoundingClientRect()
    return { x: ra.left + ra.width / 2, y: ra.top + 10 }
  })

  const beforeDrag = await page.evaluate(() => !!document.querySelector('.drop-line'))
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.mouse.move(pt.x, pt.y + 40, { steps: 6 })
  await page.waitForTimeout(150)
  const during = await page.evaluate(() => {
    const el = document.querySelector('.drop-line')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { visible: r.width > 0, width: Math.round(r.width), top: Math.round(r.top) }
  })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(200)
  const afterDrag = await page.evaluate(() => !!document.querySelector('.drop-line'))

  record('未拖动时没有指示线', !beforeDrag)
  record('拖动时出现指示线', Boolean(during?.visible), during ? `宽 ${during.width}px` : '(没有)')
  record('松手后指示线消失', !afterDrag)
  await page.close()
}

/* ---------- 3b. 下方模块实时让位（不重叠） ---------- */
/*
 * 这一条是本轮最关键的视觉改进。
 * 只把被拖块平移上去的话，它会**盖住**下面的模块（实测重叠 55px），
 * 两层文字叠在一起像乱码，用户也判断不出松手会插到哪。
 * 所以拖动时要让插入点之后的模块整体下移，腾出空位 —— 视觉上才是"插进去了"。
 */
console.log('\n③b 下方模块让位：')
{
  const page = await openEditor()
  const pt = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const a = secs[1]
    a.scrollIntoView({ block: 'center', behavior: 'instant' })
    const ra = a.getBoundingClientRect()
    return { x: ra.left + ra.width / 2, y: ra.top + 10 }
  })
  const beforeTops = await page.evaluate(() =>
    [...document.querySelectorAll('.paper .r-sec[data-sec-id]')].map((s) =>
      Math.round(s.getBoundingClientRect().top),
    ),
  )

  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.mouse.move(pt.x, pt.y + 70, { steps: 6 })
  await page.waitForTimeout(200)

  const during = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const rects = secs.map((s) => {
      const r = s.getBoundingClientRect()
      return {
        title: (s.querySelector('[data-field="sectionTitle"]')?.textContent || '').trim(),
        selected: s.classList.contains('is-sec-selected'),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
      }
    })
    // 任意两个模块（含被拖块）之间不应出现重叠
    const overlaps = []
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const ov =
          Math.min(rects[i].bottom, rects[j].bottom) - Math.max(rects[i].top, rects[j].top)
        if (ov > 2) overlaps.push(`${rects[i].title}×${rects[j].title} ${ov}px`)
      }
    }
    return { rects, overlaps }
  })

  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(300)

  record('拖动时模块之间不重叠', during.overlaps.length === 0, during.overlaps.join(' · ') || '无重叠')

  // 插入点之后的模块确实下移了
  const moved = during.rects.filter((r, i) => r.top !== beforeTops[i])
  record(
    '插入点之后的模块让位（位置发生变化）',
    moved.length > 0,
    `${moved.length} 个模块移动：${moved.map((m) => m.title).join('、')}`,
  )

  // 松手后所有偏移复位，不能有模块停在偏移位置
  const residue = await page.evaluate(() =>
    [...document.querySelectorAll('.paper .r-sec[data-sec-id]')].filter(
      (s) => s.style.transform && s.style.transform !== 'none',
    ).length,
  )
  record('松手后没有模块停在偏移位置', residue === 0, `残留 ${residue} 个`)
  await page.close()
}

/* ---------- 4. 指示线位置与实际落点一致 ---------- */
console.log('\n④ 指示线是否"说到做到"：')
{
  const page = await openEditor()
  const pt = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const a = secs[1]
    a.scrollIntoView({ block: 'center', behavior: 'instant' })
    const ra = a.getBoundingClientRect()
    return { x: ra.left + ra.width / 2, y: ra.top + 10 }
  })
  const before = await titles(page)

  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.mouse.move(pt.x, pt.y + 130, { steps: 10 })
  await page.waitForTimeout(160)
  // 记录指示线位置与它对应的那个模块
  const line = await page.evaluate(() => {
    const el = document.querySelector('.drop-line')
    if (!el) return null
    const r = el.getBoundingClientRect()
    // 指示线下方最近的模块标题
    const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
    const below = secs.find((s) => s.getBoundingClientRect().top >= r.top - 2)
    return {
      top: Math.round(r.top),
      belowTitle: below
        ? (below.querySelector('[data-field="sectionTitle"]')?.textContent || '').trim()
        : '(末尾)',
    }
  })
  await page.mouse.up()
  await page.waitForTimeout(450)
  const after = await titles(page)
  await page.close()

  if (!line) {
    record('指示线位置与落点一致', false, '拖动时没有指示线')
  } else {
    // 松手后，被拖的模块应当紧邻指示线指向的那个模块之前
    const moved = before[1]
    const idx = after.indexOf(moved)
    const belowIdx = after.indexOf(line.belowTitle)
    const consistent = belowIdx === -1 ? idx === after.length - 1 : idx === belowIdx - 1
    record(
      '指示线位置与落点一致',
      consistent,
      `线指向「${line.belowTitle}」· 松手后「${moved}」在第 ${idx + 1} 位`,
    )
    if (!consistent) console.log(`      ${after.join(' / ')}`)
  }
}

await browser.close()
const passed = results.filter((r) => r.ok).length
console.log(`\n纸面拖拽体验：${passed}/${results.length} 项通过`)
for (const r of results.filter((x) => !x.ok)) console.log(`  *** 未通过：${r.label}`)
process.exit(passed === results.length ? 0 : 1)