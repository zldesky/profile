/**
 * 验证「Magpie 免 Key 通道」的界面链路。
 *
 * 为什么需要它：单测只验到纯逻辑与端点契约，验不了这几件事 ——
 *  1. 设置弹窗里真的渲染出了「Magpie（本机直连，免 Key）」这一项；
 *  2. 选中它之后 **Key 输入框消失**、换成联调状态区（这是本功能的核心交互）；
 *  3. 「一键联调」按钮真的在、且点了真的把状态写回配置；
 *  4. 免 Key 配置能让润色弹窗认为「已配置」，而不是仍提示去设置。
 *
 * 第 4 条最值得验：它是本次改动最容易静默失效的一处 ——
 * 联调成功、配置也存了，但润色弹窗仍说"未配置"，用户会以为整个功能没生效。
 *
 * 用法：node tools/verify-magpie-ui.mjs [url] [--token <会话令牌>]
 *   默认连 http://localhost:5173/editor，需要 `npm run dev` + `npm run pdf` 都在跑。
 *   依赖本机真的装着 Magpie（127.0.0.1:3425）；没装时联调用例会**判 FAIL 而不是跳过**，
 *   因为「跳过」会让报告看起来是绿的，而实际什么都没测（见 .agent/testing.md 第 1 条）。
 *
 * **必须带 --token**：Magpie 端点和 /api/ai/chat 一样要求登录，
 * 未登录时它一律 401，而界面会因此显示「需要先登录」——
 * 那样测到的只是「未登录提示」，不是本功能。
 * 令牌用 `npm run audit:login` 生成。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const tokenIndex = argv.indexOf('--token')
const token = tokenIndex >= 0 ? String(argv[tokenIndex + 1] || '').trim() : ''
if (!token) {
  console.error('缺少 --token：Magpie 端点要求登录，未登录时测到的是 401 提示而不是本功能。')
  console.error('先跑：node tools/audit-login.mjs，再把打印出的令牌传进来。')
  process.exit(1)
}

const url = argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
// 把令牌塞进 cookie：与浏览器真实登录态同一条通道（rs_session，见 requestGuards.ts）
await context.addCookies([
  {
    name: 'rs_session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  },
])
const page = await context.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
})

let pass = 0
const failed = []
const log = (ok, message) => {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${message}`)
  } else {
    failed.push(message)
    console.log(`  *** 失败 *** ${message}`)
  }
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1200)

// 关掉新手引导，否则它盖在弹窗上面
for (let i = 0; i < 6; i += 1) {
  const clicked = await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
    if (!skip) return false
    skip.click()
    return true
  })
  if (!clicked) break
  await page.waitForTimeout(250)
}

/* ---------- 从真实入口打开「模型服务设置」 ---------- */

/*
 * 定位「工作经历」卡片再展开它。
 *
 * 第一版直接展开第一个 `.ed-icon-btn.expand` —— 结果是失败的：
 * `aria-label="打开表达助手"` 只存在于 **ExperienceEntryEditor**（经历条目的
 * 每一条要点旁），而第一个卡片是「基本信息」，根本没有这个按钮。
 * 这与 PITFALLS A8 是同一类错：按位置找元素，命中的不是以为的那个。
 * 所以这里改成按卡片标题文本定位，找不到就判 FAIL。
 */
const expandResult = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.ed-card')]
  const target = cards.find((card) => {
    const title = card.querySelector('.ed-card-title')
    return ((title?.value ?? title?.textContent) || '').trim() === '工作经历'
  })
  if (!target) {
    return `没找到「工作经历」卡片（现有：${cards
      .map((c) => (c.querySelector('.ed-card-title')?.value || '').trim())
      .join(' / ')})`
  }
  const expand = target.querySelector('.ed-icon-btn.expand')
  if (!expand) return '「工作经历」卡片没有展开按钮'
  expand.click()
  return 'ok'
})
log(expandResult === 'ok', `展开「工作经历」卡片（${expandResult}）`)
await page.waitForTimeout(700)

const entered = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="打开表达助手"]')
  if (!btn) return false
  btn.click()
  return true
})
log(entered, '打开表达助手弹窗')
await page.waitForTimeout(700)

await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) =>
    (t.textContent || '').includes('措辞改写'),
  )
  if (tab) tab.click()
})
await page.waitForTimeout(400)

const toSettings = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
    (b.textContent || '').includes('去设置'),
  )
  if (!btn) return false
  btn.click()
  return true
})
log(toSettings, '从表达助手进入「模型服务设置」')
await page.waitForTimeout(900)

/* ---------- 断言 1：免 Key 预设存在且是第一项 ---------- */

/*
 * 服务商下拉是 **BaseSelect 自绘菜单**，不是原生 <select>。
 *
 * 第一版探针按原生 select 写（`select.options` / `selectOption`），全部拿不到值 ——
 * 那不是产品坏了，是探针找错了控件。教训与 PITFALLS A9 同族：
 * 先确认那个控件到底是什么，再决定怎么操作。
 * 这里直接读触发器的文本，并点开菜单读 `[role="option"]`。
 */
const readPreset = async () => {
  // 先点开菜单
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const d = dialogs[dialogs.length - 1]
    const trigger = d?.querySelector('[role="combobox"]')
    if (trigger) trigger.click()
  })
  await page.waitForTimeout(400)
  const info = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const d = dialogs[dialogs.length - 1]
    const trigger = d?.querySelector('[role="combobox"]')
    const menu = document.querySelector('[role="listbox"]')
    return {
      title: (d?.querySelector('.ai-title') || {}).textContent || '',
      currentLabel: (trigger?.querySelector('.bsel-value') || {}).textContent || '',
      options: menu
        ? [...menu.querySelectorAll('[role="option"]')].map((o) => ({
            value: o.getAttribute('data-value'),
            label: (o.textContent || '').trim(),
          }))
        : [],
    }
  })
  // 收起菜单，别挡住后续点击。
  // **不能用 Esc**：useDialogA11y 把 Esc 给了最上层弹窗，一次 Esc 会把
  // 「模型服务设置」整个关掉（BaseSelect 自己的 Esc 处理在菜单失焦后就不再触发）。
  // 这里点弹窗标题（非交互区）来触发 BaseSelect 的「点外部关闭」。
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const d = dialogs[dialogs.length - 1]
    const title = d?.querySelector('.ai-title')
    if (title) title.click()
  })
  await page.waitForTimeout(300)
  return info
}

const presetInfo = await readPreset()

log(presetInfo?.title === '模型服务设置', `弹窗标题正确（实际「${presetInfo?.title}」）`)
const magpieOption = presetInfo?.options?.find((o) => o.value === 'magpie')
log(Boolean(magpieOption), `服务商列表里有 magpie（共 ${presetInfo?.options?.length} 项）`)
log(
  (presetInfo?.options?.[0] || {}).value === 'magpie',
  `免 Key 排在第一位（实际第一位是「${presetInfo?.options?.[0]?.label}」）`,
)
log(
  /免 ?Key/i.test(magpieOption?.label || ''),
  `选项文案说明了免 Key（「${magpieOption?.label}」）`,
)

/* ---------- 断言 2：选中后 Key 输入框消失、出现联调区 ---------- */

/*
 * 免 Key 预设是**默认选中**的（AI_PRESETS[0]），所以这里通常不需要再选一次。
 * 第一版无条件去点菜单里的 magpie 选项 —— 结果找不到它（菜单已收起），
 * 于是报了一条假失败。正确做法是先看当前选中的是谁，只在不是 magpie 时才去点。
 */
const currentLabel = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const d = dialogs[dialogs.length - 1]
  return (d?.querySelector('.bsel-value') || {}).textContent || ''
})

if (/Magpie/i.test(currentLabel)) {
  log(true, `Magpie 已是默认选中项（「${currentLabel.trim()}」）`)
} else {
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const d = dialogs[dialogs.length - 1]
    const trigger = d?.querySelector('[role="combobox"]')
    if (trigger) trigger.click()
  })
  await page.waitForTimeout(400)
  const picked = await page.evaluate(() => {
    const menu = document.querySelector('[role="listbox"]')
    const option = menu
      ? [...menu.querySelectorAll('[role="option"]')].find(
          (o) => o.getAttribute('data-value') === 'magpie',
        )
      : null
    if (!option) return false
    option.click()
    return true
  })
  log(picked, '在菜单里选中「Magpie」')
  await page.waitForTimeout(1400)
}

const magpieState = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const d = dialogs[dialogs.length - 1]
  if (!d) return null
  const keyInput = [...d.querySelectorAll('input')].find(
    (el) => el.type === 'password' || el.placeholder === '粘贴该服务商的 API Key',
  )
  const probeBtn = [...d.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes('一键联调'),
  )
  const block = d.querySelector('.ai-magpie')
  return {
    hasKeyInput: Boolean(keyInput),
    hasProbe: Boolean(probeBtn),
    probeDisabled: probeBtn ? probeBtn.disabled : null,
    hasBlock: Boolean(block),
    blockText: (block?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  }
})

log(magpieState?.hasBlock === true, '出现 Magpie 状态区')
// 这是核心断言：免 Key 通道不该还摆着一个 Key 输入框
log(magpieState?.hasKeyInput === false, '选中免 Key 后 API Key 输入框消失')
log(magpieState?.hasProbe === true, '「一键联调」按钮存在')
log(
  magpieState?.probeDisabled === false,
  `「一键联调」可点（disabled=${magpieState?.probeDisabled}）`,
)
log(
  /Magpie|检测|运行/.test(magpieState?.blockText || ''),
  `状态区显示了本机检测结果（「${magpieState?.blockText?.slice(0, 60)}…」）`,
)

/* ---------- 断言 3：一键联调真的连通并写回配置 ---------- */

const clickedProbe = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const d = dialogs[dialogs.length - 1]
  const btn = [...d.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes('一键联调'),
  )
  if (!btn) return false
  btn.click()
  return true
})
log(clickedProbe, '点击「一键联调」')

// 真的会走一次模型调用，给足时间
await page.waitForTimeout(9000)

const afterProbe = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const d = dialogs[dialogs.length - 1]
  if (!d) return null
  const ok = d.querySelector('.ai-magpie-ok')
  const bad = d.querySelector('.ai-magpie-bad')
  return {
    okText: (ok?.textContent || '').replace(/\s+/g, ' ').trim(),
    badText: (bad?.textContent || '').replace(/\s+/g, ' ').trim(),
    stored: localStorage.getItem('resume-studio-ai-v1'),
  }
})

log(
  Boolean(afterProbe?.okText),
  `联调成功并回显结果（${afterProbe?.okText || `错误：${afterProbe?.badText || '无反馈'}`}）`,
)

// 关键：配置必须真的落盘，且带 noKey 标记
// 解析失败按 null 处理 —— 那样下面的断言会红，而不是把坏数据当成"没配置"静默放过
let stored
try {
  stored = JSON.parse(afterProbe?.stored || 'null')
} catch {
  stored = null
}
log(stored?.noKey === true, `配置已落盘且带 noKey 标记（实际 ${JSON.stringify(stored)}）`)
log(stored?.apiKey === '' || stored?.apiKey === undefined, '免 Key 配置里没有残留 apiKey')

/* ---------- 断言 4：润色弹窗认为「已配置」 ---------- */

// 关掉设置弹窗（Esc 只关最上层）
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 重新打开表达助手 → 措辞改写，看它是否还提示"去设置"
await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="打开表达助手"]')
  if (btn) btn.click()
})
await page.waitForTimeout(600)
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) =>
    (t.textContent || '').includes('措辞改写'),
  )
  if (tab) tab.click()
})
await page.waitForTimeout(500)

const polishState = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const d = dialogs[dialogs.length - 1]
  if (!d) return null
  const text = (d.textContent || '').replace(/\s+/g, ' ')
  return {
    stillAsksForSetup: text.includes('去设置'),
    hasGenerateButton: [...d.querySelectorAll('button')].some((b) =>
      /生成|改写|润色/.test(b.textContent || ''),
    ),
  }
})

// 这条是本次改动最容易静默失效的地方
log(polishState?.stillAsksForSetup === false, '免 Key 配置下，润色弹窗不再提示「去设置」')
log(polishState?.hasGenerateButton === true, '润色弹窗出现可用的生成按钮')

console.log('')
console.log(`Magpie 界面验证：${pass}/${pass + failed.length} 通过`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  · ${f}`)
}
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)
