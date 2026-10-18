/**
 * 验证下拉框已统一到 BaseSelect，并且**真的还能用**。
 * 用法：node tools/verify-selects.mjs [url]
 *
 * 为什么要有它：这轮把 12 处原生 <select> 统一成一个组件，涉及
 * 「取值 / 派发 change / 分组选项 / undefined 占位项 / 尺寸变体」五类差异。
 * 类型检查只能保证 prop 形状对，**不能保证选中后值真的写回 store** ——
 * 而「下拉能打开、选了却没反应」正是这类重构最典型的坏法。
 *
 * 判定：
 *  1. 页面上不应再有裸 <select class="ed-select">（未迁移的残留）；
 *  2. 每个下拉都有自绘箭头（说明走的是 BaseSelect）；
 *  3. 换一个值之后，选中项真的变了（功能没坏）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../server/node_modules/playwright-core/index.mjs'

import { startAdminServer } from './admin-harness.mjs'

/*
 * 源码级守门：用了 <BaseSelect 却没有 import 它。
 *
 * 这个错误**编译 / 类型检查 / lint 全都发现不了** —— Vue 把未注册的自定义组件
 * 当成未知元素渲染成空，于是整个下拉直接消失，只在运行时才看得出来。
 * 本轮实测就漏了两处（TypographySection 的字体下拉、GridSectionEditor 的图标下拉），
 * 而当时 tsc / lint / build 全绿。所以在这里用正则先扫一遍，
 * 免得再依赖「跑起来看看」这种容易漏的发现方式。
 */
function assertComponentsImported() {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
  const problems = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.vue')) {
        const text = readFileSync(full, 'utf8')
        if (text.includes('<BaseSelect') && !/import BaseSelect from/.test(text)) {
          problems.push(full.slice(srcDir.length))
        }
      }
    }
  }
  walk(srcDir)
  if (problems.length) {
    throw new Error(
      `以下文件用了 <BaseSelect 但没有 import（Vue 会把它渲染成空，下拉会整个消失，而编译/类型/lint 都不报）：\n  ${problems.join('\n  ')}`,
    )
  }
}

/*
 * 管理后台那一段走的是**临时服务的 dist 构建产物**（server/index.ts 用 express.static(dist)），
 * 不是 Vite 开发服务。踩过一次很贵的坑：DIst 比源码旧，于是整段管理后台验证
 * 都在对着旧代码跑 —— 「通过」是假的，真正的问题（undefined 选项的 value 退化）
 * 被掩盖了两轮。所以这里先比一次 mtime，dist 比源码旧就直接失败退出。
 */
function assertDistFresh() {
  const distIndex = new URL('../dist/index.html', import.meta.url)
  const srcDir = new URL('../src/', import.meta.url)
  let distTime
  try {
    distTime = statSync(distIndex).mtimeMs
  } catch {
    throw new Error('dist/index.html 不存在 —— 管理后台验证需要先 npm run build')
  }
  let newest = 0
  let newestFile = ''
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const t = statSync(full).mtimeMs
        if (t > newest) {
          newest = t
          newestFile = entry.name
        }
      }
    }
  }
  walk(fileURLToPath(srcDir))
  if (newest > distTime) {
    throw new Error(
      `dist 比源码旧（最新源码 ${newestFile}），管理后台验证会对着旧构建跑出假通过。请先 npm run build`,
    )
  }
}

const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 120)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 120))
})

/** 打开引导弹窗（首次进入会拦一层） */
async function dismissOnboarding() {
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
    if (s) s.click()
  })
  await page.waitForTimeout(300)
}

/** 展开全部模块卡片，让内容面板里的下拉都渲染出来 */
async function expandCards() {
  await page.evaluate(() => {
    for (const card of [...document.querySelectorAll('.ed-card')].slice(0, 8)) {
      card.querySelector('.expand')?.click()
    }
  })
  await page.waitForTimeout(800)
}

/**
 * 量下拉的统一情况。
 *
 * **必须区分「可见」与「在隐藏面板里」**：内容面板与设计面板同时挂在 DOM 上，
 * 只有一个显示。隐藏侧的元素 getBoundingClientRect() 全是 0 ——
 * 早先把「宽度为 0」当问题报，其实是隐藏面板里的正常元素（实测误报了一轮，
 * 还让我去改了一个本来没问题的 flex 规则）。所以宽度只对可见元素判定。
 */
const inspect = () =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('select')]
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return true
      // offsetParent 为 null 说明自身或祖先 display:none
      return false
    }
    const shown = all.filter(visible)
    return {
      total: all.length,
      visible: shown.length,
      // 未迁移的残留：带旧 class 的原生 select
      legacy: all.filter((s) => s.classList.contains('ed-select')).length,
      // 走了 BaseSelect 的：外层 .bsel
      wrapped: all.filter((s) => s.closest('.bsel')).length,
      withChevron: all.filter((s) => s.parentElement?.querySelector('.bsel-chevron')).length,
      dense: all.filter((s) => s.closest('.bsel')?.classList.contains('is-dense')).length,
      // 只对可见元素判宽度：可见却塌成 0 才是真问题（例如容器塌陷）
      widthZero: shown.filter((s) => s.getBoundingClientRect().width < 20).length,
    }
  })

let pagePass = 0
let pageTotal = 0

async function checkPage(label, url, prepare) {
  pageTotal += 1
  await page.goto(`${base}${url}`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1200)
  await dismissOnboarding()
  if (prepare) await prepare()

  const st = await inspect()
  const ok = st.legacy === 0 && st.total > 0 && st.wrapped === st.total && st.widthZero === 0
  if (ok) pagePass += 1
  console.log(
    `  ${ok ? '✓' : '***'} ${label.padEnd(14)} 下拉 ${st.total} 个（可见 ${st.visible}）· 未迁移 ${st.legacy} · 走组件 ${st.wrapped} · 有箭头 ${st.withChevron} · 尺寸变体 ${st.dense} · 可见里宽度为 0 的 ${st.widthZero}`,
  )
  return st.total
}

console.log('① 各页面下拉的统一情况：')
await checkPage('编辑器', '/editor', expandCards)

// 打开「设计」页签，字体下拉在那里
await page.goto(`${base}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await dismissOnboarding()
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.panel-tabs button')].find((b) => (b.textContent || '').includes('设计'))
  tab?.click()
})
await page.waitForTimeout(900)
{
  const st = await inspect()
  const ok = st.legacy === 0 && st.total > 0 && st.wrapped === st.total && st.widthZero === 0
  if (ok) pagePass += 1
  pageTotal += 1
  console.log(
    `  ${ok ? '✓' : '***'} ${'设计面板'.padEnd(12)} 下拉 ${st.total} 个（可见 ${st.visible}）· 未迁移 ${st.legacy} · 走组件 ${st.wrapped} · 有箭头 ${st.withChevron} · 可见里宽度为 0 的 ${st.widthZero}（含分组字体下拉）`,
  )
}

/* ---------- ② 功能：换值后真的变了 ---------- */
console.log('\n② 功能验证（换一个值，看选中项是否变化）：')
await page.goto(`${base}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await dismissOnboarding()
await expandCards()

const results = await page.evaluate(() => {
  const out = []
  const selects = [...document.querySelectorAll('select')].slice(0, 6)
  for (const sel of selects) {
    const options = [...sel.options].filter((o) => !o.disabled && o.value !== '')
    if (options.length < 2) continue
    const label = sel.closest('.bsel') ? 'BaseSelect' : '原生'
    const before = sel.value
    // 选一个不同的
    const next = options.find((o) => o.value !== before)
    if (!next) continue
    sel.value = next.value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    out.push({ label, before, picked: next.value, text: next.textContent.trim().slice(0, 12) })
  }
  return out
})

// 等 Vue 把变化渲染回 DOM，再核对当前值
await page.waitForTimeout(700)
const afterValues = await page.evaluate(() =>
  [...document.querySelectorAll('select')].slice(0, 6).map((s) => s.value),
)

let changed = 0
for (const [i, r] of results.entries()) {
  const now = afterValues[i]
  const ok = now === r.picked
  if (ok) changed += 1
  console.log(
    `  ${ok ? '✓' : '***'} ${r.label} 选「${r.text}」-> DOM 现值 ${now === r.picked ? '已跟随' : `未跟随（${now}）`}`,
  )
}

/* ---------- ③ 管理后台的下拉（最易坏：含 undefined 占位项与 EnumOption 映射） ---------- */
console.log('\n③ 管理后台下拉（临时库 + 临时管理员）：')
let adminOk = 0
let adminTotal = 0
let admin
try {
  assertComponentsImported()
  assertDistFresh()
  admin = await startAdminServer({ username: 'sel-check', password: 'sel-check-local' })
  await page.context().addCookies([
    { name: 'rs_session', value: admin.token, url: admin.base, httpOnly: true, sameSite: 'Lax' },
  ])
  await page.goto(`${admin.base}/admin`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1500)

  /*
   * 下拉只在「进入某个风格的编辑态」之后才渲染 —— 先点开编辑，
   * 否则会在空页面上检查，报出「没有渲染出任何下拉」这种误导性的失败。
   */
  const entered = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => /编辑/.test(b.getAttribute('title') || '') || /编辑/.test(b.textContent || ''),
    )
    if (!btn) return false
    btn.click()
    return true
  })
  await page.waitForTimeout(800)
  if (!entered) console.log('  · 没找到「编辑」按钮，下面的下拉检查可能不稳')

  adminTotal += 1
  const st = await inspect()
  if (st.total === 0) {
    console.log('  *** 管理页没有渲染出任何下拉（可能未登录或没进到编辑态）')
  } else {
    const ok = st.legacy === 0 && st.wrapped === st.total && st.widthZero === 0
    if (ok) adminOk += 1
    console.log(
      `  ${ok ? '✓' : '***'} 管理页          下拉 ${st.total} 个（可见 ${st.visible}）· 未迁移 ${st.legacy} · 走组件 ${st.wrapped} · 可见里宽度为 0 的 ${st.widthZero}`,
    )
  }

  /*
   * 单独确认「字体（可选）」那处：它的首项是空值项，
   * DOM 里的值必须是空字符串（不能是字面量 "undefined"），否则 store 会存下脏值。
   * 这是整批迁移里唯一一处 undefined 语义，值得点名验。
   */
  adminTotal += 1
  const fontSel = await page.evaluate(() => {
    // 判据同上：同时具备空值项与实值项才算字体下拉（不靠标签文字）
    const sel = [...document.querySelectorAll('select')].find((s2) => {
      const os = [...s2.options]
      return os.some((o) => o.value === '') && os.some((o) => o.value !== '')
    })
    if (!sel) return null
    const opts = [...sel.options]
    const empty = opts.find((o) => o.value === '')
    const real = opts.find((o) => o.value !== '' && !o.disabled)
    return {
      hasEmptyOption: Boolean(empty),
      // 标签应由调用点决定（这里是「跟随简历当前字体」），不该被组件换成通用占位文案
      emptyLabel: empty?.textContent?.trim() ?? null,
      // 关键：不能出现字面量 "undefined" 作为 value
      literalUndefined: opts.some((o) => o.value === 'undefined'),
      optionCount: opts.length,
      realLabel: real?.textContent?.trim() ?? null,
      hasGroupedOptions: sel.querySelectorAll('optgroup').length,
    }
  })
  if (!fontSel) {
    console.log('  *** 字体（可选）下拉未找到（可能没进入风格编辑态）')
  } else {
    const basicOk = fontSel.hasEmptyOption && !fontSel.literalUndefined
    if (basicOk) adminOk += 1
    console.log(
      `  ${basicOk ? '✓' : '***'} 字体空值项      有空值项=${fontSel.hasEmptyOption}（「${fontSel.emptyLabel}」）· 选项 ${fontSel.optionCount} 个 · 出现字面量 "undefined"=${fontSel.literalUndefined}`,
    )
  }

  /*
   * 空值项与实值项之间来回切一次。
   * 功能测试那一段特意排除了值为空的选项，所以**恰好绕过了这个 undefined 语义** ——
   * 而它是整批迁移里唯一需要双向转换的地方（DOM 空字符串 ⇄ undefined），
   * 必须单独验：只验「能选上实值」不足以说明「能清回 undefined」。
   */
  adminTotal += 1
  const roundTrip = await page.evaluate(async () => {
    /*
     * 认这个下拉要靠「同时有空值项和实值项」，不能靠标签里有没有「跟随」——
     * 空值项自己的标签就是「跟随简历当前字体」（也含「跟随」），
     * 于是会把空值项当成实值项，验证就变成了「空值→空值」，是假通过（实测踩过）。
     */
    const sel = [...document.querySelectorAll('select')].find((s2) => {
      const os = [...s2.options]
      return os.some((o) => o.value === '') && os.some((o) => o.value !== '')
    })
    if (!sel) return { error: '找不到字体下拉' }
    const opts = [...sel.options]
    const emptyOpt = opts.find((o) => o.value === '')
    // 实值项要排除空值项本身：用「值非空」判断，不看标签
    const realOpt = opts.find((o) => o.value !== '' && !o.disabled)
    // 诊断：把选项原样带出来，避免再次「以为是字体下拉、其实不是」
    const dump = opts.slice(0, 4).map((o) => `value=${JSON.stringify(o.value)} label=${JSON.stringify((o.textContent || '').trim().slice(0, 10))}`)
    // 原始 HTML：能看出 :value="undefined" 到底渲染成了什么
    const rawHtml = sel.outerHTML.split('</option>').slice(0, 3).join('</option>') + '</option>'
    if (!emptyOpt || !realOpt) return { error: '缺少实值项或空值项' }

    const fire = (v) => {
      sel.value = v
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }

    // 已选实值 → 切到空值项
    fire(realOpt.value)
    await new Promise((r) => setTimeout(r, 250))
    const afterReal = sel.value
    fire('')
    await new Promise((r) => setTimeout(r, 350))
    const afterEmpty = sel.value
    return {
      dump,
      rawHtml,
      realValue: realOpt.value,
      afterReal,
      afterEmpty,
      // 切到空值项后 DOM 值应为空字符串（不是 "undefined"、也不该停在旧实值）
      cleared: afterEmpty === '' && afterReal === realOpt.value,
    }
  })
  if (roundTrip.error) {
    console.log(`  *** 空值往返        ${roundTrip.error}`)
  } else {
    if (roundTrip.cleared) adminOk += 1
    console.log(
      `  ${roundTrip.cleared ? '✓' : '***'} 空值往返        实值「${roundTrip.realValue}」→ 空值：DOM 值 ${JSON.stringify(roundTrip.afterEmpty)}（应为空字符串）\n      选项样本: ${(roundTrip.dump || []).join(' | ')}\n      原始 HTML: ${roundTrip.rawHtml}`,
    )
  }
} catch (error) {
  console.log(`  *** 管理后台验证失败：${String(error.message).slice(0, 120)}`)
} finally {
  admin?.cleanup()
}

console.log('')
console.log(
  `页面统一 ${pagePass}/${pageTotal} · 换值生效 ${changed}/${results.length} · 管理后台 ${adminOk}/${adminTotal}`,
)
console.log('运行时错误:', errors.length ? errors.join(' | ') : '无')

const ok =
  pagePass === pageTotal &&
  changed === results.length &&
  results.length > 0 &&
  adminOk === adminTotal &&
  adminTotal > 0 &&
  !errors.length
console.log(ok ? '下拉框验证：全部通过' : '下拉框验证：*** 有未通过项 ***')
await page.screenshot({ path: 'tools/shots/下拉框统一.png' })
await browser.close()
process.exit(ok ? 0 : 1)