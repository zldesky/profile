import { describe, expect, it } from 'vitest'

import {
  MAGPIE_DEFAULT_MODEL,
  MAGPIE_MAX_DOWNLOAD_BYTES,
  assetNameFor,
  assertDownloadUrl,
  canAutoInstall,
  chatViaMagpie,
  isLoopbackUrl,
  pickAsset,
  probeMagpieGateway,
  resolveInstallDir,
} from '../server/magpie.ts'

/**
 * Magpie 直连的纯逻辑测试。
 *
 * 这里只测「不需要真网络、真落盘」的部分 —— 探测、转发、安装包挑选与地址校验。
 * 全部用注入的 fetch 替身，因此可以在 Node 里直跑，也不会真的下载 60MB。
 *
 * 为什么这些断言值得写：本模块承担的是**本服务唯一会下载并执行外部程序的路径**，
 * 而它最容易出的错是「静默放宽」—— 少校验一次 sha256、白名单多放一个主机、
 * 地址变成可从前端传入。这些错误都不会报错，只会安静地变成安全缺口。
 */

/** 造一个 JSON 响应替身 */
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** 造一个二进制响应替身 */
function bytesResponse(bytes, { status = 200, headers = {} } = {}) {
  return new Response(bytes, { status, headers })
}

describe('isLoopbackUrl（地址必须是本机）', () => {
  it('接受回环地址的各种写法', () => {
    expect(isLoopbackUrl('http://127.0.0.1:3425/v1')).toBe(true)
    expect(isLoopbackUrl('http://localhost:3425/v1')).toBe(true)
    expect(isLoopbackUrl('http://127.1.2.3:3425/v1')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:3425/v1')).toBe(true)
  })

  it('拒绝一切非本机地址', () => {
    // 关键：这条守住「免 Key 通道不会变成把本机额度借给远端」
    expect(isLoopbackUrl('http://192.168.1.10:3425/v1')).toBe(false)
    expect(isLoopbackUrl('https://usemagpie.ai/v1')).toBe(false)
    expect(isLoopbackUrl('http://10.0.0.1:3425/v1')).toBe(false)
    expect(isLoopbackUrl('http://localhost.evil.com/v1')).toBe(false)
  })

  it('拒绝非 http(s) 协议与垃圾输入', () => {
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false)
    expect(isLoopbackUrl('ftp://127.0.0.1/v1')).toBe(false)
    expect(isLoopbackUrl('')).toBe(false)
    expect(isLoopbackUrl('不是地址')).toBe(false)
  })
})

describe('probeMagpieGateway（探测）', () => {
  it('网关可用时回出 running 与模型清单', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/models')) {
        return jsonResponse({
          data: [
            { id: 'auto/DeepSeek-V4.1-Flash', display_name: 'DeepSeek V4.1 Flash' },
            { id: 'workbuddy/kimi-k3.1-pro' },
          ],
        })
      }
      return jsonResponse({ name: 'magpie', version: '0.1.1327', pid: 7896 })
    }

    const status = await probeMagpieGateway({ fetchImpl })
    expect(status.running).toBe(true)
    expect(status.version).toBe('0.1.1327')
    expect(status.pid).toBe(7896)
    expect(status.models).toHaveLength(2)
    // 没有 display_name 的用 id 兜底，界面不能显示成空白
    expect(status.models[1].label).toBe('workbuddy/kimi-k3.1-pro')
    expect(status.message).toBe('')
  })

  it('网关没起时 running=false 并给出可读原因', async () => {
    const fetchImpl = async () => {
      throw new Error('connect ECONNREFUSED')
    }
    const status = await probeMagpieGateway({ fetchImpl })
    expect(status.running).toBe(false)
    expect(status.message).toContain('没有检测到 Magpie')
  })

  it('地址不是本机时直接拒绝，且一个请求都不发', async () => {
    let called = 0
    const fetchImpl = async () => {
      called += 1
      return jsonResponse({ data: [] })
    }
    const status = await probeMagpieGateway({
      baseUrl: 'https://example.com/v1',
      fetchImpl,
    })
    expect(status.running).toBe(false)
    expect(status.message).toContain('本机回环')
    // 这条能失败：若哪天为了"方便"去掉地址校验，called 会变成 1
    expect(called).toBe(0)
  })

  it('返回的不是 JSON 时给出明确原因，而不是抛异常', async () => {
    const fetchImpl = async () => new Response('<html>oops</html>', { status: 200 })
    const status = await probeMagpieGateway({ fetchImpl })
    expect(status.running).toBe(false)
    expect(status.message).toContain('JSON')
  })

  it('非 2xx 时带上状态码', async () => {
    const fetchImpl = async () => new Response('', { status: 503 })
    const status = await probeMagpieGateway({ fetchImpl })
    expect(status.running).toBe(false)
    expect(status.message).toContain('503')
  })
})

describe('chatViaMagpie（免 Key 转发）', () => {
  it('正常返回模型内容', async () => {
    const fetchImpl = async (url, init) => {
      expect(String(url)).toBe('http://127.0.0.1:3425/v1/chat/completions')
      // 请求体里不该出现 Authorization —— 这正是"免 Key"的含义
      expect(init.headers?.Authorization).toBeUndefined()
      return jsonResponse({ choices: [{ message: { content: '可用' } }] })
    }
    const content = await chatViaMagpie({
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl,
    })
    expect(content).toBe('可用')
  })

  it('不传 baseUrl 时用默认网关，且默认模型是 auto 路由组', async () => {
    let seenBody = null
    const fetchImpl = async (_url, init) => {
      seenBody = JSON.parse(init.body)
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    }
    await chatViaMagpie({ messages: [{ role: 'user', content: 'hi' }], fetchImpl })
    expect(seenBody.model).toBe(MAGPIE_DEFAULT_MODEL)
    expect(MAGPIE_DEFAULT_MODEL.startsWith('auto/')).toBe(true)
  })

  it('地址不是本机时抛错，不发请求', async () => {
    let called = 0
    const fetchImpl = async () => {
      called += 1
      return jsonResponse({ choices: [] })
    }
    await expect(
      chatViaMagpie({
        baseUrl: 'http://192.168.1.10:3425/v1',
        messages: [{ role: 'user', content: 'hi' }],
        fetchImpl,
      }),
    ).rejects.toThrow('本机回环')
    expect(called).toBe(0)
  })

  it('上游错误信息原样透出（例如额度用尽）', async () => {
    const fetchImpl = async () =>
      jsonResponse({ error: { message: 'quota exhausted' } }, { status: 429 })
    await expect(
      chatViaMagpie({ messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
    ).rejects.toThrow('quota exhausted')
  })

  it('没有 choices 或 content 为空时抛可读错误', async () => {
    const empty = async () => jsonResponse({ choices: [] })
    await expect(
      chatViaMagpie({ messages: [{ role: 'user', content: 'hi' }], fetchImpl: empty }),
    ).rejects.toThrow('没有返回有效内容')

    const blank = async () => jsonResponse({ choices: [{ message: { content: '   ' } }] })
    await expect(
      chatViaMagpie({ messages: [{ role: 'user', content: 'hi' }], fetchImpl: blank }),
    ).rejects.toThrow('没有返回有效内容')
  })

  it('连接失败时提示确认 Magpie 是否在运行', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNREFUSED')
    }
    await expect(
      chatViaMagpie({ messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
    ).rejects.toThrow('连接不上 Magpie')
  })
})

describe('安装包挑选', () => {
  const meta = {
    version: '0.1.1559',
    assets: {
      'magpie-windows-amd64.exe': {
        url: 'https://github.com/yetone/magpie-releases/releases/download/v0.1.1559/magpie-windows-amd64.exe',
        size: 60382208,
        sha256: '1cea598bc5f6cfd61effd26c22802e41133c3857e01b54afc5e8ad8ebd74dadc',
      },
      'magpie-windows-arm64.exe': {
        url: 'https://github.com/yetone/magpie-releases/releases/download/v0.1.1559/magpie-windows-arm64.exe',
        size: 1,
        sha256: 'a'.repeat(64),
      },
    },
  }

  it('按平台与架构挑对包名', () => {
    expect(assetNameFor('win32', 'x64')).toBe('magpie-windows-amd64.exe')
    expect(assetNameFor('win32', 'arm64')).toBe('magpie-windows-arm64.exe')
    expect(assetNameFor('darwin', 'arm64')).toBe('magpie-darwin-arm64.zip')
    expect(assetNameFor('linux', 'x64')).toBe('magpie-linux-amd64')
  })

  it('挑出 Windows x64 包并带回 sha256 与体积', () => {
    const asset = pickAsset(meta, 'win32', 'x64')
    expect(asset.version).toBe('0.1.1559')
    expect(asset.size).toBe(60382208)
    expect(asset.sha256).toHaveLength(64)
  })

  it('缺少 sha256 时拒绝（不装无法校验的可执行文件）', () => {
    const broken = {
      version: '1',
      assets: { 'magpie-windows-amd64.exe': { url: 'https://x/y', size: 10 } },
    }
    expect(() => pickAsset(broken, 'win32', 'x64')).toThrow('sha256')
  })

  it('sha256 形状不对也拒绝', () => {
    const broken = {
      version: '1',
      assets: { 'magpie-windows-amd64.exe': { url: 'https://x/y', size: 10, sha256: 'abc' } },
    }
    expect(() => pickAsset(broken, 'win32', 'x64')).toThrow('sha256')
  })

  it('体积异常（0 或超过上限）时拒绝', () => {
    const zero = {
      version: '1',
      assets: {
        'magpie-windows-amd64.exe': { url: 'https://x/y', size: 0, sha256: 'a'.repeat(64) },
      },
    }
    expect(() => pickAsset(zero, 'win32', 'x64')).toThrow('体积')

    const huge = {
      version: '1',
      assets: {
        'magpie-windows-amd64.exe': {
          url: 'https://x/y',
          size: MAGPIE_MAX_DOWNLOAD_BYTES + 1,
          sha256: 'a'.repeat(64),
        },
      },
    }
    expect(() => pickAsset(huge, 'win32', 'x64')).toThrow('体积')
  })

  it('没有对应平台包时给出可读原因', () => {
    expect(() => pickAsset({ version: '1', assets: {} }, 'win32', 'x64')).toThrow('暂不支持')
  })

  it('没有版本号时拒绝（无法校验下载内容）', () => {
    expect(() => pickAsset({ assets: {} }, 'win32', 'x64')).toThrow('版本号')
  })
})

describe('assertDownloadUrl（下载地址白名单）', () => {
  it('放行 GitHub 与官方域名', () => {
    expect(() =>
      assertDownloadUrl('https://github.com/yetone/magpie-releases/releases/download/v1/x.exe'),
    ).not.toThrow()
    // 302 之后的真实落点，必须放行，否则下载一定失败
    expect(() =>
      assertDownloadUrl('https://release-assets.githubusercontent.com/github-production/x'),
    ).not.toThrow()
    expect(() => assertDownloadUrl('https://usemagpie.ai/api/latest')).not.toThrow()
  })

  it('拒绝白名单之外的主机', () => {
    expect(() => assertDownloadUrl('https://evil.example.com/x.exe')).toThrow('白名单')
    // 形近域名不能蒙混过关
    expect(() => assertDownloadUrl('https://github.com.evil.com/x.exe')).toThrow('白名单')
  })

  it('拒绝非 https', () => {
    expect(() => assertDownloadUrl('http://github.com/x.exe')).toThrow('https')
    expect(() => assertDownloadUrl('file:///C:/x.exe')).toThrow()
  })
})

describe('resolveInstallDir（默认装到 D 盘）', () => {
  it('D 盘存在时装到 D:\\Tool', () => {
    const result = resolveInstallDir({
      env: {},
      platform: 'win32',
      exists: (target) => target === 'D:\\',
    })
    expect(result.dir).toBe('D:\\Tool')
    expect(result.fallback).toBe(false)
  })

  it('没有 D 盘时退回 LOCALAPPDATA，而不是硬失败', () => {
    const result = resolveInstallDir({
      env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
      platform: 'win32',
      exists: () => false,
    })
    expect(result.fallback).toBe(true)
    expect(result.dir).toContain('Magpie')
    // 不能还硬指向 D 盘 —— 那会得到一个看不懂的写入失败
    expect(result.dir.startsWith('D:')).toBe(false)
  })

  it('MAGPIE_INSTALL_DIR 可覆盖（部署与测试都需要）', () => {
    const result = resolveInstallDir({
      env: { MAGPIE_INSTALL_DIR: 'E:\\apps\\magpie' },
      platform: 'win32',
      exists: () => true,
    })
    expect(result.dir).toBe('E:\\apps\\magpie')
    expect(result.fallback).toBe(false)
  })
})

describe('canAutoInstall（自动安装仅 Windows）', () => {
  it('只有 Windows 支持下载并启动这条链路', () => {
    expect(canAutoInstall('win32')).toBe(true)
    // 其它平台在代码里确实没实现启动，不能假装支持
    expect(canAutoInstall('darwin')).toBe(false)
    expect(canAutoInstall('linux')).toBe(false)
  })
})

describe('bytesResponse 辅助（保证替身本身可用）', () => {
  it('能造出带字节的响应，供下载用例复用', async () => {
    const res = bytesResponse(Buffer.from('abc'))
    expect(await res.text()).toBe('abc')
  })
})
