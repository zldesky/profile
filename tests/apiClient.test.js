import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  API,
  API_ERROR,
  ApiError,
  errorMessage,
  isAuthExpired,
  request,
  requestBlob,
} from '@/utils/api'

/**
 * 统一 API 客户端。
 *
 * 这层是把原先 20 处手写 fetch 收拢后的落点，所以断言要覆盖那些
 * **各处实现本来就不一致**的地方：非 JSON 响应、200 里带 ok:false、
 * 401 与 404 的分流、以及网络层失败。任何一条坏了都会让某个调用方
 * 拿到错误的 code，然后按错误的分支降级。
 */

/** 造一个 fetch 替身：返回给定的 Response-like 对象 */
function stubFetch(impl) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request：成功路径', () => {
  it('GET 返回解析后的 JSON', async () => {
    stubFetch(async () => jsonResponse({ ok: true, resume: { name: '张三' } }))

    const data = await request('/api/resume')

    expect(data.resume.name).toBe('张三')
  })

  it('POST 会 JSON 序列化 body 并带上 Content-Type', async () => {
    const calls = []
    stubFetch(async (path, init) => {
      calls.push({ path, init })
      return jsonResponse({ ok: true })
    })

    await request('/api/resume', { method: 'PUT', body: { resume: { name: '李四' } } })

    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('PUT')
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0].init.body)).toEqual({ resume: { name: '李四' } })
  })

  it('keepalive 会透传给 fetch（关页抢救推送依赖它）', async () => {
    let seen
    stubFetch(async (_path, init) => {
      seen = init.keepalive
      return jsonResponse({ ok: true })
    })

    await request('/api/resume', { method: 'PUT', body: {}, keepalive: true })

    expect(seen).toBe(true)
  })
})

describe('request：错误分流', () => {
  it('401 → AUTH_EXPIRED，并带上服务端 message', async () => {
    stubFetch(async () => jsonResponse({ ok: false, message: '请先登录后使用' }, 401))

    await expect(request('/api/resume')).rejects.toMatchObject({
      code: API_ERROR.AUTH_EXPIRED,
      status: 401,
      message: '请先登录后使用',
    })
  })

  it('404 → NOT_FOUND（分享链接失效要能与其它失败区分）', async () => {
    stubFetch(async () => jsonResponse({ ok: false, message: '分享不存在或已过期' }, 404))

    await expect(request(API.shareById('abc'))).rejects.toMatchObject({
      code: API_ERROR.NOT_FOUND,
    })
  })

  it('429 → REJECTED（额度与限频属可预期限制，不该当成未知错误）', async () => {
    stubFetch(async () => jsonResponse({ ok: false, message: '今日导出额度已用完' }, 429))

    await expect(request('/api/pdf', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: API_ERROR.REJECTED,
    })
  })

  it('200 但 ok:false 也算失败（本项目部分端点是这么用的）', async () => {
    stubFetch(async () => jsonResponse({ ok: false, message: '风格列表不合法' }, 200))

    await expect(request('/api/styles-admin', { method: 'PUT', body: {} })).rejects.toMatchObject({
      code: API_ERROR.REJECTED,
      message: '风格列表不合法',
    })
  })

  it('非 JSON 响应（HTML 错误页）不会抛 JSON 解析错误，而是给带状态码的兜底文案', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    }))

    const error = await request('/api/health').catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe('请求失败（500）')
    expect(error.code).toBe(API_ERROR.REQUEST_FAILED)
  })

  it('网络层失败 → NETWORK，且不把原始 TypeError 直接抛给界面', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await request('/api/health').catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe(API_ERROR.NETWORK)
    expect(error.status).toBe(0)
    expect(error.message).toContain('无法连接服务')
  })
})

describe('requestBlob：PDF 下载', () => {
  it('成功时返回 blob', async () => {
    const blob = { size: 1234, type: 'application/pdf' }
    stubFetch(async () => ({ ok: true, status: 200, blob: async () => blob }))

    await expect(requestBlob('/api/pdf', { method: 'POST', body: {} })).resolves.toBe(blob)
  })

  it('失败时读 JSON 里的 message 而不是把二进制当错误页', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, message: '口令连续错误过多，请 15 分钟后再试' }),
    }))

    await expect(requestBlob('/api/pdf', { method: 'POST', body: {} })).rejects.toMatchObject({
      message: '口令连续错误过多，请 15 分钟后再试',
      code: API_ERROR.REJECTED,
    })
  })
})

describe('辅助判定', () => {
  it('isAuthExpired 只认 ApiError 的 AUTH_EXPIRED', () => {
    expect(isAuthExpired(new ApiError('x', API_ERROR.AUTH_EXPIRED, 401))).toBe(true)
    expect(isAuthExpired(new ApiError('x', API_ERROR.NOT_FOUND, 404))).toBe(false)
    // 普通 Error 上挂个同名 code 不算 —— 这正是原先各模块手搓 error.code 的形态
    const fake = new Error('x')
    fake.code = 'AUTH_EXPIRED'
    expect(isAuthExpired(fake)).toBe(false)
  })

  it('errorMessage 对任意值都给得出字符串', () => {
    expect(errorMessage(new ApiError('服务端说的', API_ERROR.REJECTED, 400))).toBe('服务端说的')
    expect(errorMessage(new Error('普通错误'))).toBe('普通错误')
    expect(errorMessage('字符串')).toBe('字符串')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})

describe('端点清单', () => {
  it('shareById 会对 id 做 URL 编码', () => {
    expect(API.shareById('a b/c')).toBe('/api/share/a%20b%2Fc')
  })

  it('所有端点都以 /api 开头', () => {
    for (const [key, value] of Object.entries(API)) {
      if (typeof value !== 'string') continue
      expect(value.startsWith('/api'), `${key} 的路径不是 /api 开头：${value}`).toBe(true)
    }
  })
})
