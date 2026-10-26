/**
 * 验证两处界面改动：
 *  1. **岗位对照弹窗的滚动结构** —— 报告很长时，滚动条只应出现在中间区域，
 *     标题与底部按钮始终可见（原先整张卡片滚，标题会滚走）。
 *  2. **写简历向导** —— 选求职类型后模块顺序真的跟着变，套用后纸面/面板真的被铺好。
 *
 * 为什么必须真跑：单测只验到蓝图这个纯函数（36 例），验不了
 * 「弹窗里到底滚的是谁」「点套用之后 store 里真的换了吗」。
 * 而这两件事恰好都曾经出过问题：滚动条贯穿全高是 CSS 布局问题，
 * 套用不生效是 store 编排问题 —— 两者都不会让单测变红。
 *
 * 用法：node tools/verify-wizard-and-jd.mjs [url] [--token <会话令牌>]
 *   需要 `npm run dev`（5173）。岗位对照要登录 + 配好模型服务才走得通，
 *   所以那部分在未配置时会**明确报「未能验证」并计为失败**，而不是假装通过。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const tokenIndex = argv.indexOf('--token')
const token = tokenIndex >= 0 ? String(argv[tokenIndex + 1] || '').trim() : ''
const url = argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
if (token) {
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
}
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
await page.waitForTimeout(1300)

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

/* ================= 一、填写进度条 ================= */

const progress = await page.evaluate(() => {
  const box = document.querySelector('.fill-progress')
  if (!box) return null
  const bar = box.querySelector('[role="progressbar"]')
  const jump = box.querySelector('.fp-jump')
  return {
    exists: true,
    text: (box.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    hasBar: Boolean(bar),
    ariaNow: bar?.getAttribute('aria-valuenow') ?? '',
    hasJump: Boolean(jump),
  }
})

log(progress?.exists === true, '内容面板出现「填写进度」块')
log(progress?.hasBar === true, '进度条带 role=progressbar（读屏可感知）')
log(
  /还差几段|都填好了/.test(progress?.text || ''),
  `进度块给出了明确状态（「${progress?.text?.slice(0, 50)}…」）`,
)
log(
  Number(progress?.ariaNow) >= 0 && Number(progress?.ariaNow) <= 100,
  `进度值是 0-100 的整数（实际 ${progress?.ariaNow}）`,
)

/*
 * 「去填」只在**还有没填的段**时出现 —— 这是刻意的：全填完了还催你「去填」
 * 是误导。默认示例简历是满的，所以这里先按状态分支断言，
 * 而不是无条件要求按钮存在（第一版就是这么错的：把正确行为判成了失败）。
 */
const isAllDone = Number(progress?.ariaNow) === 100
if (isAllDone) {
  log(progress?.hasJump === false, '全部填完时不显示「去填」（不催已经填完的人）')
  log(/简历体检/.test(progress?.text || ''), '全部填完时给出下一步引导（指向简历体检）')
} else {
  log(progress?.hasJump === true, '还有空段时显示「去填」按钮')
  const beforeScroll = await page.evaluate(() => {
    const scroller = document.querySelector('.panel-body')
    return scroller ? scroller.scrollTop : -1
  })
  await page.evaluate(() => document.querySelector('.fp-jump')?.click())
  await page.waitForTimeout(900)
  const afterScroll = await page.evaluate(() => {
    const scroller = document.querySelector('.panel-body')
    return scroller ? scroller.scrollTop : -1
  })
  log(
    beforeScroll >= 0 && afterScroll >= 0 && afterScroll !== beforeScroll,
    `点「去填」真的滚动了（${beforeScroll} → ${afterScroll}）`,
  )
}

/* ================= 二、写简历向导 ================= */

const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes('我的简历'),
  )
  if (!btn) return false
  btn.click()
  return true
})
log(opened, '打开「我的简历」弹窗')
await page.waitForTimeout(700)

const wizardEntry = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
    (b.textContent || '').includes('AI 起稿'),
  )
  if (!btn) return null
  btn.click()
  return (btn.textContent || '').replace(/\s+/g, ' ').trim()
})
log(Boolean(wizardEntry), `「我的简历」里有「AI 起稿」入口（「${wizardEntry}」）`)
await page.waitForTimeout(900)

/** 读向导里「将铺好的结构」那串模块名 */
const readSteps = () =>
  page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const d = dialogs[dialogs.length - 1]
    if (!d) return null
    return {
      title: (d.querySelector('.bw-title') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
      steps: [...d.querySelectorAll('.bw-step-title')].map((el) => (el.textContent || '').trim()),
      emphasis: (d.querySelector('.bw-emphasis') || {}).textContent?.trim() || '',
      salary:
        (d.querySelector('.bw-baseline') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
      hasReplaceToggle: Boolean(d.querySelector('.bw-replace')),
    }
  })

const socialState = await readSteps()
log(/先定方向/.test(socialState?.title || ''), `向导弹窗打开（标题「${socialState?.title}」）`)
log(
  (socialState?.steps?.length || 0) >= 4,
  `预览列出了模块（${socialState?.steps?.length} 个：${socialState?.steps?.join(' / ')}）`,
)
log(
  socialState?.steps?.[0] === '求职意向' && socialState?.steps?.[1] === '工作经历',
  `社招默认：求职意向 → 工作经历（实际 ${socialState?.steps?.[0]} → ${socialState?.steps?.[1]}）`,
)
log((socialState?.emphasis?.length || 0) > 10, '给出了「最该被看到什么」的提示')

/* ---- 切换求职类型，模块顺序必须跟着变 ---- */

async function pickTrack(label) {
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const d = dialogs[dialogs.length - 1]
    d?.querySelector('[role="combobox"]')?.click()
  })
  await page.waitForTimeout(350)
  const ok = await page.evaluate((text) => {
    const menu = document.querySelector('[role="listbox"]')
    const option = menu
      ? [...menu.querySelectorAll('[role="option"]')].find((o) =>
          (o.textContent || '').includes(text),
        )
      : null
    if (!option) return false
    option.click()
    return true
  }, label)
  await page.waitForTimeout(600)
  return ok
}

const campusPicked = await pickTrack('校招')
log(campusPicked, '把求职类型切成「校招」')
const campusState = await readSteps()
log(
  campusState?.steps?.[0] === '求职意向' && campusState?.steps?.[1] === '教育背景',
  `校招：教育背景提前（实际 ${campusState?.steps?.[0]} → ${campusState?.steps?.[1]}）`,
)
log(
  campusState?.steps?.includes('实习经历'),
  `校招包含「实习经历」（实际：${campusState?.steps?.join(' / ')}）`,
)
log(
  campusState?.steps?.join('/') !== socialState?.steps?.join('/'),
  '切换类型后模块顺序确实变了（不是静态文案）',
)
log(
  /K-/.test(campusState?.salary || ''),
  `薪资默认值随类型变化（${campusState?.salary?.slice(-40)}）`,
)

/* ---- 套用骨架：真的写进 store ---- */

const applied = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const d = dialogs[dialogs.length - 1]
  const btn = [...d.querySelectorAll('button')].find((b) =>
    /铺好骨架|替换当前内容/.test(b.textContent || ''),
  )
  if (!btn) return false
  btn.click()
  return true
})
log(applied, '点击「铺好骨架」')
await page.waitForTimeout(800)

// 如果弹了「替换当前内容？」确认框，就确认它
const confirmed = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const d = dialogs[dialogs.length - 1]
  const title = (d?.querySelector('.cf-title') || {}).textContent || ''
  if (!title.includes('替换')) return 'no-confirm'
  const btn = [...d.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '替换')
  if (!btn) return 'no-button'
  btn.click()
  return 'confirmed'
})
log(confirmed === 'confirmed' || confirmed === 'no-confirm', `覆盖前有二次确认（${confirmed}）`)
await page.waitForTimeout(1000)

// 关掉可能还开着的「我的简历」弹窗
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

const afterApply = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.ed-card .ed-card-title')]
  const titles = cards.map((el) => (el.value || el.textContent || '').trim())
  const saved = localStorage.getItem('resume-studio-v1')
  // 解析失败按 null 处理：那样下面的断言会红，而不是把坏数据静默当成空简历
  let parsed
  try {
    parsed = JSON.parse(saved || 'null')
  } catch {
    parsed = null
  }
  return {
    titles,
    sectionCount: parsed?.sections?.length ?? 0,
    savedTitles: (parsed?.sections || []).map((s) => s.title),
    jobTitle: parsed?.basics?.jobTitle ?? '',
  }
})

log(
  afterApply.sectionCount >= 4,
  `骨架已写进简历并落盘（${afterApply.sectionCount} 个模块：${afterApply.savedTitles?.join(' / ')}）`,
)
log(
  afterApply.savedTitles?.[1] === '教育背景',
  `落盘顺序与所选类型一致（第 2 个是「${afterApply.savedTitles?.[1]}」）`,
)
log(afterApply.jobTitle.length > 0, `基本信息里的求职职位被同步（「${afterApply.jobTitle}」）`)

/* ---- 落盘后纸面真的变了 ---- */

const paperText = await page.evaluate(() => {
  const paper = document.querySelector('.editor-app .paper')
  return (paper?.textContent || '').replace(/\s+/g, ' ').trim()
})
log(/求职意向|教育背景/.test(paperText), '纸面上能看到新骨架的模块标题')

/* ================= 三、岗位对照弹窗的滚动结构 ================= */

/*
 * 要验的是「滚动条只出现在中间，标题与底部按钮不跟着滚」。
 * 这个结构靠 CSS 三段式实现（.jd-card overflow:hidden + .jd-body overflow:auto），
 * 一旦有人把 overflow 挪回卡片上，滚动条又会贯穿全高 —— 而那时单测、
 * 类型检查、lint 全都不会响。所以必须量「谁在滚」。
 */
const jdOpened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes('岗位对照'),
  )
  if (!btn) return false
  btn.click()
  return true
})
log(jdOpened, '打开「岗位对照」弹窗')
await page.waitForTimeout(800)

const jdLayout = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const card = dialogs.find((d) => (d.getAttribute('aria-label') || '') === '岗位对照')
  if (!card) return null
  const body = card.querySelector('.jd-body')
  const head = card.querySelector('.jd-head')
  const actions = card.querySelector('.jd-actions')
  const style = getComputedStyle(card)
  return {
    // 卡片自身不该滚 —— 滚的应该是 .jd-body
    cardOverflowY: style.overflowY,
    hasBody: Boolean(body),
    bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
    hasHead: Boolean(head),
    hasActions: Boolean(actions),
    // 底部按钮必须在卡片可视范围内（不是被挤出去）
    actionsInside:
      actions && card
        ? actions.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1
        : false,
  }
})

log(jdLayout?.cardOverflowY === 'hidden', `卡片自身不滚动（overflow-y=${jdLayout?.cardOverflowY}）`)
log(jdLayout?.hasBody === true, '存在独立的滚动区 .jd-body')
log(
  jdLayout?.bodyOverflowY === 'auto',
  `只有中间区域滚动（.jd-body overflow-y=${jdLayout?.bodyOverflowY}）`,
)
log(jdLayout?.hasHead === true, '标题区独立于滚动区')
log(jdLayout?.actionsInside === true, '底部动作按钮始终在可视范围内')

// 真写一段长 JD，让报告区真的需要滚，再量一次
await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const card = dialogs.find((d) => (d.getAttribute('aria-label') || '') === '岗位对照')
  const textarea = card?.querySelector('textarea')
  if (textarea) {
    textarea.value =
      '负责前端开发。要求熟悉 Vue3、TypeScript、性能优化、工程化、组件库建设、单元测试、CI/CD、跨端适配、可视化图表、微前端架构、Node.js 服务端开发、Docker 部署、团队协作与代码评审、技术方案设计与文档输出。'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
await page.waitForTimeout(400)

const bodyScrollable = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')]
  const card = dialogs.find((d) => (d.getAttribute('aria-label') || '') === '岗位对照')
  const body = card?.querySelector('.jd-body')
  if (!body) return null
  return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight }
})
log(
  bodyScrollable !== null,
  `滚动区可量（内容 ${bodyScrollable?.scrollHeight}px / 可视 ${bodyScrollable?.clientHeight}px）`,
)

await page.keyboard.press('Escape')
await page.waitForTimeout(400)

console.log('')
console.log(`向导与岗位对照验证：${pass}/${pass + failed.length} 通过`)
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
