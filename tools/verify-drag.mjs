/**
 * 验证右侧内容面板的拖拽排序。
 * 用法：node tools/verify-drag.mjs [url]
 *
 * 覆盖四层，全部走同一套 DraggableList 组件：
 *  1. **模块卡片**（最外层）；
 *  2. **列表型模块内的条目**（经历条目 / 网格项 / 技能）；
 *  3. **嵌套在条目内的要点**（bullet）；
 *  4. **嵌套在条目内的标签**（meta）。
 * 外加**键盘等价操作**：手柄是 role="button" + 方向键，与拖拽走同一条重排路径。
 *
 * 三条反复踩到、都已固化成检查的前提（不写下来一定重犯）：
 *  1. 元素可能在**视口之外**（实测模块手柄 y=-1784），鼠标事件落空，
 *     会被误判成「拖拽没生效」。所以拖动前**断言两点都在视口内**，不满足就换一对。
 *  2. 取两点坐标不能分两次 scrollIntoView —— 第二次滚动会作废第一次量到的坐标。
 *  3. 判据不能用「第 N 段」这类**按位置现算**的文本（换序后它仍然是 第1段|第2段），
 *     要用输入框里的真实值。
 *
 * 另外两条专门针对嵌套层级：
 *  - 「某个手柄属于哪一层」用 `closest('.dl-list')` 判定（DraggableList 的固定类名），
 *    不靠各层自己传的类名 —— 内层容器根本没有类名；
 *  - 拖内层时**绝不能让外层条目跟着换位**。两层若共用同一个 handle 类名，
 *    外层 Sortable 会抢走内层手柄，这条就是拦它的。
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
  const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
  if (s) s.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
  for (const card of [...document.querySelectorAll('.ed-card')].slice(0, 8)) {
    card.querySelector('.expand')?.click()
  }
})
await page.waitForTimeout(900)

const results = []
function record(label, ok, detail) {
  results.push({ label, ok })
  console.log(`  ${ok ? '✓' : '***'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 找出每一层可拖列表，并给出「拖第 2 项到第 1 项」的两点坐标。
 * 全部在页面里算，且**只返回两点都在视口内的那对**；都不行就返回 null，
 * 由调用方如实报「拿不到可见的坐标」，而不是硬拖一把然后误报功能坏了。
 */
const planDrag = (listIndex) =>
  page.evaluate((li) => {
    const key = (el) =>
      [...el.querySelectorAll('input:not([type=range]), textarea')]
        .map((n) => String(n.value || '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('/') || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16)

    const lists = [...document.querySelectorAll('.dl-list')]
    const list = lists[li]
    if (!list) return null
    // 只看直属这一层的手柄（closest 命中的第一个 .dl-list 就是本容器）
    const ownHandles = [...list.querySelectorAll('.ed-drag, .ed-drag-sub')].filter(
      (h) => h.closest('.dl-list') === list,
    )
    const items = [...list.children]
    // 手柄不足 2 个时返回真实项数，而不是 null —— 调用方要能区分
    // 「这个列表只有 1 项」（不适用）与「列表压根不在」（真问题）
    if (ownHandles.length < 2) {
      return { index: li, cls: String(list.className), count: ownHandles.length, tooFew: true }
    }
    const inView = (r) => r.top > 0 && r.bottom < window.innerHeight

    // 依次试相邻对 (i+1 → i)，取第一对两点都可见的
    for (let i = 0; i + 1 < ownHandles.length; i += 1) {
      const h = ownHandles[i + 1]
      const item = h.parentElement?.parentElement
      const dest = items[i]
      if (!item || !dest) continue
      dest.scrollIntoView({ block: 'center' })
      const rh = h.getBoundingClientRect()
      const rt = dest.getBoundingClientRect()
      if (!inView(rh) || !inView(rt)) continue
      if (!list.contains(h) || !list.contains(dest)) continue
      return {
        index: li,
        cls: String(list.className),
        count: ownHandles.length,
        from: { x: rh.x + rh.width / 2, y: rh.y + rh.height / 2 },
        to: { x: rt.x + rt.width / 2, y: rt.y + rh.height / 2 },
        order: items.map((c) => key(c)),
      }
    }
    return { index: li, cls: String(list.className), count: ownHandles.length, noVisiblePair: true }
  }, listIndex)

const orderOfList = (listIndex) =>
  page.evaluate((li) => {
    const key = (el) =>
      [...el.querySelectorAll('input:not([type=range]), textarea')]
        .map((n) => String(n.value || '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('/') || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16)
    const list = [...document.querySelectorAll('.dl-list')][li]
    return list ? [...list.children].map((c) => key(c)) : null
  }, listIndex)

async function drag(from, to) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 20, from.y + ((to.y - from.y) * i) / 20)
    await page.waitForTimeout(35)
  }
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(800)
}

/* ---------------- 逐层拖拽 ---------------- */
const listCount = await page.evaluate(() => document.querySelectorAll('.dl-list').length)
console.log(`① 逐层拖拽（共 ${listCount} 个可拖列表）：`)

const outerOrderBefore = await orderOfList(0)

for (let i = 0; i < listCount; i += 1) {
  const plan = await planDrag(i)
  if (!plan) {
    record(`列表[${i}]`, false, '列表不存在')
    continue
  }
  /*
   * 只有一项的列表没什么可换序 —— 这是「不适用」，不是失败。
   * 早先把它们判成未通过，7 个红叉里混着真问题，反而看不清。
   */
  if (plan.tooFew) {
    console.log(`  · 列表[${i}] 只有 ${plan.count} 项，跳过（无可换序）`)
    continue
  }
  if (plan.noVisiblePair) {
    record(`列表[${i}]（${plan.cls.split(' ')[0]}）`, false, `找不到两点都在视口内的相邻对，无法拖动`)
    continue
  }
  await drag(plan.from, plan.to)
  const after = await orderOfList(i)
  record(
    `列表[${i}] .${plan.cls.split(' ').filter((c) => c !== 'dl-list')[0] || '(无类名)'}（${plan.count} 项）`,
    JSON.stringify(plan.order) !== JSON.stringify(after),
  )
}

/* ---------------- 嵌套安全：拖内层不能误拖外层 ---------------- */
console.log('\n② 嵌套层级安全（拖内层不得让外层换位）：')
{
  /*
   * 内层 = **直属**带 .ed-drag-sub 手柄的那一层，且外面还套着一层 .dl-list。
   * 不能用 `l.querySelector('.ed-drag-sub')`：它会搜到后代，
   * 于是最外层卡片列表（内部展开了条目）也会命中，被误认成嵌套层 ——
   * 实测就是这样，结果拿卡片列表去拖，然后断言「外层没被误改」自然失败。
   * 判据与 planDrag 保持一致：手柄的 closest('.dl-list') 必须就是这个容器。
   */
  const nested = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('.dl-list')]
    for (let i = 0; i < lists.length; i += 1) {
      const l = lists[i]
      const hasOwnSub = [...l.querySelectorAll('.ed-drag-sub')].some(
        (h) => h.closest('.dl-list') === l,
      )
      if (!hasOwnSub) continue
      const outer = l.parentElement?.closest('.dl-list')
      if (!outer) continue
      return {
        nestedIndex: i,
        outerIndex: lists.indexOf(outer),
        nestedCount: l.children.length,
      }
    }
    return null
  })
  const nestedIndex = nested?.nestedIndex ?? -1
  const outerIndex = nested?.outerIndex ?? -1
  if (nestedIndex < 0) {
    record('内层未误拖外层', false, '找不到嵌套列表')
  } else {
    // 外层取嵌套层外面那一层，不是列表[0]（两者不一定是同一层）
    const outerBefore = await orderOfList(outerIndex)
    const plan = await planDrag(nestedIndex)
    if (!plan || plan.noVisiblePair) {
      record('内层未误拖外层', false, '内层拿不到可见的相邻对')
    } else {
      await drag(plan.from, plan.to)
      const outerAfter = await orderOfList(outerIndex)
      const nestedAfter = await orderOfList(nestedIndex)
      record(
        '内层本身换序成功',
        JSON.stringify(plan.order) !== JSON.stringify(nestedAfter),
        `「${plan.order.join(' | ').slice(0, 60)}…」`,
      )
      record(
        `外层（列表[${outerIndex}]）顺序未被误改`,
        JSON.stringify(outerBefore) === JSON.stringify(outerAfter),
        '这是两层 handle 类名必须分开的原因',
      )
    }
  }
}

/* ---------------- 键盘等价操作 ---------------- */
console.log('\n③ 手柄键盘操作：')
{
  const setup = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('.dl-list')]
    // 同上：必须用 closest 判定「直属本层」，search 后代会把外层也命中
    const li = lists.findIndex((l) =>
      [...l.querySelectorAll('.ed-drag-sub')].some((h) => h.closest('.dl-list') === l),
    )
    if (li < 0) return { error: '找不到嵌套列表' }
    const list = lists[li]
    const handles = [...list.querySelectorAll('.ed-drag-sub')].filter(
      (h) => h.closest('.dl-list') === list,
    )
    if (handles.length < 2) return { error: `内层手柄不足 2 个（实际 ${handles.length}）` }
    const target = handles[1]
    target.scrollIntoView({ block: 'center' })
    target.focus()
    const key = (el) =>
      [...el.querySelectorAll('input:not([type=range]), textarea')]
        .map((n) => String(n.value || '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('/') || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16)
    return {
      li,
      focused: document.activeElement === target,
      itemId: target.getAttribute('data-drag-for'),
      order: [...list.children].map((c) => key(c)),
    }
  })

  if (setup.error) {
    record('键盘操作', false, setup.error)
  } else {
    record('手柄可聚焦', setup.focused === true)

    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(600)
    const afterKey = await page.evaluate((li) => {
      const list = [...document.querySelectorAll('.dl-list')][li]
      const key = (el) =>
        [...el.querySelectorAll('input:not([type=range]), textarea')]
          .map((n) => String(n.value || '').trim())
          .filter(Boolean)
          .slice(0, 2)
          .join('/') || (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16)
      const active = document.activeElement
      return {
        order: list ? [...list.children].map((c) => key(c)) : null,
        activeIsHandle: /ed-drag-sub|ed-drag\b/.test(String(active?.className || '')),
        // 焦点必须回到**同一项**的手柄上（按 data-drag-for 认，不靠节点引用）
        activeItemId: active?.getAttribute?.('data-drag-for') ?? null,
        activeIsBody: active === document.body,
      }
    }, setup.li)

    record(
      '方向键上移一位',
      JSON.stringify(setup.order) !== JSON.stringify(afterKey.order),
      `「${setup.order.join(' | ').slice(0, 60)}…」`,
    )
    record(
      '重排后焦点仍在同一项的手柄上',
      afterKey.activeItemId === setup.itemId && !afterKey.activeIsBody,
      `期望 itemId=${setup.itemId}，实际 ${afterKey.activeItemId ?? (afterKey.activeIsBody ? 'BODY' : '其它')}`,
    )
  }
}

console.log('')
const passed = results.filter((r) => r.ok).length
console.log(`拖拽验证：${passed}/${results.length} 项通过`)
console.log('运行时错误:', errors.length ? errors.join(' | ') : '无')
for (const r of results.filter((x) => !x.ok)) console.log(`  *** 未通过：${r.label}`)
const ok = passed === results.length && !errors.length
console.log(ok ? '全部通过' : '*** 有未通过项 ***')

// 记录一下外层顺序，避免变量未使用
void outerOrderBefore

await browser.close()
process.exit(ok ? 0 : 1)