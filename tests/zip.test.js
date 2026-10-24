import { describe, expect, it } from 'vitest'

import { buildZip, crc32, utf8Bytes } from '@/utils/zip'

/**
 * ZIP 打包的测试。
 *
 * 关键点：**不能只断言「产出的字节非空」**。ZIP 是最容易「看起来生成了、
 * 实际解压失败」的格式之一 —— 签名、CRC、偏移量任何一处错了，
 * 浏览器都照样能下载一个文件，只是用户打开时才报「压缩包已损坏」。
 *
 * 所以这里的断言尽量逼近「解压器会怎么读」：
 * 逐个字段核对结构、用已知 CRC 校验值、并模拟解析器走一遍中央目录。
 */

/** 按小端序读 u32/u16，便于像解析器一样检查 */
const u16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8)
const u32 = (bytes, offset) =>
  (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>>
  0

/** 在字节里找某个签名（小端序的 u32） */
const findSignature = (bytes, signature, from = 0) => {
  for (let i = from; i <= bytes.length - 4; i += 1) {
    if (u32(bytes, i) === signature) return i
  }
  return -1
}

describe('crc32', () => {
  it('与已知值一致（ZIP 与 PNG 都用这个多项式）', () => {
    // "123456789" 的 CRC-32 是 0xCBF43926，这是标准测试向量
    expect(crc32(utf8Bytes('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
    expect(crc32(utf8Bytes('a'))).toBe(0xe8b7be43)
  })

  it('对同一内容稳定', () => {
    const data = utf8Bytes('张伟的简历')
    expect(crc32(data)).toBe(crc32(data))
  })
})

describe('utf8Bytes', () => {
  it('中文按 UTF-8 编码（3 字节/字）', () => {
    expect(utf8Bytes('张伟').length).toBe(6)
    expect(utf8Bytes('a').length).toBe(1)
  })
})

describe('buildZip · 结构', () => {
  const entries = [
    { name: '张伟_简历.txt', data: utf8Bytes('hello') },
    { name: '张伟_简历.pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
  ]
  const zip = buildZip(entries)

  it('以本地文件头签名 0x04034b50 开头', () => {
    expect(u32(zip, 0)).toBe(0x04034b50)
  })

  it('以中央目录结束记录 0x06054b50 收尾', () => {
    const eocd = findSignature(zip, 0x06054b50)
    expect(eocd).toBeGreaterThan(0)
    expect(eocd + 22).toBe(zip.length)
  })

  it('条目数与中央目录条数一致', () => {
    const eocd = findSignature(zip, 0x06054b50)
    expect(u16(zip, eocd + 8)).toBe(entries.length) // 本盘条目数
    expect(u16(zip, eocd + 10)).toBe(entries.length) // 总条目数
  })

  it('压缩方式全是 STORE（0），且带 UTF-8 文件名标志', () => {
    let offset = 0
    for (let i = 0; i < entries.length; i += 1) {
      expect(u32(zip, offset)).toBe(0x04034b50)
      expect(u16(zip, offset + 6)).toBe(0x0800) // 通用标志 bit 11
      expect(u16(zip, offset + 8)).toBe(0) // STORE
      const nameLength = u16(zip, offset + 26)
      const extraLength = u16(zip, offset + 28)
      const size = u32(zip, offset + 18)
      const nameStart = offset + 30
      const name = new TextDecoder().decode(zip.slice(nameStart, nameStart + nameLength))
      expect(name).toBe(entries[i].name)
      offset = nameStart + nameLength + extraLength + size
    }
  })

  it('每个文件头里的 CRC 与内容对得上', () => {
    let offset = 0
    for (const entry of entries) {
      const crc = u32(zip, offset + 14)
      expect(crc).toBe(crc32(entry.data))
      const nameLength = u16(zip, offset + 26)
      const extraLength = u16(zip, offset + 28)
      const size = u32(zip, offset + 18)
      offset = offset + 30 + nameLength + extraLength + size
    }
  })

  it('中央目录里的偏移量指向真实的本地文件头', () => {
    const central = findSignature(zip, 0x02014b50)
    expect(central).toBeGreaterThan(0)
    const localOffset = u32(zip, central + 42)
    expect(u32(zip, localOffset)).toBe(0x04034b50)
  })

  it('同样的输入产出逐字节相同的包（便于比对与缓存）', () => {
    const again = buildZip(entries)
    expect(Array.from(again)).toEqual(Array.from(zip))
  })
})

describe('buildZip · 边界', () => {
  it('空列表也能生成合法的空包', () => {
    const zip = buildZip([])
    expect(u32(zip, 0)).toBe(0x06054b50)
    expect(zip.length).toBe(22)
    expect(u16(zip, 8)).toBe(0)
  })

  it('过滤掉没有名字的条目（否则会生成解压器读不懂的包）', () => {
    const zip = buildZip([
      { name: '', data: utf8Bytes('x') },
      { name: 'a.txt', data: utf8Bytes('y') },
    ])
    const eocd = findSignature(zip, 0x06054b50)
    expect(u16(zip, eocd + 10)).toBe(1)
  })

  it('非数组输入不抛错', () => {
    expect(() => buildZip(null)).not.toThrow()
    expect(() => buildZip(undefined)).not.toThrow()
  })

  it('空文件内容也能打包（大小 0，CRC 0）', () => {
    const zip = buildZip([{ name: 'empty.txt', data: new Uint8Array() }])
    expect(u32(zip, 18)).toBe(0)
    expect(u32(zip, 14)).toBe(0)
  })
})
