import { describe, expect, it } from 'vitest'

import { formatBytes } from '@/utils/helpers'

/**
 * formatBytes 用在导出回执里。
 *
 * 它的价值在于：用户能据此判断「这是不是一份正常大小的简历」。
 * 所以断言的重点是**可读与不被误读**，不是精确到小数点。
 */
describe('formatBytes', () => {
  it('小于 1 KB 时显示字节数（一份 300 字节的 PDF 显然是空白页）', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(300)).toBe('300 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('KB 段：小于 10 保留一位小数，否则取整', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(3.5 * 1024)).toBe('3.5 KB')
    expect(formatBytes(380 * 1024)).toBe('380 KB')
  })

  it('MB 段', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1.2 * 1024 * 1024)).toBe('1.2 MB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB')
  })

  it('异常输入不抛错，也不显示 NaN', () => {
    expect(formatBytes(NaN)).toBe('大小未知')
    expect(formatBytes(-1)).toBe('大小未知')
    expect(formatBytes(undefined)).toBe('大小未知')
    expect(formatBytes('abc')).toBe('大小未知')
  })

  it('输出里不出现 NaN 或 undefined（这是它能被直接显示的前提）', () => {
    for (const value of [0, 1, 1024, 1048576, NaN, -5, undefined, null]) {
      const text = formatBytes(value)
      expect(text).not.toContain('NaN')
      expect(text).not.toContain('undefined')
    }
  })
})
