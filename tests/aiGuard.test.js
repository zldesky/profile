import { describe, expect, it } from 'vitest'

import { addressBlockReason, resolveAiEndpoint } from '../server/aiGuard.js'

describe('resolveAiEndpoint：AI 转发端点守卫', () => {
  it('合法的 https 地址返回规范化的端点（去尾斜杠）', async () => {
    await expect(resolveAiEndpoint('https://api.deepseek.com')).resolves.toEqual({
      ok: true,
      url: 'https://api.deepseek.com',
    })
    await expect(resolveAiEndpoint('https://open.bigmodel.cn/api/paas/v4/')).resolves.toEqual({
      ok: true,
      url: 'https://open.bigmodel.cn/api/paas/v4',
    })
  })

  it('拒绝 http 与非法 URL', async () => {
    const blocked = ['http://api.example.com', 'ftp://api.example.com', 'not a url', '', undefined]
    for (const url of blocked) {
      await expect(resolveAiEndpoint(url)).resolves.toMatchObject({ ok: false })
    }
  })

  it('拒绝环回与内网 IP 字面量，阻断 SSRF', async () => {
    const blocked = [
      'https://localhost/v1',
      'https://sub.localhost/v1',
      'https://127.0.0.1/v1',
      'https://10.0.0.5/v1',
      'https://192.168.1.10/v1',
      'https://172.16.0.1/v1',
      'https://172.31.255.1/v1',
      'https://169.254.169.254/latest/meta-data',
      'https://0.0.0.0/v1',
      'https://100.64.0.1/v1',
      'https://224.0.0.1/v1',
    ]
    for (const url of blocked) {
      await expect(resolveAiEndpoint(url), url).resolves.toMatchObject({ ok: false })
    }
  })

  it('拒绝十进制/十六进制/缩写等 IPv4 变体（URL 规范化后仍在黑名单）', async () => {
    const blocked = [
      'https://2130706433/v1', // 127.0.0.1 的十进制整数
      'https://0x7f.0.0.1/v1', // 十六进制写法
      'https://127.1/v1', // 缩写形式
      'https://0177.0.0.1/v1', // 八进制写法
    ]
    for (const url of blocked) {
      await expect(resolveAiEndpoint(url), url).resolves.toMatchObject({ ok: false })
    }
  })

  it('拒绝 IPv6 环回/私网/映射等变体', async () => {
    const blocked = [
      'https://[::1]/v1',
      'https://[::]/v1',
      'https://[fd00::1]/v1', // ULA fc00::/7
      'https://[fc00::abcd]/v1',
      'https://[fe80::1]/v1', // 链路本地
      'https://[::ffff:127.0.0.1]/v1', // IPv4-mapped 环回
      'https://[::127.0.0.1]/v1', // IPv4-compatible 环回
      'https://[64:ff9b::169.254.169.254]/v1', // NAT64 指向云元数据
    ]
    for (const url of blocked) {
      await expect(resolveAiEndpoint(url), url).resolves.toMatchObject({ ok: false })
    }
  })

  it('放行公网 IP 字面量与 172 段之外的形似值', async () => {
    const allowed = [
      'https://8.8.8.8/v1',
      'https://172.32.0.1/v1',
      'https://[2606:4700::1111]/v1',
      'https://[::ffff:8.8.8.8]/v1', // 映射到公网 IPv4 可放行
    ]
    for (const url of allowed) {
      await expect(resolveAiEndpoint(url), url).resolves.toMatchObject({ ok: true })
    }
  })

  it('域名解析到内网地址时拒绝，全公网时放行', async () => {
    const privateLookup = async () => [{ address: '10.0.0.9' }, { address: '8.8.8.8' }]
    await expect(
      resolveAiEndpoint('https://evil.example/v1', { lookup: privateLookup }),
    ).resolves.toMatchObject({ ok: false, message: '该域名解析到内网或环回地址，不允许访问' })

    const publicLookup = async () => [{ address: '104.18.7.10' }, { address: '2606:4700::6811' }]
    await expect(
      resolveAiEndpoint('https://api.example.com/v1', { lookup: publicLookup }),
    ).resolves.toMatchObject({ ok: true, url: 'https://api.example.com/v1' })
  })

  it('域名解析失败一律拒绝（fail-closed）', async () => {
    const notFound = async () => {
      const error = new Error('ENOTFOUND')
      error.code = 'ENOTFOUND'
      throw error
    }
    await expect(
      resolveAiEndpoint('https://nope.example/v1', { lookup: notFound }),
    ).resolves.toMatchObject({ ok: false })
    await expect(
      resolveAiEndpoint('https://nope.example/v1', { lookup: async () => [] }),
    ).resolves.toMatchObject({ ok: false })
    // 解析结果无法识别时同样拒绝
    await expect(
      resolveAiEndpoint('https://weird.example/v1', { lookup: async () => [{ address: '???' }] }),
    ).resolves.toMatchObject({ ok: false })
  })

  it('拒绝带账号密码的 URL', async () => {
    await expect(resolveAiEndpoint('https://user:pass@api.example.com/v1')).resolves.toMatchObject({
      ok: false,
    })
  })
})

describe('addressBlockReason：地址位级判断', () => {
  it('公网地址放行，私网/保留地址给出原因', () => {
    expect(addressBlockReason('8.8.8.8')).toBe('')
    expect(addressBlockReason('172.32.0.1')).toBe('')
    expect(addressBlockReason('2606:4700::1111')).toBe('')
    expect(addressBlockReason('10.1.2.3')).toBe('私网地址')
    expect(addressBlockReason('169.254.169.254')).toBe('链路本地地址')
    expect(addressBlockReason('::1')).toBe('环回地址')
    expect(addressBlockReason('::ffff:192.168.0.1')).toBe('私网地址')
    expect(addressBlockReason('garbage')).toBe('无法识别的地址')
  })
})
