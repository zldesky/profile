import { describe, expect, it, vi } from 'vitest'

import { MAX_IMAGE_BYTES, fetchRemoteImage, isPublicIp } from '../server/imageProxy.js'

describe('isPublicIp：内网与保留段拦截', () => {
  const blocked = [
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '100.64.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ]
  const allowed = ['8.8.8.8', '1.1.1.1', '2606:4700::1111']

  it.each(blocked)('拒绝内网地址 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false)
  })

  it.each(allowed)('放行公网地址 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true)
  })
})

/** 构造最小可用的 fetch Response 桩 */
function fakeResponse({
  status = 200,
  contentType = 'image/png',
  location = null,
  chunk = new Uint8Array([1, 2, 3]),
}) {
  const headers = new Map([['content-type', contentType]])
  if (location) headers.set('location', location)
  let consumed = false
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers.get(name) ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (consumed) return { done: true, value: undefined }
          consumed = true
          return { done: false, value: chunk }
        },
        cancel: async () => {},
      }),
    },
  }
}

describe('fetchRemoteImage：远程图片抓取防护', () => {
  const publicLookup = vi.fn(async () => [{ address: '93.184.216.34' }])

  it('非 http/https 协议直接拒绝，不发起请求', async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchRemoteImage('ftp://example.com/a.png', { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow('仅支持 http/https')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('域名解析到内网地址时拒绝抓取', async () => {
    const fetchImpl = vi.fn()
    const lookup = vi.fn(async () => [{ address: '10.0.0.5' }])
    await expect(
      fetchRemoteImage('http://internal.example/a.png', { fetchImpl, lookup }),
    ).rejects.toThrow('目标地址不允许访问')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('重定向到内网地址时拒绝，每一跳都重新校验', async () => {
    const lookup = vi.fn(async (host) =>
      host === 'short.example' ? [{ address: '93.184.216.34' }] : [{ address: '192.168.0.10' }],
    )
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ status: 302, location: 'http://private.example/a.png' }),
    )
    await expect(
      fetchRemoteImage('http://short.example/a.png', { fetchImpl, lookup }),
    ).rejects.toThrow('目标地址不允许访问')
  })

  it('非图片内容类型拒绝', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ contentType: 'text/html' }))
    await expect(
      fetchRemoteImage('http://public.example/a', { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow('不是图片')
  })

  it('超过体积上限拒绝', async () => {
    const chunk = new Uint8Array(MAX_IMAGE_BYTES + 1)
    const fetchImpl = vi.fn(async () => fakeResponse({ chunk }))
    await expect(
      fetchRemoteImage('http://public.example/big.png', { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow('超过 5MB')
  })

  it('正常图片返回 data URL', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ chunk: new Uint8Array([137, 80, 78, 71]) }))
    const result = await fetchRemoteImage('http://public.example/a.png', {
      fetchImpl,
      lookup: publicLookup,
    })
    expect(result.contentType).toBe('image/png')
    expect(result.bytes).toBe(4)
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })
})
