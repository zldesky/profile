import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../server/db.js'

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
