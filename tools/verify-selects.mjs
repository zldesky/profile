/**
 * 验证下拉框已统一到 BaseSelect（自绘菜单版），并且**真的还能用**。
 * 用法：node tools/verify-selects.mjs [url]
 *
 * 为什么要有它：BaseSelect 经历了两代 —— v1 包原生 <select>，只统一外观；
 * v2（本轮）按用户要求把弹开的选项列表也改成自绘菜单（样式对齐「导入/导出
 * 数据」菜单、宽度按内容自适应、贴边翻转），原生 select 从页面上绝迹。
 * 两代共同的坏法是「下拉能打开、选了却没反应」——类型检查不报、静默失效，
 * 必须用真实交互（点开菜单、点选项）验值真的写回。
 *
 * 判定：
 *  1. 页面上不应再有原生 <select>（v1 的残留）；
 *  2. 每个下拉都有触发按钮 + 自绘箭头（说明走的是 BaseSelect）；
 *  3. 点开菜单选一个值，触发器上的当前值真的变了（功能没坏）；
 *  4. 管理后台「字体（可选）」的 undefined 空值项：标签往返 + 菜单里无 "undefined"。
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
    const s = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
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
 *
 * v2 起页面上的下拉是「.bsel > 触发按钮」，原生 <select> 应当为 0；
 * 菜单只在打开时才 Teleport 到 body，这里只量常驻的触发器。
 */
const inspect = () =>
  page.evaluate(() => {
    const natives = [...document.querySelectorAll('select')]
    const triggers = [...document.querySelectorAll('.bsel-trigger')]
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const shown = triggers.filter(visible)
    return {
      // v1 残留：页面上还挂着原生 select
      natives: natives.length,
      legacy: natives.filter((s) => s.classList.contains('ed-select')).length,
      total: triggers.length,
      visible: shown.length,
      wrapped: triggers.filter((t) => t.closest('.bsel')).length,
      withChevron: triggers.filter((t) => t.parentElement?.querySelector('.bsel-chevron')).length,
      dense: triggers.filter((t) => t.closest('.bsel')?.classList.contains('is-dense')).length,
      // 只对可见元素判宽度：可见却塌成 0 才是真问题（例如容器塌陷）
      widthZero: shown.filter((t) => t.getBoundingClientRect().width < 20).length,
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
  const ok =
    st.legacy === 0 &&
    st.natives === 0 &&
    st.total > 0 &&
    st.wrapped === st.total &&
    st.widthZero === 0
  if (ok) pagePass += 1
  console.log(
    `  ${ok ? '✓' : '***'} ${label.padEnd(14)} 下拉 ${st.total} 个（可见 ${st.visible}）· 原生残留 ${st.natives} · 走组件 ${st.wrapped} · 有箭头 ${st.withChevron} · 尺寸变体 ${st.dense} · 可见里宽度为 0 的 ${st.widthZero}`,
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
  const tab = [...document.querySelectorAll('.panel-tabs button')].find((b) =>
    (b.textContent || '').includes('设计'),
  )
  tab?.click()
})
await page.waitForTimeout(900)
{
  const st = await inspect()
  const ok =
    st.legacy === 0 &&
    st.natives === 0 &&
    st.total > 0 &&
    st.wrapped === st.total &&
    st.widthZero === 0
  if (ok) pagePass += 1
  pageTotal += 1
  console.log(
    `  ${ok ? '✓' : '***'} ${'设计面板'.padEnd(12)} 下拉 ${st.total} 个（可见 ${st.visible}）· 原生残留 ${st.natives} · 走组件 ${st.wrapped} · 有箭头 ${st.withChevron} · 可见里宽度为 0 的 ${st.widthZero}（含分组字体下拉）`,
  )
}

/* ---------- ② 功能：点开菜单选一个值，触发器上的当前值真的变了 ---------- */
console.log('\n② 功能验证（真实点击：点开菜单 → 点选项 → 看触发器当前值）：')
let results = []
let changed = 0
await page.goto(`${base}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await dismissOnboarding()
await expandCards()

{
  const triggers = page.locator('.editor-panel .bsel-trigger').filter({ visible: true })
  const total = Math.min(await triggers.count(), 4)
  for (let i = 0; i < total; i += 1) {
    const trigger = triggers.nth(i)
    const before = (await trigger.textContent()).trim()

    /* 展开卡片后面板在重排，首击可能落在重排完成前 —— 打不开就再试一次 */
    let pickedLabel = null
    for (let attempt = 0; attempt < 2 && pickedLabel === null; attempt += 1) {
      await trigger.click()
      const menu = page.locator('.bsel-menu')
      const opened = await menu
        .waitFor({ state: 'visible', timeoutMs: 3000 })
        .then(() => true)
        .catch(() => false)
      if (!opened) {
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(400)
        continue
      }
      const options = menu.locator('.bsel-option:not([disabled])')
      const n = await options.count()
      for (let j = 0; j < n; j += 1) {
        const label = (await options.nth(j).textContent()).trim()
        if (label && label !== before) {
          pickedLabel = label
          await options.nth(j).click()
          break
        }
      }
      await page.waitForTimeout(500)
    }
    const after = (await trigger.textContent()).trim()
    const ok = pickedLabel !== null && after === pickedLabel
    if (ok) changed += 1
    results.push({ before, pickedLabel, after })
    console.log(
      `  ${ok ? '✓' : '***'} 第 ${i + 1} 个下拉 选「${pickedLabel ?? '（无可选项）'}」-> 当前值 ${after === pickedLabel ? '已跟随' : `未跟随（${after}）`}`,
    )
  }
  if (results.length === 0) console.log('  *** 内容面板没有可见下拉（模块卡片没展开？）')
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
  await page
    .context()
    .addCookies([
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
  /*
   * 找「字体（可选）」下拉：逐个点开可见触发器，认「菜单里同时有 data-value=""
   * 的空值项与非空实值项」—— 不能靠标签里有没有「跟随」：空值项自己的标签就是
   * 「跟随简历当前字体」（也含「跟随」），会把空值项当成实值项（实测踩过）。
   */
  const triggers = page.locator('.bsel-trigger').filter({ visible: true })
  const trigCount = await triggers.count()
  let fontIndex = -1
  let fontInfo = null
  for (let i = 0; i < trigCount && fontIndex === -1; i += 1) {
    const trigger = triggers.nth(i)
    await trigger.click()
    const menu = page.locator('.bsel-menu')
    await menu.waitFor({ state: 'visible', timeoutMs: 3000 }).catch(() => {})
    const info = await page.evaluate(() => {
      const menu = document.querySelector('.bsel-menu')
      if (!menu) return null
      const opts = [...menu.querySelectorAll('.bsel-option')]
      const empty = opts.find((o) => o.dataset.value === '')
      const real = opts.find((o) => o.dataset.value !== '' && !o.disabled)
      /*
       * 只回传**字符串与布尔**：page.evaluate 的返回值走 JSON 序列化，
       * DOM 元素跨边界会退化成 {}（truthy、textContent 为 undefined）——
       * 元素一旦带出边界，后面读到的全是 undefined，断言全部失真。
       */
      return {
        hasEmpty: Boolean(empty),
        hasReal: Boolean(real),
        emptyLabelAtFind: empty?.textContent?.trim() ?? null,
        realLabelAtFind: real?.textContent?.trim() ?? null,
        hasGroupedOptions: menu.querySelectorAll('.bsel-group').length,
        optionCount: opts.length,
        // 关键：不能出现字面量 "undefined"（v1 的 :value="undefined" 就退化成它）
        literalUndefined: opts.some(
          (o) => o.dataset.value === 'undefined' || o.textContent.includes('undefined'),
        ),
        dump: opts
          .slice(0, 4)
          .map(
            (o) =>
              `value=${JSON.stringify(o.dataset.value)} label=${JSON.stringify((o.textContent || '').trim().slice(0, 10))}`,
          ),
      }
    })
    if (info && info.hasEmpty && info.hasReal) {
      fontIndex = i
      fontInfo = info
    } else {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
    }
  }

  if (fontIndex === -1 || !fontInfo) {
    console.log('  *** 字体（可选）下拉未找到（可能没进入风格编辑态）')
  } else {
    const basicOk = fontInfo.hasEmpty && !fontInfo.literalUndefined
    if (basicOk) adminOk += 1
    // find 时刻已把两个标签快照进 emptyLabelAtFind / realLabelAtFind；
    // 这里不读元素的实时 textContent —— 往返后菜单可能已卸载
    console.log(
      `  ${basicOk ? '✓' : '***'} 字体空值项      有空值项=${fontInfo.hasEmpty}（「${fontInfo.emptyLabelAtFind}」）· 选项 ${fontInfo.optionCount} 个 · 分组 ${fontInfo.hasGroupedOptions} 组 · 出现字面量 "undefined"=${fontInfo.literalUndefined}\n      选项样本: ${(fontInfo.dump || []).join(' | ')}`,
    )

    /*
     * 空值项与实值项之间真实点击往返一次。
     * 功能测试那一段选的选项可能恰好不含空值项，所以**恰好绕过了 undefined 语义** ——
     * 而它是整个组件里唯一需要双向转换的地方（空字符串 ⇄ undefined），必须单独验：
     * 只验「能选上实值」不足以说明「能清回 undefined」。
     * v1 验的是 DOM select.value；v2 的权威观感是触发器上的当前值标签。
     */
    adminTotal += 1
    const trigger = triggers.nth(fontIndex)
    // find 时刻固化的两个标签（字符串），往返断言只认它们
    const emptyLabelAtFind = fontInfo.emptyLabelAtFind
    const realLabelAtFind = fontInfo.realLabelAtFind

    // 上面认菜单时它还开着：先收起，后面的「点触发器打开」才是真的打开
    await page.keyboard.press('Escape')
    await page
      .locator('.bsel-menu')
      .waitFor({ state: 'detached', timeoutMs: 3000 })
      .catch(() => {})

    await trigger.click()
    await page
      .locator('.bsel-menu')
      .waitFor({ state: 'visible', timeoutMs: 3000 })
      .catch(() => {})
    const reopened = await page.evaluate(() => {
      const menu = document.querySelector('.bsel-menu')
      if (!menu) return { open: false }
      const opts = [...menu.querySelectorAll('.bsel-option')]
      return {
        open: true,
        count: opts.length,
        first: opts[0]?.textContent?.trim() ?? null,
        emptyFirst: Boolean(opts[0]?.dataset.value === ''),
      }
    })

    const realOpt = page
      .locator('.bsel-menu .bsel-option:not([data-value=""]):not([disabled])')
      .first()
    const emptyOpt = page.locator('.bsel-menu .bsel-option[data-value=""]').first()

    // 菜单可见 = place() 已定位；再留一拍让选项命中区稳定（上一版在此处点击过早）
    await page.waitForTimeout(300)
    const realLabel = (await realOpt.textContent().catch(() => null))?.trim() ?? null
    await realOpt.click().catch(() => {})
    await page.waitForTimeout(450)
    const afterReal = (await trigger.textContent().catch(() => '')).trim()

    await trigger.click()
    await page
      .locator('.bsel-menu')
      .waitFor({ state: 'visible', timeoutMs: 3000 })
      .catch(() => {})
    await page.waitForTimeout(300)
    const emptyLabel = (await emptyOpt.textContent().catch(() => null))?.trim() ?? null
    await emptyOpt.click().catch(() => {})
    await page.waitForTimeout(450)
    const afterEmpty = (await trigger.textContent().catch(() => '')).trim()

    // 切到实值后标签跟随实值项；切回空值后标签回到空值项自己的标签（不该停在旧实值）
    const cleared =
      afterReal === realLabelAtFind &&
      afterEmpty === emptyLabelAtFind &&
      emptyLabelAtFind !== realLabelAtFind
    if (cleared) adminOk += 1
    console.log(
      `  ${cleared ? '✓' : '***'} 空值往返        实值「${realLabel ?? realLabelAtFind}」→ 空值「${emptyLabel ?? emptyLabelAtFind}」：选实值后 ${JSON.stringify(afterReal)}，选空值后 ${JSON.stringify(afterEmpty)}\n      find 快照: real=${JSON.stringify(realLabelAtFind)} empty=${JSON.stringify(emptyLabelAtFind)} · 重开菜单: ${JSON.stringify(reopened)}`,
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
