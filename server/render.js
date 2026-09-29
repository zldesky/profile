/**
 * 渲染层。
 *
 * 使用 playwright-core 驱动「系统已安装的 Chromium 内核浏览器」，
 * 不下载任何浏览器二进制，也无需重复实现模板 —— 渲染的仍是前端那一套 Vue 模板。
 *
 * 浏览器按以下顺序探测：
 *   1. 环境变量 BROWSER_PATH 指定的可执行文件；
 *   2. 系统 Edge（Windows 10/11 预装，优先）；
 *   3. 系统 Chrome；
 *   4. playwright 自带 Chromium（仅当你另外执行过 playwright install 时存在）。
 *
 * 复用同一个浏览器实例，每次导出开一个独立 context：
 * 用 addInitScript 在应用脚本执行前把简历数据写入 localStorage，
 * 应用随后按常规流程恢复这份数据并渲染纸张。
 */
import { chromium } from 'playwright-core'

import { createSemaphore } from './semaphore.js'

/** 需与前端 stores/resume.js 中的 STORAGE_KEY 保持一致 */
const STORAGE_KEY = 'resume-studio-v1'

/**
 * 浏览器启动参数。
 *  - 字体微调：关闭后 CJK 字形在不同环境下更一致；
 *  - /dev/shm：容器里默认只有 64MB，Chromium 的共享内存超了会直接「Target closed」，
 *    改用 /tmp 是容器部署的标准动作，物理机上也无副作用；
 *  - BROWSER_EXTRA_ARGS：环境变量追加的自定义参数（空格分隔），容器内需要
 *    --no-sandbox 之类的场景从这里进，不必改代码。
 */
const LAUNCH_ARGS = [
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--disable-dev-shm-usage',
  ...(process.env.BROWSER_EXTRA_ARGS
    ? process.env.BROWSER_EXTRA_ARGS.split(/\s+/).filter(Boolean)
    : []),
]

/** 依次尝试的浏览器渠道，Edge 在 Windows 上命中率最高 */
const CHANNELS = ['msedge', 'chrome', 'msedge-beta', 'chrome-beta']

/**
 * 渲染并发闸门。并发与排队上限可用环境变量调整：
 * 小内存机器（2-4G）保持默认的 1 并发即可，配 2G swap 更稳。
 */
const RENDER_CONCURRENCY = Number(process.env.RENDER_CONCURRENCY) || 1
const RENDER_QUEUE_MAX = Number(process.env.RENDER_QUEUE_MAX ?? 3)
const renderSlots = createSemaphore({
  concurrency: RENDER_CONCURRENCY,
  maxQueue: RENDER_QUEUE_MAX,
})

let browserPromise = null
let resolvedChannel = ''

async function launch() {
  const failures = []

  if (process.env.BROWSER_PATH) {
    try {
      return {
        browser: await chromium.launch({
          executablePath: process.env.BROWSER_PATH,
          args: LAUNCH_ARGS,
        }),
        channel: 'BROWSER_PATH',
      }
    } catch (error) {
      failures.push(`BROWSER_PATH：${firstLine(error)}`)
    }
  }

  for (const channel of CHANNELS) {
    try {
      return { browser: await chromium.launch({ channel, args: LAUNCH_ARGS }), channel }
    } catch (error) {
      failures.push(`${channel}：${firstLine(error)}`)
    }
  }

  try {
    return { browser: await chromium.launch({ args: LAUNCH_ARGS }), channel: 'bundled' }
  } catch (error) {
    failures.push(`bundled：${firstLine(error)}`)
  }

  console.error('[pdf] 未找到可用的 Chromium 内核浏览器：')
  failures.forEach((item) => console.error(`  · ${item}`))

  const error = new Error('未找到可用的浏览器，请安装 Edge / Chrome，或设置环境变量 BROWSER_PATH')
  error.statusCode = 503
  throw error
}

function firstLine(error) {
  return String(error?.message || error).split('\n')[0]
}

/** 惰性启动并复用浏览器实例，避免每次导出都冷启动 */
function getBrowser() {
  if (!browserPromise) {
    browserPromise = launch()
      .then(({ browser, channel }) => {
        resolvedChannel = channel
        return browser
      })
      .catch((error) => {
        // 启动失败时不缓存失败的 Promise，下次请求可以重试
        browserPromise = null
        throw error
      })
  }
  return browserPromise
}

/** 预热：启动时探测一次，便于把结果直接打在控制台 */
export async function ensureBrowser() {
  await getBrowser()
  return resolvedChannel
}

export function getResolvedChannel() {
  return resolvedChannel
}

/** 当前渲染占用情况，供日志与健康检查使用 */
export function getRenderStats() {
  return renderSlots.stats()
}

export async function closeBrowser() {
  if (!browserPromise) return
  const browser = await browserPromise.catch(() => null)
  browserPromise = null
  if (browser) await browser.close()
}

/** 等字体与图片就绪，否则首屏可能用回退字体或空白头像渲染 */
async function waitForAssets(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true })
              img.addEventListener('error', resolve, { once: true })
            }),
      ),
    ),
  )
}

/**
 * 渲染简历为 PDF。
 * @param {object} params
 * @param {object} params.resume 简历数据
 * @param {string} params.renderUrl 前端页面地址
 * @param {string} [params.title] PDF 文档标题
 * @returns {Promise<Buffer>} PDF 字节流
 */
export async function renderResumePdf({ resume, renderUrl, title }) {
  // 排队失败（队满 / 等待超时）在这里抛出 429，由路由层直接透传
  return renderSlots.run(async () => {
    const browser = await getBrowser()
    const context = await browser.newContext({ viewport: { width: 1123, height: 1588 } })
    const page = await context.newPage()

    try {
      await context.addInitScript(
        ([key, payload]) => window.localStorage.setItem(key, payload),
        [STORAGE_KEY, JSON.stringify(resume)],
      )

      // 只放行应用自身的源。即使渲染内容里混进了外部引用，
      // 也无法加载远程资源或把数据外发出去。
      const appOrigin = new URL(renderUrl).origin
      await context.route('**', (route) => {
        const target = route.request().url()
        return target.startsWith(appOrigin) ? route.continue() : route.abort()
      })

      await page.goto(renderUrl, { waitUntil: 'load', timeout: 20000 })
      await page.waitForSelector('.paper', { timeout: 15000 })
      await waitForAssets(page)

      if (title) {
        await page.evaluate((value) => {
          document.title = value
        }, title)
      }

      // page.pdf 默认走 print media，前端 @media print 的隐藏规则会自动生效
      const { mv, mh } = resume.theme || {}
      const buffer = await page.pdf({
        format: 'A4',
        // 等价于打印窗口里勾选「背景图形」，服务端导出无需用户操作
        printBackground: true,
        margin: {
          top: `${Number(mv) || 12}mm`,
          bottom: `${Number(mv) || 12}mm`,
          left: `${Number(mh) || 14}mm`,
          right: `${Number(mh) || 14}mm`,
        },
        preferCSSPageSize: false,
      })

      return Buffer.from(buffer)
    } finally {
      await context.close()
    }
  })
}
