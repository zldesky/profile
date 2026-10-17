import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, deriveCategory } from '../server/db.ts'

/** 每个用例独享一个内存库，互不污染 */
let db

beforeEach(() => {
  db = createDatabase({ filePath: ':memory:' })
})

describe('用户', () => {
  it('创建与按用户名查找（大小写不敏感）', () => {
    const user = db.createUser('ZhangSan', 'hash-x')
    expect(user.id).toBeGreaterThan(0)

    const found = db.findUserByUsername('zhangsan')
    expect(found.username).toBe('ZhangSan')
    expect(found.password_hash).toBe('hash-x')
    expect(db.findUserByUsername('nobody')).toBeUndefined()
  })

  it('重名创建抛出约束错误（大小写不敏感）', () => {
    db.createUser('ZhangSan', 'hash-x')
    expect(() => db.createUser('zhangsan', 'hash-y')).toThrow()
  })

  it('按 id 查询只返回公开字段', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    const found = db.findUserById(user.id)
    expect(found.username).toBe('zhangsan')
    expect(found.password_hash).toBeUndefined()
  })

  it('首个注册用户是管理员，后续是普通成员', () => {
    const first = db.createUser('owner', 'hash-x')
    expect(first.role).toBe('admin')
    expect(db.isAdminUser(first.id)).toBe(true)

    const second = db.createUser('member', 'hash-x')
    expect(second.role).toBe('member')
    expect(db.isAdminUser(second.id)).toBe(false)
  })
})

describe('应用配置 KV', () => {
  it('读写回环、缺失与损坏的 JSON 都安全返回 null', () => {
    expect(db.getConfig('styleConfig')).toBeNull()

    db.setConfig('styleConfig', { presets: [{ key: 'ink' }], matrix: { classic: ['ink'] } })
    expect(db.getConfig('styleConfig')).toEqual({
      presets: [{ key: 'ink' }],
      matrix: { classic: ['ink'] },
    })

    // 整体覆盖
    db.setConfig('styleConfig', { presets: [], matrix: {} })
    expect(db.getConfig('styleConfig')).toEqual({ presets: [], matrix: {} })
  })
})

describe('会话', () => {
  it('创建后可查、删除后不可查', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createSession(user.id, 'tok-1')
    expect(db.findSession('tok-1').user_id).toBe(user.id)

    db.deleteSession('tok-1')
    expect(db.findSession('tok-1')).toBeNull()
  })

  it('过期会话视为不存在且顺带被清掉', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createSession(user.id, 'tok-dead', -1)
    expect(db.findSession('tok-dead')).toBeNull()
    // 行确实被删除，而不是每次查询都重复判断
    expect(db.findSession('tok-dead')).toBeNull()
  })

  it('过期会话可批量清理', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createSession(user.id, 'tok-live', 60_000)
    db.createSession(user.id, 'tok-dead', -1)
    expect(db.purgeExpiredSessions()).toBe(1)
    expect(db.findSession('tok-live')).not.toBeNull()
  })
})

describe('简历快照', () => {
  it('保存后可原样读回，并带落库时间', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    const resume = { basics: { name: '张三' }, sections: [] }

    const { updatedAt } = db.saveResume(user.id, resume)
    const stored = db.getResume(user.id)
    expect(stored.resume).toEqual(resume)
    expect(stored.updatedAt).toBe(updatedAt)
  })

  it('重复保存为覆盖，读取不到时返回 null', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    expect(db.getResume(user.id)).toBeNull()

    db.saveResume(user.id, { v: 1 })
    const second = db.saveResume(user.id, { v: 2 })
    expect(db.getResume(user.id).resume).toEqual({ v: 2 })
    expect(db.getResume(user.id).updatedAt).toBe(second.updatedAt)
  })
})

describe('简历分享', () => {
  it('创建后公开可读，带创建与过期时间', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    const resume = { basics: { name: '张三' }, sections: [] }

    const { id, createdAt, expiresAt } = db.createShare('abc123', user.id, resume, 86_400_000)
    expect(id).toBe('abc123')

    const share = db.getShare('abc123')
    expect(share.resume).toEqual(resume)
    expect(share.userId).toBe(user.id)
    expect(share.createdAt).toBe(createdAt)
    expect(share.expiresAt).toBe(expiresAt)
  })

  it('过期的分享视为不存在，且被顺带清理', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare('dead', user.id, { v: 1 }, -1)
    db.createShare('live', user.id, { v: 1 }, 86_400_000)

    expect(db.getShare('dead')).toBeNull()
    expect(db.getShare('live')).not.toBeNull()
  })

  it('只有创建者本人能撤销', () => {
    const owner = db.createUser('owner', 'hash-x')
    const other = db.createUser('other', 'hash-x')
    db.createShare('share-1', owner.id, { v: 1 }, 86_400_000)

    expect(db.deleteShare('share-1', other.id)).toBe(false)
    expect(db.deleteShare('share-1', null)).toBe(false)
    expect(db.getShare('share-1')).not.toBeNull()

    expect(db.deleteShare('share-1', owner.id)).toBe(true)
    expect(db.getShare('share-1')).toBeNull()
  })
})

describe('简历合集', () => {
  const sample = {
    template: 'classic',
    basics: { name: '张三', jobTitle: '前端工程师' },
    theme: { accent: '#0a0b0c' },
    sections: [],
  }

  it('只有勾选展示的分享进入合集，默认分享不可见', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare('no-list', user.id, sample, 86_400_000)
    db.createShare('yes-list', user.id, sample, 86_400_000, true)

    expect(db.countCollection()).toBe(1)
    expect(db.listCollection({ limit: 10 }).map((item) => item.id)).toEqual(['yes-list'])
  })

  it('合集条目只带展示摘要，不携带简历正文', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare('sum-1', user.id, sample, 86_400_000, true)

    const [item] = db.listCollection({ limit: 10 })
    expect(item).toEqual({
      id: 'sum-1',
      name: '张三',
      jobTitle: '前端工程师',
      template: 'classic',
      accent: '#0a0b0c',
      category: 'tech',
      createdAt: expect.any(Number),
    })
    expect(item.sections).toBeUndefined()
    expect(item.data).toBeUndefined()
  })

  it('过期分享退出合集，最新创建的排在前面的分页正确', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare('old-dead', user.id, sample, -1, true)
    db.createShare('first', user.id, sample, 86_400_000, true)
    db.createShare('second', user.id, sample, 86_400_000, true)

    expect(db.countCollection()).toBe(2)

    const page1 = db.listCollection({ limit: 1, offset: 0 })
    expect(page1.map((item) => item.id)).toEqual(['second'])

    const page2 = db.listCollection({ limit: 1, offset: 1 })
    expect(page2.map((item) => item.id)).toEqual(['first'])
    expect(db.listCollection({ limit: 1, offset: 2 })).toEqual([])
  })

  it('撤销分享后合集同步移除', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare('gone', user.id, sample, 86_400_000, true)
    db.createShare('kept', user.id, sample, 86_400_000, true)

    expect(db.countCollection()).toBe(2)

    db.deleteShare('gone', user.id)
    expect(db.countCollection()).toBe(1)
    expect(db.listCollection({ limit: 10 }).map((item) => item.id)).toEqual(['kept'])
  })

  it('我的分享：只含本人未过期分享，带 listed 标记', () => {
    const mine = db.createUser('mine', 'hash-x')
    const other = db.createUser('other', 'hash-x')

    db.createShare(
      'mine-old',
      mine.id,
      { basics: { name: '甲', jobTitle: '工程师' } },
      86_400_000,
      false,
    )
    db.createShare(
      'mine-new',
      mine.id,
      { basics: { name: '乙', jobTitle: '设计师' } },
      86_400_000,
      true,
    )
    db.createShare('mine-dead', mine.id, { basics: { name: '丙' } }, -1, true)
    db.createShare('theirs', other.id, { basics: { name: '丁' } }, 86_400_000, true)

    // 同毫秒创建时 created_at 相同，排序不分先后：按 id 对齐断言
    const items = db.listUserShares(mine.id)
    expect(items.map((item) => item.id).sort()).toEqual(['mine-new', 'mine-old'])
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId['mine-new']).toMatchObject({ name: '乙', jobTitle: '设计师', listed: true })
    expect(byId['mine-old'].listed).toBe(false)
  })

  it('非法主色不入摘要（accent 为空字符串）', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare(
      'bad-accent',
      user.id,
      { ...sample, theme: { accent: 'javascript:alert(1)' } },
      86_400_000,
      true,
    )

    const [item] = db.listCollection({ limit: 10 })
    expect(item.accent).toBe('')
  })
})

describe('简历合集分类', () => {
  it('deriveCategory：岗位关键词命中与兜底', () => {
    expect(deriveCategory('前端开发工程师')).toBe('tech')
    expect(deriveCategory('Java 后端工程师')).toBe('tech')
    expect(deriveCategory('数据分析师')).toBe('tech')
    expect(deriveCategory('产品经理')).toBe('product')
    expect(deriveCategory('UI 设计师')).toBe('design')
    expect(deriveCategory('运营经理')).toBe('ops')
    expect(deriveCategory('市场营销专员')).toBe('marketing')
    expect(deriveCategory('人力资源专员')).toBe('hr')
    expect(deriveCategory('财务主管')).toBe('finance')
    expect(deriveCategory('销售顾问')).toBe('sales')
    expect(deriveCategory('中学教师')).toBe('edu')
    expect(deriveCategory('神秘职业')).toBe('misc')
    expect(deriveCategory('')).toBe('misc')
    expect(deriveCategory(null)).toBe('misc')
  })

  it('分享入库自动带分类，列表与计数可按分类过滤', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    const share = (id, jobTitle) =>
      db.createShare(id, user.id, { basics: { jobTitle } }, 86_400_000, true)
    share('t1', '前端工程师')
    share('t2', '算法工程师')
    share('d1', 'UI 设计师')

    expect(db.countCollection()).toBe(3)
    expect(db.countCollection({ category: 'tech' })).toBe(2)
    expect(db.countCollection({ category: 'design' })).toBe(1)
    expect(db.listCollection({ category: 'tech', limit: 10 }).map((item) => item.id)).toEqual([
      't2',
      't1',
    ])
    // 无内容的分类不进 facets，顺序按固定规则
    expect(db.collectionFacets()).toEqual([
      { key: 'tech', count: 2 },
      { key: 'design', count: 1 },
    ])
  })

  it('过期分享不计入分类计数与 facets，未入合集的不参与', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare('dead', user.id, { basics: { jobTitle: '前端工程师' } }, -1, true)
    db.createShare('live', user.id, { basics: { jobTitle: '前端工程师' } }, 86_400_000, true)
    // 未勾选展示的分享不属于合集
    db.createShare('unlisted', user.id, { basics: { jobTitle: '产品经理' } }, 86_400_000, false)

    expect(db.countCollection({ category: 'tech' })).toBe(1)
    expect(db.collectionFacets()).toEqual([{ key: 'tech', count: 1 }])
  })

  it('求职意向为空时归入 misc', () => {
    const user = db.createUser('zhangsan', 'hash-x')
    db.createShare('no-title', user.id, { basics: {} }, 86_400_000, true)

    expect(db.countCollection({ category: 'misc' })).toBe(1)
    expect(db.collectionFacets()).toEqual([{ key: 'misc', count: 1 }])
  })

  it('旧库升级：先建老结构再迁移，share 列缺失不炸且存量分类被回填', () => {
    // 复现升级路径：旧版本建的 shares 表没有 listed / category 列
    const dir = mkdtempSync(join(tmpdir(), 'resume-upgrade-'))
    const legacy = new DatabaseSync(join(dir, 'legacy.db'))
    legacy.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE shares (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER,
        data       TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO users (username, password_hash, created_at) VALUES ('old-user', 'x', 1);
      INSERT INTO shares (id, user_id, data, created_at, expires_at)
        VALUES ('old-1', 1, '${JSON.stringify({ basics: { jobTitle: '前端工程师' } })}', 1, ${Date.now() + 86400000});
    `)
    legacy.close()

    // 用当前代码打开旧库：迁移先于预编译语句执行，不能报「no column named」
    const upgraded = createDatabase({ filePath: join(dir, 'legacy.db') })

    // 老分享默认不公开（listed 落默认 0），不自动进合集
    expect(upgraded.countCollection()).toBe(0)

    // 但分类回填已执行：直读库确认存量行的 category 被推导
    const check = new DatabaseSync(join(dir, 'legacy.db'), { readOnly: true })
    expect(check.prepare("SELECT category FROM shares WHERE id = 'old-1'").get().category).toBe(
      'tech',
    )
    // 存量最早的用户被提为管理员，升级后存在可登录的管理员
    expect(check.prepare("SELECT role FROM users WHERE username = 'old-user'").get().role).toBe(
      'admin',
    )
    check.close()

    // 且能继续正常写入
    upgraded.createShare('new-1', 1, { basics: { jobTitle: '产品经理' } }, 86_400_000, true)
    expect(upgraded.countCollection({ category: 'product' })).toBe(1)
  })
})

describe('导出配额', () => {
  it('计数递增、退款递减、不透支到负数', () => {
    expect(db.quotaUsed('user:1', '2026-09-29')).toBe(0)

    expect(db.quotaConsume('user:1', '2026-09-29')).toBe(1)
    expect(db.quotaConsume('user:1', '2026-09-29')).toBe(2)

    db.quotaRefund('user:1', '2026-09-29')
    expect(db.quotaUsed('user:1', '2026-09-29')).toBe(1)

    db.quotaRefund('user:1', '2026-09-29')
    db.quotaRefund('user:1', '2026-09-29')
    expect(db.quotaUsed('user:1', '2026-09-29')).toBe(0)
  })

  it('不同主体与日期互不干扰，日汇总只看当天', () => {
    db.quotaConsume('user:1', '2026-09-29')
    db.quotaConsume('user:1', '2026-09-29')
    db.quotaConsume('user:2', '2026-09-29')
    db.quotaConsume('user:1', '2026-09-28')

    expect(db.quotaDaysUsed('2026-09-29')).toBe(3)
    expect(db.quotaDaysUsed('2026-09-28')).toBe(1)
    expect(db.quotaUsed('user:2', '2026-09-29')).toBe(1)
  })
})
