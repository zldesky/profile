/**
 * AI 转发端点守卫（纯逻辑可直测；DNS 解析支持注入以便单元测试）。
 *
 * 本服务会带着用户自己的 API Key 主动出网请求第三方 AI 服务，
 * base URL 来自客户端输入，必须按 SSRF 防线对待：
 *  1. 只允许 https（Key 不能明文过公网）；
 *  2. 拒绝带凭据的 URL（user:pass@host 形式），避免日志与转发歧义；
 *  3. 拒绝一切私网/环回/链路本地地址：
 *     - IP 字面量（含 IPv6、IPv4-mapped 等变体）直接按位判；
 *     - 域名先做 DNS 解析，再对每个解析结果按位判，防「公网域名指向内网 IP」；
 *     WHATWG URL 会把 0x7f.1、2130706433 这类变体规范化成点分十进制，
 *     所以这里只需要处理规范形态，但解析失败一律按拒绝处理（fail-closed）。
 *  4. 规范化路径：去掉尾部斜杠，调用方统一拼 /chat/completions。
 */

import dns from 'node:dns/promises'

/** IPv4 私有/保留段（返回命中描述，'' 表示公网可用） */
export function ipv4BlockReason(n) {
  const a = n >>> 24
  const b = (n >>> 16) & 0xff
  if (a === 0) return '未指定地址'
  if (a === 10) return '私网地址'
  if (a === 127) return '环回地址'
  if (a === 169 && b === 254) return '链路本地地址'
  if (a === 172 && b >= 16 && b <= 31) return '私网地址'
  if (a === 192 && b === 168) return '私网地址'
  if (a === 100 && b >= 64 && b <= 127) return '运营商级 NAT 地址'
  if (a >= 224) return '组播/保留地址'
  return ''
}

/** IPv6（已展开成 8 组 16 位数）私有/保留段；IPv4 映射形态回落到 IPv4 判断 */
export function ipv6BlockReason(g) {
  const isZero = (from, to) => g.slice(from, to + 1).every((x) => x === 0)
  if (isZero(0, 7)) return '未指定地址'
  if (isZero(0, 6) && g[7] === 1) return '环回地址'
  if ((g[0] & 0xfe00) === 0xfc00) return '私网地址'
  if ((g[0] & 0xffc0) === 0xfe80) return '链路本地地址'
  // ::ffff:x.x.x.x（IPv4-mapped）与 ::x.x.x.x（IPv4-compatible）、64:ff9b::/96（NAT64）
  // 的低 32 位都是一个 IPv4 地址，各栈对它们的处理不一，统一按 IPv4 校验
  const mapped =
    (isZero(0, 4) && g[5] === 0xffff) ||
    (isZero(0, 5) && (g[6] || g[7])) ||
    (g[0] === 0x64 && g[1] === 0xff9b && isZero(2, 5))
  if (mapped) return ipv4BlockReason(((g[6] << 16) | g[7]) >>> 0)
  return ''
}

/** 解析点分十进制 IPv4；格式非法返回 null（调用方 fail-closed） */
export function parseIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  if (octets.some((x) => x > 255)) return null
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
}

/** 解析任意 IPv6 文本为 8 组 16 位数；格式非法返回 null */
export function parseIpv6(text) {
  const input = String(text || '').toLowerCase()
  const parts = input.split('::')
  if (parts.length > 2) return null
  const toGroups = (side) =>
    side === ''
      ? []
      : side.split(':').map((seg) => {
          if (/^\d+\.\d+\.\d+\.\d+$/.test(seg)) {
            const n = parseIpv4(seg)
            return n === null ? null : [n >>> 16, n & 0xffff]
          }
          if (!/^[0-9a-f]{1,4}$/.test(seg)) return null
          return parseInt(seg, 16)
        })
  const flat = (arr) => arr.flatMap((x) => (x === null ? [null] : x))
  const left = flat(toGroups(parts[0]))
  const right = flat(toGroups(parts[1] ?? ''))
  if (left.includes(null) || right.includes(null)) return null
  if (parts.length === 2) {
    if (left.length + right.length > 7) return null
    const middle = Array(8 - left.length - right.length).fill(0)
    return [...left, ...middle, ...right]
  }
  return left.length === 8 ? left : null
}

/**
 * 判断一个地址字符串是否为不允许出网的地址。
 * @param {string} address IPv4/IPv6 文本（不带方括号）
 * @returns {string} '' 表示放行，否则返回拒绝原因
 */
export function addressBlockReason(address) {
  const text = String(address || '')
  if (text.includes(':')) {
    const groups = parseIpv6(text)
    return groups ? ipv6BlockReason(groups) : '无法识别的地址'
  }
  const n = parseIpv4(text)
  return n === null ? '无法识别的地址' : ipv4BlockReason(n)
}

const HOSTNAME_IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const HOSTNAME_IPV6_RE = /^\[[0-9a-f:]+\]$/i

/**
 * 校验并规范化 AI 服务地址。
 * @param {string} rawBaseUrl 用户填写的 base URL
 * @param {{ lookup?: (host: string, opts: object) => Promise<{address: string}[]> }} [deps]
 *   DNS 解析器，默认 node:dns/promises 的 lookup；测试可注入替身
 * @returns {Promise<{ ok: true, url: string } | { ok: false, message: string }>}
 */
export async function resolveAiEndpoint(rawBaseUrl, { lookup = dns.lookup } = {}) {
  const raw = String(rawBaseUrl || '').trim()
  if (!raw) return { ok: false, message: '请先填写 AI 服务地址' }

  let url
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: 'AI 服务地址不是合法的 URL' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, message: 'AI 服务地址必须是 https:// 开头' }
  }
  if (url.username || url.password) {
    return { ok: false, message: 'AI 服务地址不支持带账号密码' }
  }

  const host = url.hostname
  const literal = HOSTNAME_IPV6_RE.test(host)
    ? addressBlockReason(host.slice(1, -1))
    : HOSTNAME_IPV4_RE.test(host)
      ? addressBlockReason(host)
      : /^localhost$|\.localhost$/i.test(host)
        ? '环回地址'
        : ''

  if (literal) {
    return { ok: false, message: `不允许访问内网或环回地址（${literal}）` }
  }

  if (!HOSTNAME_IPV4_RE.test(host)) {
    // 域名形态：解析出全部地址逐一校验，任何一个落到内网都拒绝
    let addrs
    try {
      addrs = await lookup(host, { all: true })
    } catch {
      return { ok: false, message: 'AI 服务域名解析失败，请检查地址' }
    }
    if (!Array.isArray(addrs) || !addrs.length) {
      return { ok: false, message: 'AI 服务域名没有解析到任何地址' }
    }
    const bad = addrs.find((item) => addressBlockReason(item?.address))
    if (bad) {
      return { ok: false, message: '该域名解析到内网或环回地址，不允许访问' }
    }
  }

  const path = url.pathname.replace(/\/+$/, '')
  return { ok: true, url: `${url.origin}${path}` }
}
