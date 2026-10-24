import { describe, expect, it } from 'vitest'

import { describeChanges, normalizeZh, summarizeChanges } from '@/utils/textNormalize'

/** 只取文本，便于断言 */
const t = (text, options) => normalizeZh(text, options).text

describe('中英空格', () => {
  it('汉字与字母之间补空格', () => {
    expect(t('用Vue3搭建')).toBe('用 Vue3 搭建')
    expect(t('熟练使用TypeScript')).toBe('熟练使用 TypeScript')
  })

  it('汉字与数字之间补空格', () => {
    expect(t('工作3年')).toBe('工作 3 年')
    expect(t('服务3000个用户')).toBe('服务 3000 个用户')
  })

  it('已有空格时不重复添加', () => {
    expect(t('用 Vue3 搭建')).toBe('用 Vue3 搭建')
  })

  it('纯中文或纯英文不动', () => {
    expect(t('主导支付链路重构')).toBe('主导支付链路重构')
    expect(t('Led the payment rebuild')).toBe('Led the payment rebuild')
  })

  it('可以单独关闭', () => {
    expect(t('用Vue3搭建', { cjkLatinSpace: false })).toBe('用Vue3搭建')
  })
})

describe('折叠空格', () => {
  it('连续空格折成一个', () => {
    expect(t('主导  支付   重构')).toBe('主导 支付 重构')
  })

  it('中文标点前的空格去掉', () => {
    expect(t('主导重构 ，失败率下降')).toBe('主导重构，失败率下降')
    expect(t('结果 ）很明显')).toBe('结果）很明显')
  })

  it('中文标点后的空格保留（英文排版习惯，也是可读性）', () => {
    expect(t('主导重构， 失败率下降')).toBe('主导重构， 失败率下降')
  })

  it('可以单独关闭', () => {
    expect(t('主导  支付', { collapseSpaces: false })).toBe('主导  支付')
  })
})

describe('标点全角（默认关闭）', () => {
  it('默认不动半角逗号', () => {
    expect(t('React, Vue')).toBe('React, Vue')
  })

  it('开启后，纯中文语境的半角逗号转全角', () => {
    expect(t('我做过三件事, 都很重要', { fullWidthPunctuation: true })).toBe(
      '我做过三件事， 都很重要',
    )
  })

  it('英文语境不转（React, Vue 保持半角）', () => {
    expect(t('React, Vue', { fullWidthPunctuation: true })).toBe('React, Vue')
  })

  it('数字之间的点不转（版本号与小数）', () => {
    expect(t('版本 1.2 已上线', { fullWidthPunctuation: true })).toContain('1.2')
  })
})

describe('受保护片段：绝不能改坏', () => {
  /*
   * 这一组是本文件最重要的部分。技术简历里最要紧的信息全在这几类里，
   * 一旦被「规范化」改掉，用户看到的是自己没写过的内容。
   */
  it('URL 原样保留', () => {
    const url = 'https://example.com/a/b?x=1'
    expect(t(`项目地址${url}`)).toContain(url)
  })

  it('邮箱原样保留', () => {
    expect(t('邮箱zhangwei@example.com')).toContain('zhangwei@example.com')
  })

  it('版本号原样保留', () => {
    expect(t('升级到Vue2.7')).toBe('升级到 Vue2.7')
    expect(t('Node18.17.0')).toContain('Node18.17.0')
  })

  it('C++ / C# 等运算符原样保留', () => {
    expect(t('熟悉C++与C#')).toContain('C++')
    expect(t('熟悉C++与C#')).toContain('C#')
  })

  it('百分比原样保留', () => {
    expect(t('通过率100%')).toContain('100%')
  })

  it('日期原样保留', () => {
    expect(t('2022-06至今')).toContain('2022-06')
  })

  it('数值区间原样保留', () => {
    expect(t('薪资25K-35K')).toContain('25K-35K')
  })

  it('文件路径与扩展名原样保留', () => {
    expect(t('改src/utils/api.ts')).toContain('src/utils/api.ts')
  })

  it('时间原样保留', () => {
    expect(t('10:30开会')).toContain('10:30')
  })
})

describe('改动清单', () => {
  it('有净变化时返回改动，改动前后的片段都能对上', () => {
    const result = normalizeZh('用Vue3搭建')
    expect(result.text).toBe('用 Vue3 搭建')
    expect(result.changes.length).toBeGreaterThan(0)
    for (const change of result.changes) {
      expect(change.before).not.toBe(change.after)
      expect(['space', 'punctuation', 'collapse']).toContain(change.kind)
    }
  })

  it('没有净变化时返回空清单（避免打开预览一片空白）', () => {
    const result = normalizeZh('已经规范的中文文案')
    expect(result.changes).toEqual([])
    expect(result.text).toBe('已经规范的中文文案')
  })

  it('空字符串与纯空白安全返回', () => {
    expect(normalizeZh('')).toEqual({ text: '', changes: [] })
    expect(normalizeZh('   ')).toEqual({ text: '   ', changes: [] })
    expect(normalizeZh(null).text).toBe('')
  })

  it('summarizeChanges 限制条数（预览不该刷屏）', () => {
    const long = '中文abc'.repeat(20)
    const result = normalizeZh(long)
    expect(summarizeChanges(result, 5).length).toBe(5)
    expect(summarizeChanges(result, 100).length).toBeLessThanOrEqual(result.changes.length)
  })

  it('describeChanges 用人话汇总', () => {
    const result = normalizeZh('用Vue3搭建')
    const text = describeChanges(result.changes)
    expect(text).toContain('处')
    expect(text).toMatch(/中英空格|多余空格|标点/)
  })

  it('describeChanges 对空清单返回空串', () => {
    expect(describeChanges([])).toBe('')
  })
})

describe('幂等性', () => {
  it('对同一段文字规范化两次，结果不变（否则批量应用会反复改动）', () => {
    const samples = [
      '用Vue3搭建中后台，LCP从3.2s优化到1.4s',
      '主导支付链路重构 ，失败率从2%降到0.3%',
      '熟悉C++与C#，了解Node18.17.0',
      '通过率100%，服务3000用户',
    ]
    for (const sample of samples) {
      const once = t(sample)
      const twice = t(once)
      expect(twice).toBe(once)
    }
  })

  it('开启标点全角后也幂等', () => {
    const once = t('我做过三件事, 都很重要', { fullWidthPunctuation: true })
    const twice = t(once, { fullWidthPunctuation: true })
    expect(twice).toBe(once)
  })
})
