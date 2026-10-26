/**
 * Magpie 本机直连（免 API Key）。
 *
 * 背景与边界（这些都是实测结论，不是设计想象）：
 *  1. Magpie 在 `127.0.0.1:3425` 起一个 **OpenAI 兼容网关**，
 *     `POST /v1/chat/completions` 不带 Authorization 就能用 —— 「免 Key」是真的，
 *     但它花的是**本机已登录的 Magpie 账号额度**（见 `/v1/magpie/quotas`）。
 *  2. **浏览器不能直连**：Magpie 对 `OPTIONS` 预检返回 404、响应里没有
 *     `Access-Control-Allow-Origin`，带 `application/json` 的 POST 必然被拦。
 *     实测见 `tools/probe-magpie-cors.mjs`（真 Edge、真跨源，退出码 1 = 不可行）。
 *     所以必须由本机服务转发，不能让用户「填个地址就行」。
 *  3. 生产 CSP 是 `connect-src 'self'`，即便 Magpie 哪天放开 CORS，
 *     托管在 3001 的页面仍然连不上 —— 两道闸独立生效。
 *  4. `server/aiGuard.ts` 的 SSRF 防线**故意**拒绝环回地址，所以本功能不能走
 *     `/api/ai/chat`。这里另开一条通道，**目标地址由服务端固定**，
 *     前端只能传 model / messages，传不了 URL —— 这是本模块的安全前提。
 *
 * 因此本模块只做四件事：探测网关、转发一次对话、下载安装包、启动它。
 * 全部纯逻辑可注入依赖，便于在 Node 下直测而不真的联网、不真的落盘。
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { readJsonWithCap } from './aiGuard.ts'

/** 默认网关地址。`/v1` 是 OpenAI 兼容前缀，调用方自己拼 /chat/completions */
export const MAGPIE_DEFAULT_BASE = 'http://127.0.0.1:3425/v1'

/**
 * 默认模型。
 *
 * 选 `auto/` 那条而不是某个具体型号：`auto/DeepSeek-V4.1-Flash` 是路由组，
 * 由 Magpie 自己挑可用后端；写死 `workbuddy/xxx` 会随着额度/套餐变化失效，
 * 而这条实测可用（返回 200，响应头带 X-Magpie-Model / X-Magpie-Provider）。
 */
export const MAGPIE_DEFAULT_MODEL = 'auto/DeepSeek-V4.1-Flash'

/** 安装包体积上限：v0.1.1559 的 windows 包是 60,382,208 字节，200MB 是三倍余量 */
export const MAGPIE_MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

/** 发布元数据：给出最新版本号、各平台包的 url / size / sha256 */
export const MAGPIE_RELEASE_META_URL = 'https://usemagpie.ai/api/latest'

/**
 * 允许下载的主机白名单。
 *
 * 必须逐跳校验：GitHub Release 的下载地址会 **302 到 release-assets.githubusercontent.com**
 * （实测：`github.com/yetone/magpie-releases/...` → 302 → `release-assets.githubusercontent.com`），
 * 所以既不能写 `redirect: 'error'`（会直接失败），也不能无条件跟随（会绕过校验）。
 * 做法与 `imageProxy.ts` 一致：`redirect: 'manual'` + 每跳重校验。
 */
const DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'usemagpie.ai',
])

/** 可注入的 fetch，便于测试不联网 */
export type FetchImpl = typeof fetch

/**
 * 判断一个 URL 是否指向本机回环。
 *
 * 用途有两层：① 校验 `MAGPIE_BASE_URL` 没被配成远端（否则「免 Key 本机」这个前提
 * 就变成「把本机额度借给任意地址」）；② 给界面回答「这台机器上能不能用」。
 */
export function isLoopbackUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(String(raw || ''))
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || /^127\./.test(host)
}

/** 网关探测结果。`running` 只看「端口答不答」，不代表能用（还要有额度） */
export interface MagpieGatewayStatus {
  running: boolean
  baseUrl: string
  /** Magpie 自报版本；老版本可能没有 */
  version: string
  /** 网关自报的 pid，用于「已经起来了」的提示 */
  pid: number
  models: Array<{ id: string; label: string }>
  /** 失败原因（可直接给用户看）；成功时为空串 */
  message: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * 探测 Magpie 网关。
 *
 * 打两个请求：根路径拿版本/pid（`{"name":"magpie","version":"0.1.1327","pid":7896}`），
 * `/models` 拿可用模型。根路径失败不影响结论 —— 只要 `/models` 通就算可用，
 * 因为真正要用的是它。
 */
export async function probeMagpieGateway({
  baseUrl = MAGPIE_DEFAULT_BASE,
  fetchImpl = fetch,
  timeoutMs = 2500,
}: {
  baseUrl?: string
  fetchImpl?: FetchImpl
  timeoutMs?: number
} = {}): Promise<MagpieGatewayStatus> {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  const empty: MagpieGatewayStatus = {
    running: false,
    baseUrl: base,
    version: '',
    pid: 0,
    models: [],
    message: '',
  }

  if (!isLoopbackUrl(base)) {
    return { ...empty, message: 'Magpie 地址必须是本机回环地址' }
  }

  let modelsResponse: Response
  try {
    modelsResponse = await fetchImpl(`${base}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
  } catch (error) {
    const detail = error instanceof Error && error.name === 'TimeoutError' ? '响应超时' : '连接不上'
    return { ...empty, message: `没有检测到 Magpie 网关（${detail}）` }
  }

  if (!modelsResponse.ok) {
    return { ...empty, message: `Magpie 网关返回了 ${modelsResponse.status} 状态码` }
  }

  let payload: Record<string, unknown>
  try {
    payload = asRecord(await readJsonWithCap(modelsResponse, 512 * 1024))
  } catch {
    return { ...empty, message: 'Magpie 网关返回的内容不是合法 JSON' }
  }

  const models = (Array.isArray(payload.data) ? payload.data : [])
    .map((item) => {
      const record = asRecord(item)
      const id = String(record.id ?? '').trim()
      const label = String(record.display_name ?? record.magpie_label ?? '').trim()
      return { id, label: label || id }
    })
    .filter((item) => item.id)

  // 根路径只用来补版本信息：拿不到也不算失败（老版本可能没这个字段）
  let version = ''
  let pid = 0
  try {
    const rootResponse = await fetchImpl(`${base.replace(/\/v1$/, '')}/`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
    if (rootResponse.ok) {
      const root = asRecord(await readJsonWithCap(rootResponse, 64 * 1024))
      version = String(root.version ?? '')
      pid = Number(root.pid) || 0
    }
  } catch {
    /* 版本信息是锦上添花，失败就空着 */
  }

  return { running: true, baseUrl: base, version, pid, models, message: '' }
}

export interface MagpieChatOptions {
  baseUrl?: string
  model?: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  fetchImpl?: FetchImpl
  timeoutMs?: number
}

/**
 * 经本机 Magpie 网关转发一次对话。
 *
 * **不接收 baseUrl 作为不可信输入**：调用方（`/api/ai/magpie`）传进来的永远是
 * 服务端自己配置的那个地址，前端传什么都不影响目标 —— 这条是本模块不成为
 * SSRF 跳板的全部原因，改动时不要为了「灵活」把地址变成可传参。
 *
 * @throws {Error} 带可直接展示给用户的中文信息
 */
export async function chatViaMagpie({
  baseUrl = MAGPIE_DEFAULT_BASE,
  model = MAGPIE_DEFAULT_MODEL,
  messages,
  temperature = 0.7,
  fetchImpl = fetch,
  timeoutMs = 60000,
}: MagpieChatOptions): Promise<string> {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!isLoopbackUrl(base)) throw new Error('Magpie 地址必须是本机回环地址')

  let response: Response
  try {
    response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 0.7,
        max_tokens: 1000,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Magpie 响应超时，请稍后再试', { cause: error })
    }
    throw new Error('连接不上 Magpie 网关，请确认它正在运行', { cause: error })
  }

  let data: Record<string, unknown> = {}
  try {
    data = asRecord(await readJsonWithCap(response))
  } catch {
    /* 上游错误页可能是 HTML / 超大 body：按空对象处理，走下面的兜底文案 */
  }

  if (!response.ok) {
    const message =
      String(asRecord(data.error).message || data.message || '') ||
      `Magpie 返回了 ${response.status} 状态码`
    throw new Error(message)
  }

  const choices = Array.isArray(data.choices) ? data.choices : []
  const content = asRecord(asRecord(choices[0]).message).content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Magpie 没有返回有效内容')
  }
  return content
}

/* ---------------- 安装包 ---------------- */

/** 发布元数据里与本平台相关的包 */
export interface MagpieAsset {
  url: string
  size: number
  sha256: string
  version: string
}

/**
 * 按平台/架构挑安装包名。
 *
 * arch 收成 string 而不是 NodeJS.Architecture：调用方（含测试）要能传任意值验证
 * 「未知架构会退回默认包」，而 Architecture 是封闭联合，传别的编译期就报错。
 * 返回值只区分 arm64 与「其它」，所以这里不需要完整的架构枚举。
 */
export function assetNameFor(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') {
    return arch === 'arm64' ? 'magpie-windows-arm64.exe' : 'magpie-windows-amd64.exe'
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'magpie-darwin-arm64.zip' : 'magpie-darwin-amd64.zip'
  }
  return arch === 'arm64' ? 'magpie-linux-arm64' : 'magpie-linux-amd64'
}

/**
 * 从发布元数据里取本平台安装包。
 * @throws {Error} 元数据形状不对或没有对应平台包
 */
export function pickAsset(
  meta: unknown,
  platform: string = process.platform,
  arch: string = process.arch,
): MagpieAsset {
  const record = asRecord(meta)
  const version = String(record.version ?? '').trim()
  const assets = asRecord(record.assets)
  const name = assetNameFor(platform, arch)
  const asset = asRecord(assets[name])
  const url = String(asset.url ?? '').trim()
  const sha256 = String(asset.sha256 ?? '')
    .trim()
    .toLowerCase()
  const size = Number(asset.size) || 0

  if (!version) throw new Error('发布信息里没有版本号，无法校验下载内容')
  if (!url) throw new Error(`发布信息里没有 ${name}，当前平台暂不支持自动安装`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    // 没有 sha256 就不下载：装一个无法校验的可执行文件，比不装更危险
    throw new Error('发布信息里缺少 sha256，出于安全考虑不自动下载')
  }
  if (!(size > 0) || size > MAGPIE_MAX_DOWNLOAD_BYTES) {
    throw new Error('安装包体积异常，已中止下载')
  }
  return { url, size, sha256, version }
}

/**
 * 默认安装目录。
 *
 * 用户明确要求装到 D 盘，所以 Windows 下优先 `D:\Tool`（本项目其它工具也在这个目录，
 * 实测可写）；D 盘不存在时退回 `%LOCALAPPDATA%\Magpie`，而不是硬失败 ——
 * 「把东西装到一个不存在的盘」只会得到一个看不懂的错误。
 * `MAGPIE_INSTALL_DIR` 可覆盖，便于多机部署与测试。
 */
export function resolveInstallDir({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
}: {
  env?: NodeJS.ProcessEnv
  platform?: string
  exists?: (target: string) => boolean
} = {}): { dir: string; fallback: boolean } {
  const explicit = String(env.MAGPIE_INSTALL_DIR ?? '').trim()
  if (explicit) return { dir: explicit, fallback: false }

  if (platform === 'win32') {
    const preferred = 'D:\\Tool'
    if (exists('D:\\')) return { dir: preferred, fallback: false }
    const local =
      String(env.LOCALAPPDATA ?? '').trim() || path.join(os.homedir(), 'AppData', 'Local')
    return { dir: path.join(local, 'Magpie'), fallback: true }
  }
  return { dir: path.join(os.homedir(), '.local', 'bin'), fallback: false }
}

/** 该平台是否支持「下载 + 启动」这条自动安装链路（仅 Windows 实测过） */
export function canAutoInstall(platform: string = process.platform): boolean {
  return platform === 'win32'
}

/** 可执行文件名 */
export function exeNameFor(platform: string = process.platform): string {
  return platform === 'win32' ? 'magpie-windows-amd64.exe' : 'magpie'
}

/** 本机上可能已存在的 Magpie 路径（含用户手工放在 D:\Tool 的那份） */
export function knownMagpiePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = [
    String(env.MAGPIE_EXE_PATH ?? '').trim(),
    path.join(resolveInstallDir({ env }).dir, exeNameFor()),
    'D:\\Tool\\magpie-windows-amd64.exe',
    path.join(String(env.LOCALAPPDATA ?? ''), 'Magpie', 'magpie-windows-amd64.exe'),
    path.join(String(env.APPDATA ?? ''), 'magpie-windows-amd64.exe'),
  ]
  return [...new Set(candidates.filter(Boolean))]
}

/**
 * 找出本机已安装的 Magpie 可执行文件。
 * @returns 命中路径；都没有返回空串
 */
export async function findInstalledMagpie(
  candidates: string[] = knownMagpiePaths(),
): Promise<string> {
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isFile() && info.size > 0) return candidate
    } catch {
      /* 该路径没有，试下一个 */
    }
  }
  return ''
}

/** 校验下载地址可接受：协议 + 主机白名单 */
export function assertDownloadUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('下载地址不是合法 URL')
  }
  if (url.protocol !== 'https:') throw new Error('下载地址必须是 https')
  if (!DOWNLOAD_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`下载地址的主机不在白名单内（${url.hostname}）`)
  }
  return url
}

/** 流式读取并封顶，超限立刻断流，绝不把整包读进内存后再判断 */
async function readBodyWithCap(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('下载响应没有正文')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      reader.cancel().catch(() => {})
      throw new Error('安装包超过体积上限，已中止下载')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export interface DownloadMagpieOptions {
  /** 发布元数据地址（测试可替换） */
  metaUrl?: string
  /** 落盘目录 */
  destDir?: string
  fetchImpl?: FetchImpl
  platform?: string
  arch?: string
  /** 单跳超时；整包 60MB 在慢网下要久一点 */
  timeoutMs?: number
}

export interface DownloadMagpieResult {
  filePath: string
  version: string
  bytes: number
  sha256: string
}

/**
 * 下载并安装 Magpie（Windows 可执行文件）。
 *
 * 四道硬约束，缺一不可：
 *  1. **sha256 必须校验**，对不上就删掉临时文件 —— 装一个校验不过的可执行文件，
 *     比不装危险得多；
 *  2. **重定向逐跳复检**（GitHub Release 会 302 到 release-assets）；
 *  3. **体积封顶**，边读边计数；
 *  4. **先写 .part 再 rename**，中途失败不会留下一个半截的 exe 让人误以为装好了。
 *
 * @throws {Error} 带可直接展示给用户的中文信息
 */
export async function downloadMagpie({
  metaUrl = MAGPIE_RELEASE_META_URL,
  destDir = resolveInstallDir().dir,
  fetchImpl = fetch,
  platform = process.platform,
  arch = process.arch,
  timeoutMs = 120000,
}: DownloadMagpieOptions = {}): Promise<DownloadMagpieResult> {
  let metaResponse: Response
  try {
    metaResponse = await fetchImpl(assertDownloadUrl(metaUrl), {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    throw new Error('获取 Magpie 版本信息失败，请检查网络', { cause: error })
  }
  if (!metaResponse.ok) {
    throw new Error(`获取 Magpie 版本信息失败（HTTP ${metaResponse.status}）`)
  }

  let meta: unknown
  try {
    meta = await readJsonWithCap(metaResponse, 512 * 1024)
  } catch {
    throw new Error('Magpie 版本信息不是合法 JSON')
  }

  const asset = pickAsset(meta, platform, arch)

  let target = assertDownloadUrl(asset.url)
  let buffer: Buffer | null = null

  // 逐跳跟随重定向：每跳都重新做协议与主机白名单校验
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response: Response
    try {
      response = await fetchImpl(target, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
        headers: { accept: 'application/octet-stream' },
      })
    } catch (error) {
      throw new Error('下载 Magpie 失败：网络不可达', { cause: error })
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('下载跳转缺少目标地址')
      target = assertDownloadUrl(new URL(location, target).href)
      continue
    }

    if (!response.ok) throw new Error(`下载 Magpie 失败（HTTP ${response.status}）`)
    buffer = await readBodyWithCap(response, Math.min(asset.size, MAGPIE_MAX_DOWNLOAD_BYTES))
    break
  }

  if (!buffer) throw new Error('下载 Magpie 失败：跳转次数过多')

  const actual = createHash('sha256').update(buffer).digest('hex')
  if (actual !== asset.sha256) {
    throw new Error('安装包校验失败（sha256 不匹配），已放弃安装')
  }

  await mkdir(destDir, { recursive: true })
  const filePath = path.join(destDir, assetNameFor(platform, arch))
  const partPath = `${filePath}.part`
  try {
    await writeFile(partPath, buffer, { mode: 0o755 })
    await rename(partPath, filePath)
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => {})
    throw new Error(`写入 ${filePath} 失败：磁盘不可写或空间不足`, { cause: error })
  }

  return { filePath, version: asset.version, bytes: buffer.byteLength, sha256: actual }
}

/**
 * 启动已安装的 Magpie。
 *
 * `detached: true` + `stdio: 'ignore'` 是刻意的：
 *  - 它是常驻图形程序，不该被本服务的生命周期绑住（服务重启不该关掉它）；
 *  - 也不能用管道捕获它的输出 —— 在受限沙箱下 `stdio: 'pipe'` 会 EPERM，
 *    而这里本来也不需要它的 stdout（真正要看的日志在 Magpie 自己的 data 目录里）。
 *
 * @returns 子进程 pid（可能很快变成 Magpie 主进程，仅供参考）
 */
export async function launchMagpie(exePath: string): Promise<number> {
  await access(exePath).catch(() => {
    throw new Error(`找不到 Magpie：${exePath}`)
  })

  const child = spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  return child.pid ?? 0
}
