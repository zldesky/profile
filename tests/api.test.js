import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { makeClient, startApi, stopApi, uniqueUser } from './api/harness.js'

/**
 * /api 集成测试：起真实服务进程、发真实 HTTP 请求。
 *
 * 为什么不在进程内 import app：`server/index.ts` 不导出 app，导入即 listen；
 * 而且真进程会走到同一份 .env、中间件顺序、来源校验、会话守卫、SQLite 建表与迁移 ——
 * 把 app 抽出来单测会漏掉这些接缝，接缝恰恰最容易出问题。
 *
 * 三条自我约束（都是「测得不真」的常见来源）：
 *  1. **必须用临时数据库**：harness 把 DB_PATH 指到 os.tmpdir()，绝不碰开发数据。
 *  2. **必须手工带 cookie**：Node 的 fetch 不像浏览器那样自动保存 cookie，
 *     忘了带的话所有受保护接口都返 401，「守卫生效」的断言会一路假通过，
 *     而真实登录流程根本没被验证。harness 的 client 维护 cookie jar。
 *  3. **登录失败次数要克制**：登录锁定阈值是 10 次/IP+用户名，
 *     用不同用户名把失败次数分散开，避免一条测试把后面全锁死。
 */
let api
let base

beforeAll(async () => {
  api = await startApi()
  base = api.base
}, 30000)

afterAll(async () => {
  await stopApi()
})

/** 注册一个新用户并返回已登录的 client */
async function registerUser(prefix = 'u') {
  const client = makeClient(base)
  const username = uniqueUser(prefix)
  const res = await client.post('/api/auth/register', { username, password: 'password123' })
  expect(res.status, `注册失败：${res.text}`).toBe(200)
  expect(res.json.ok).toBe(true)
  return { client, username, user: res.json.user }
}

describe('健康检查与公开元数据', () => {
  it('GET /api/health 可用且不回传敏感配置', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // 口令/密钥这类东西绝不能出现在健康检查里
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/PDF_ACCESS_PASSWORD/i)
    expect(text).not.toMatch(/CAPTCHA_SECRET/i)
  })

  it('GET /api/captcha 下发挑战，但不泄露答案 x', async () => {
    const res = await fetch(`${base}/api/captcha`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe('string')
    // 只给 pieceY（纵向位置），横向答案是让用户拖出来的。
    // 若这里出现 x / answerX，滑块验证就形同虚设 —— 这条断言守着它。
    expect(body).not.toHaveProperty('x')
    expect(body).not.toHaveProperty('answerX')
    expect(typeof body.pieceY).toBe('number')
  })

  it('POST /api/captcha/verify 拒绝错误答案', async () => {
    const challenge = await (await fetch(`${base}/api/captcha`)).json()
    const res = await fetch(`${base}/api/captcha/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: challenge.id, x: -9999 }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).ok).toBe(false)
  })

  it('GET /api/styles 公开可读（前端启动就要用）', async () => {
    const res = await fetch(`${base}/api/styles`)
    expect(res.status).toBe(200)
  })

  it('GET /api/collection 公开可读（官网合集）', async () => {
    const res = await fetch(`${base}/api/collection`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('每个 /api 响应都带 X-Request-Id，且每次不同（报障时靠它对齐日志）', async () => {
    /*
     * 这条钉的是「日志能被对上下」：用户从网络面板复制一个请求 ID，
     * 运维能在几百行 JSON 日志里精确找到那一条。没有它，
     * 「我导出失败了」只能靠时间猜测。
     *
     * 断言必须能失败：去掉 response 头或改成固定值都会红。
     */
    const a = await fetch(`${base}/api/styles`)
    const b = await fetch(`${base}/api/styles`)
    const idA = a.headers.get('x-request-id')
    const idB = b.headers.get('x-request-id')
    expect(idA).toMatch(/^[0-9a-f-]{36}$/)
    expect(idB).toMatch(/^[0-9a-f-]{36}$/)
    expect(idA).not.toBe(idB)
  })
})

describe('注册与凭据校验', () => {
  it('注册成功后即登录（带会话 cookie）', async () => {
    const { client } = await registerUser('reg')
    const me = await client.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.json.user?.username).toBeTruthy()
  })

  it('用户名不合规返回 400 且给出可读原因', async () => {
    const client = makeClient(base)
    const res = await client.post('/api/auth/register', { username: '!', password: 'password123' })
    expect(res.status).toBe(400)
    expect(res.json.message).toMatch(/用户名/)
  })

  it('密码短于 8 位返回 400', async () => {
    const client = makeClient(base)
    const res = await client.post('/api/auth/register', {
      username: uniqueUser('short'),
      password: '123',
    })
    expect(res.status).toBe(400)
    expect(res.json.message).toMatch(/密码/)
  })

  it('重复用户名返回 409（不能被当成成功）', async () => {
    const { username } = await registerUser('dup')
    const other = makeClient(base)
    const res = await other.post('/api/auth/register', { username, password: 'password123' })
    expect(res.status).toBe(409)
    expect(res.json.ok).toBe(false)
  })
})

describe('登录、会话与登出', () => {
  it('登录成功后可访问受保护接口，登出后失效', async () => {
    const { username } = await registerUser('sess')

    const client = makeClient(base)
    const login = await client.post('/api/auth/login', { username, password: 'password123' })
    expect(login.status).toBe(200)
    expect(login.json.ok).toBe(true)

    expect((await client.get('/api/resume')).status).toBe(200)

    const out = await client.post('/api/auth/logout')
    expect(out.status).toBe(200)

    // 登出后会话必须真的失效，而不是只清了前端状态
    expect((await client.get('/api/resume')).status).toBe(401)
  })

  it('密码错误返回 401', async () => {
    const { username } = await registerUser('bad')
    const client = makeClient(base)
    const res = await client.post('/api/auth/login', { username, password: 'wrongpassword' })
    expect(res.status).toBe(401)
    expect(res.json.ok).toBe(false)
  })

  it('不存在的用户名也返回 401（不泄露账号是否存在）', async () => {
    const client = makeClient(base)
    const res = await client.post('/api/auth/login', {
      username: uniqueUser('nobody'),
      password: 'password123',
    })
    expect(res.status).toBe(401)
    // 与「密码错误」用同一条文案，避免枚举用户名
    expect(res.json.message).toBe('用户名或密码不正确')
  })
})

describe('守卫：受保护接口对匿名一律 401', () => {
  const PROTECTED = [
    ['GET', '/api/resume'],
    ['PUT', '/api/resume'],
    ['POST', '/api/share'],
    ['GET', '/api/share/mine'],
    ['POST', '/api/pdf'],
    ['POST', '/api/image-proxy'],
    ['POST', '/api/ai/chat'],
  ]

  for (const [method, path] of PROTECTED) {
    it(`${method} ${path} 匿名返回 401`, async () => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      })
      expect(res.status).toBe(401)
    })
  }

  it('GET /api/styles-admin 普通用户返回 403（不是 401）', async () => {
    const { client } = await registerUser('member')
    const res = await client.get('/api/styles-admin')
    // 已认证但无权限 → 403；与匿名的 401 区分开
    expect(res.status).toBe(403)
  })
})

describe('简历读写', () => {
  const RESUME = {
    template: 'classic',
    basics: { name: '张三', jobTitle: '前端工程师' },
    sections: [{ id: 's1', type: 'text', title: '自我评价', content: '熟悉 Vue 3' }],
  }

  it('新账号读到的简历为空，而不是报错', async () => {
    const { client } = await registerUser('empty')
    const res = await client.get('/api/resume')
    expect(res.status).toBe(200)
    expect(res.json.ok).toBe(true)
    expect(res.json.resume).toBeNull()
  })

  it('写入后能原样读回关键字段', async () => {
    const { client } = await registerUser('rw')
    const put = await client.put('/api/resume', { resume: RESUME })
    expect(put.status).toBe(200)
    expect(put.json.ok).toBe(true)
    expect(typeof put.json.updatedAt).toBe('number')

    const got = await client.get('/api/resume')
    expect(got.json.resume.basics.name).toBe('张三')
    expect(got.json.resume.sections).toHaveLength(1)
  })

  it('缺 sections 返回 400（脏数据不该进库）', async () => {
    const { client } = await registerUser('bad')
    const res = await client.put('/api/resume', { resume: { basics: { name: 'x' } } })
    expect(res.status).toBe(400)
    expect(res.json.ok).toBe(false)
  })

  it('服务端会清洗：丢弃客户端提交的模块 id，改由渲染端生成', async () => {
    const { client } = await registerUser('clean')
    await client.put('/api/resume', {
      resume: {
        ...RESUME,
        sections: [{ id: 'client-supplied', type: 'text', title: '模块', content: 'x' }],
      },
    })
    const got = await client.get('/api/resume')
    // 注释里写明「id 一律由渲染端生成，不接受客户端提供」，这里守住它
    expect(got.json.resume.sections[0]).not.toHaveProperty('id', 'client-supplied')
  })

  it('简历是按用户隔离的：另一个账号读不到', async () => {
    const a = await registerUser('iso-a')
    const b = await registerUser('iso-b')

    await a.client.put('/api/resume', { resume: { ...RESUME, basics: { name: '甲的简历' } } })

    const gotB = await b.client.get('/api/resume')
    // 这是最要紧的一条：越权读到别人的简历是数据泄露
    expect(gotB.json.resume).toBeNull()

    const gotA = await a.client.get('/api/resume')
    expect(gotA.json.resume.basics.name).toBe('甲的简历')
  })
})

describe('分享', () => {
  const RESUME = {
    template: 'classic',
    basics: { name: '分享者', jobTitle: '设计师' },
    sections: [{ id: 's1', type: 'text', title: '自我评价', content: '内容' }],
  }

  it('创建分享后，匿名用户凭链接可读（分享只读页无需登录）', async () => {
    const { client } = await registerUser('share')
    const created = await client.post('/api/share', { resume: RESUME })
    expect(created.status).toBe(200)
    expect(created.json.ok).toBe(true)
    const id = created.json.id
    expect(typeof id).toBe('string')

    // 刻意用裸 fetch（没有任何 cookie）验证匿名可读
    const anon = await fetch(`${base}/api/share/${id}`)
    expect(anon.status).toBe(200)
    const body = await anon.json()
    expect(body.ok).toBe(true)
  })

  it('不存在的分享 id 返回 404', async () => {
    const res = await fetch(`${base}/api/share/definitely-not-a-real-id`)
    expect(res.status).toBe(404)
    expect((await res.json()).ok).toBe(false)
  })

  it('/api/share/mine 只列出自己的分享', async () => {
    const a = await registerUser('mine-a')
    const b = await registerUser('mine-b')

    const made = await a.client.post('/api/share', { resume: RESUME })
    const idA = made.json.id

    const mineA = await a.client.get('/api/share/mine')
    expect(mineA.json.items.map((x) => x.id)).toContain(idA)

    // 乙的列表里不该出现甲的分享
    const mineB = await b.client.get('/api/share/mine')
    expect(mineB.json.items.map((x) => x.id)).not.toContain(idA)
  })

  it('删除分享后匿名读取返回 404', async () => {
    const { client } = await registerUser('del')
    const created = await client.post('/api/share', { resume: RESUME })
    const id = created.json.id

    const del = await client.delete(`/api/share/${id}`)
    expect(del.status).toBe(200)

    const anon = await fetch(`${base}/api/share/${id}`)
    expect(anon.status).toBe(404)
  })

  it('简历格式不正确时返回 400，不创建分享', async () => {
    const { client } = await registerUser('badshare')
    const res = await client.post('/api/share', { resume: { nope: true } })
    expect(res.status).toBe(400)
    expect(res.json.ok).toBe(false)
  })

  /*
   * ── 敏感信息屏蔽 ──────────────────────────────────────────────
   * 分享链接是公开只读的，勾了合集更是进公开目录，所以手机号 / 邮箱 / 身份证号
   * 必须在**存库之前**就被替换掉。这里刻意用**裸 fetch**（没有任何 cookie）
   * 去读分享接口 —— 判据是"匿名请求也拿不到原文"，这才能证明数据没有离开服务端，
   * 而不只是"页面上没显示"。
   */
  const SENSITIVE_RESUME = {
    template: 'classic',
    basics: {
      name: '分享者',
      jobTitle: '设计师',
      fields: [
        { icon: 'phone', label: '联系电话', value: '13800001111' },
        { icon: 'mail', label: '联系邮箱', value: 'share@example.com' },
        { icon: 'cake', label: '年龄', value: '30岁' },
      ],
    },
    sections: [
      {
        id: 's1',
        type: 'text',
        title: '自我评价',
        content: '可加微信 share_wx 或致电 13900002222 详谈。',
      },
    ],
  }

  it('分享快照里不含原手机号 / 邮箱 / 年龄（匿名请求也拿不到）', async () => {
    const { client } = await registerUser('redact')
    const created = await client.post('/api/share', { resume: SENSITIVE_RESUME })
    expect(created.status).toBe(200)

    const anon = await fetch(`${base}/api/share/${created.json.id}`)
    expect(anon.status).toBe(200)
    const raw = await anon.text()

    // 逐条查泄漏，而不是只看「值变了」
    expect(raw).not.toContain('13800001111')
    expect(raw).not.toContain('share@example.com')
    expect(raw).not.toContain('30岁')
    // 写进正文的手机号也要被替换
    expect(raw).not.toContain('13900002222')
    // 屏蔽后的形态应当在
    expect(raw).toContain('138****1111')
  })

  it('创建分享时回执告知屏蔽了哪些字段（屏蔽不能悄悄发生）', async () => {
    const { client } = await registerUser('redact2')
    const created = await client.post('/api/share', { resume: SENSITIVE_RESUME })

    expect(created.json.redacted.labels).toContain('联系电话')
    expect(created.json.redacted.labels).toContain('联系邮箱')
    expect(created.json.redacted.inText).toBeGreaterThan(0)
    expect(created.json.redacted.revealContacts).toBe(false)
  })

  it('显式 revealContacts 时保留联系方式（有意为之的出口）', async () => {
    const { client } = await registerUser('reveal')
    const created = await client.post('/api/share', {
      resume: SENSITIVE_RESUME,
      revealContacts: true,
    })
    expect(created.status).toBe(200)

    const anon = await fetch(`${base}/api/share/${created.json.id}`)
    const raw = await anon.text()
    expect(raw).toContain('13800001111')
    expect(created.json.redacted.labels).toEqual([])
  })

  it('展示到简历合集的那份同样已被屏蔽', async () => {
    const { client } = await registerUser('redactlist')
    const created = await client.post('/api/share', {
      resume: SENSITIVE_RESUME,
      listInCollection: true,
    })
    expect(created.status).toBe(200)

    // 合集是公开目录，屏蔽必须同样生效
    const list = await fetch(`${base}/api/collection?limit=50`)
    const raw = await list.text()
    expect(raw).not.toContain('13800001111')
    expect(raw).not.toContain('share@example.com')
  })
})

describe('来源与请求体防线', () => {
  it('伪造 Origin 的写请求被拒（CSRF 防线）', async () => {
    const { client, username } = await registerUser('csrf')
    const res = await client.post(
      '/api/auth/login',
      { username, password: 'password123' },
      { origin: 'https://evil.example.com' },
    )
    // 不能带 cookie 成功执行写操作；具体码值由守卫决定，但必须不是 200
    expect(res.status).not.toBe(200)
  })

  it('超过请求体上限的 JSON 被拒（不把内存交给客户端）', async () => {
    const { client } = await registerUser('big')
    // express.json 的 limit 是 8mb（实测确认，见 server/index.ts）。
    // 第一版我用 6MB 断言「应当被拒」，结果服务端返 200 —— 那是**正确行为**，
    // 错的是我的假设。这里改成真的越过上限。
    const huge = { resume: { sections: [], padding: 'x'.repeat(9 * 1024 * 1024) } }
    const res = await client.put('/api/resume', huge)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

/**
 * Magpie 本机直连（免 Key）的端点契约。
 *
 * 这里**不测「能不能真的调通模型」** —— 那取决于本机有没有装 Magpie、
 * 装的那份有没有登录账号，是环境状态而不是代码行为。拿它做断言只会得到一个
 * 时绿时红的测试，而那种测试比没有更糟（本仓库 A 类坑就是这个）。
 *
 * 要测的是**不依赖环境的契约**，尤其是三条安全闸门：
 *  1. 匿名一律 401（它花的是本机账号额度，不能对外开）；
 *  2. 安装必须显式 confirm:true（防止被静默触发下载并执行 exe）；
 *  3. status 如实回报可用性，而不是让界面自己猜。
 * 这三条任何一条失效都不会报错，只会安静地变成安全缺口 —— 所以必须钉住。
 */
describe('Magpie 本机直连端点', () => {
  it('status 匿名返回 401（免 Key 不等于免登录）', async () => {
    const res = await fetch(`${base}/api/magpie/status`)
    expect(res.status).toBe(401)
  })

  it('probe 与 chat 匿名都返回 401', async () => {
    const probe = await fetch(`${base}/api/magpie/probe`, { method: 'POST' })
    expect(probe.status).toBe(401)

    const chat = await fetch(`${base}/api/ai/magpie`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(chat.status).toBe(401)
  })

  it('install 匿名返回 401（不能靠匿名请求下载并执行程序）', async () => {
    const res = await fetch(`${base}/api/magpie/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    expect(res.status).toBe(401)
  })

  it('已登录时 status 给出明确答复，且不泄露无关配置', async () => {
    const { client } = await registerUser('mag')
    const res = await client.get('/api/magpie/status')
    expect(res.status).toBe(200)
    expect(res.json.ok).toBe(true)
    // available 是服务端判定的结果：本测试实例跑在回环地址上，默认开启
    expect(typeof res.json.available).toBe('boolean')
    expect(res.json.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/)
    // 安装目录要说出来，界面才能如实告诉用户「会存到哪」
    expect(typeof res.json.installDir).toBe('string')

    const text = JSON.stringify(res.json)
    expect(text).not.toMatch(/PDF_ACCESS_PASSWORD/i)
    expect(text).not.toMatch(/apiKey/i)
  })

  it('install 不带 confirm 时返回 400，且不会真的下载', async () => {
    const { client } = await registerUser('mag2')
    const res = await client.post('/api/magpie/install', {})
    // 关键是这条：不能因为「已登录」就自动开始下载
    expect(res.status).toBe(400)
    expect(String(res.json.message)).toContain('确认')
  })

  it('install 带 confirm:false 同样被拒（不能被 falsy 值绕过）', async () => {
    const { client } = await registerUser('mag3')
    const res = await client.post('/api/magpie/install', { confirm: false })
    expect(res.status).toBe(400)
  })

  it('chat 的对话格式非法时返回 400，不会转发到上游', async () => {
    const { client } = await registerUser('mag4')
    const empty = await client.post('/api/ai/magpie', { messages: [] })
    expect(empty.status).toBe(400)

    const tooLong = await client.post('/api/ai/magpie', {
      messages: [{ role: 'user', content: 'x'.repeat(8001) }],
    })
    expect(tooLong.status).toBe(400)
  })
})
