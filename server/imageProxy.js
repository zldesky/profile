/**
 * 远程简历图片抓取代理：「图片生成模板」需要把图片画进 Canvas 读像素，
 * 前端直接 <img> 引外链会因 CORS 污染画布读不出数据，因此由服务端代取。
 *
 * 抓取任意 URL 属于高风险行为，本模块只负责这件事并施加硬性限制：
 *  1. 仅允许 http/https；
 *  2. 主机先解析成 IP 再逐个校验，拒绝回环 / 内网 / 链路本地等保留段，
 *     防 SSRF 与 DNS rebinding（解析结果可能有多条记录）；
 *  3. 重定向手动跟进（≤3 跳），每一跳都重新做协议与 IP 校验；
 *  4. 仅接受 image/* 响应，正文超 5MB 报错，单次请求 8 秒超时。
 * 依赖（fetch、dns.lookup）都可注入，便于在 Node 下直测。
 */

import dns from 'node:dns/promises'
import net from 'node:net'

/** 图片体积上限；简历截图很少超过 2MB，留一倍余量 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const FETCH_TIMEOUT = 8000
const MAX_REDIRECTS = 3

/** 校验 IP 是否公网单播地址；回环 / 内网 / 保留段一律拒绝 */
export function isPublicIp(ip) {
  const version = net.isIP(ip)
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 169 && b === 254) return false // 链路本地
    if (a === 172 && b >= 16 && b <= 31) return false // 内网
    if (a === 192 && b === 168) return false // 内网
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    return true
  }
  if (version === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::' || lower === '::1') return false
    if (lower.startsWith('fe80')) return false // 链路本地
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false // 唯一本地地址
    if (lower.startsWith('::ffff:')) return isPublicIp(lower.slice(7)) // IPv4 映射地址
    return true
  }
  return false
}

/**
 * 校验目标主机可访问：主机名解析出的所有地址都必须是公网 IP。
 * @param {string} hostname 域名或 IP 字面量
 * @param {(host: string) => Promise<Array<{address: string}>>} [lookup] 注入的解析函数
 */
export async function assertPublicHost(
  hostname,
  lookup = (host) => dns.lookup(host, { all: true, verbatim: true }),
) {
  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error('目标地址不允许访问')
    return
  }
  let addresses
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new Error('域名解析失败')
  }
  if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) {
    throw new Error('目标地址不允许访问')
  }
}

function parseTarget(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('链接格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http/https 链接')
  }
  if (!url.hostname) throw new Error('链接缺少主机名')
  return url
}

/** 流式读取响应体，超过上限立即断开，避免大响应占满内存 */
async function readBodyWithCap(response) {
  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_IMAGE_BYTES) {
      reader.cancel().catch(() => {})
      throw new Error('图片超过 5MB，请压缩后再试')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * 抓取远程图片并转为 data URL，供前端无污染地绘制到 Canvas。
 * @param {string} rawUrl 图片链接
 * @param {{ fetchImpl?: typeof fetch, lookup?: (host: string) => Promise<Array<{address: string}>> }} [deps]
 * @returns {Promise<{ dataUrl: string, contentType: string, bytes: number }>}
 */
export async function fetchRemoteImage(rawUrl, { fetchImpl = fetch, lookup } = {}) {
  let target = parseTarget(rawUrl)
  await assertPublicHost(target.hostname, lookup)

  for (let redirects = 0; ; redirects++) {
    let response
    try {
      response = await fetchImpl(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { accept: 'image/*' },
      })
    } catch (error) {
      if (error.name === 'TimeoutError') throw new Error('下载超时', { cause: error })
      throw new Error('下载失败：网络不可达', { cause: error })
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= MAX_REDIRECTS) throw new Error('重定向次数过多')
      const location = response.headers.get('location')
      if (!location) throw new Error('重定向缺少目标地址')
      target = parseTarget(new URL(location, target).href)
      await assertPublicHost(target.hostname, lookup)
      continue
    }

    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`)
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim()
    if (!contentType.startsWith('image/')) throw new Error('链接返回的内容不是图片')
    const buffer = await readBodyWithCap(response)
    return {
      dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
      contentType,
      bytes: buffer.byteLength,
    }
  }
}
