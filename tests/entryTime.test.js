import { describe, expect, it } from 'vitest'

import {
  EMPTY_PICKER_VALUE,
  MONTH_OPTIONS,
  formatTimeRange,
  formatYearMonth,
  fromPickerValue,
  monthIndex,
  parseTimeRange,
  rangesOverlap,
  readTimeInput,
  toPickerValue,
  yearOptions,
} from '@/utils/entryTime'

describe('parseTimeRange', () => {
  it('识别常见的四种写法', () => {
    expect(parseTimeRange('2022-06 - 至今')).toMatchObject({
      start: { year: 2022, month: 6 },
      ongoing: true,
    })
    expect(parseTimeRange('2022.6 ~ 2023.11')).toMatchObject({
      start: { year: 2022, month: 6 },
      end: { year: 2023, month: 11 },
    })
    expect(parseTimeRange('2022年6月—2023年11月')).toMatchObject({
      start: { year: 2022, month: 6 },
      end: { year: 2023, month: 11 },
    })
    expect(parseTimeRange('2019-07 - 2022-05')).toMatchObject({
      start: { year: 2019, month: 7 },
      end: { year: 2022, month: 5 },
    })
  })

  it('只有年份时用整年近似，不猜月份', () => {
    expect(parseTimeRange('2022 - 2024')).toMatchObject({
      start: { year: 2022, month: 1 },
      end: { year: 2024, month: 12 },
    })
  })

  it('只有年份且「至今」', () => {
    expect(parseTimeRange('2023 - 至今')).toMatchObject({ start: { year: 2023 }, ongoing: true })
  })

  it('解析不出来返回 null，绝不猜', () => {
    expect(parseTimeRange('')).toBeNull()
    expect(parseTimeRange('大学期间')).toBeNull()
    expect(parseTimeRange(null)).toBeNull()
    expect(parseTimeRange('2019 上半年')).toBeNull()
  })

  it('月份越界的写法不认（2022-13），避免把脏数据当合法区间', () => {
    // 只有年份能兜住，于是退化成年份近似而不是造出「13 月」
    const range = parseTimeRange('2022-13 - 2023-05')
    expect(range?.start.month).toBeLessThanOrEqual(12)
  })
})

describe('readTimeInput · 界面三分支', () => {
  it('空串是 empty（显示空选择器），不是 freeform', () => {
    expect(readTimeInput('')).toEqual({ kind: 'empty' })
    expect(readTimeInput('   ')).toEqual({ kind: 'empty' })
    expect(readTimeInput(null)).toEqual({ kind: 'empty' })
  })

  it('能解析的是 structured', () => {
    const input = readTimeInput('2022-06 - 至今')
    expect(input.kind).toBe('structured')
    expect(input.range.start).toEqual({ year: 2022, month: 6 })
  })

  it('看不懂的保留为 freeform —— 绝不强行改写成年月', () => {
    expect(readTimeInput('大学期间')).toEqual({ kind: 'freeform' })
  })

  /*
   * 这条钉的是一个真实 bug 的边界：
   * 点「自由填写」时，当前值往往**仍然可解析**（`2022-06 - 至今`），
   * 所以单靠 readTimeInput 推断会立刻切回选择器，按钮看起来毫无反应。
   * 组件的解法是引入显式 mode；这里断言的是「推断本身没有这个能力」，
   * 提醒后来者不要试图只靠内容判断用户的意图。
   */
  it('可解析的文本在任何情况下都会被判为 structured（所以模式必须显式记录）', () => {
    expect(readTimeInput('2022-06 - 至今').kind).toBe('structured')
    expect(readTimeInput('2022-06').kind).toBe('structured')
  })
})

describe('以前只写年份的写法不能被当成完整区间', () => {
  /*
   * 「2019 上半年」「2022 届」里的年份是描述的一部分。
   * 把它们当成年份区间，界面会把用户的写法改掉，重叠检查也会拿一个假区间去比。
   */
  it('单一年份且没有区间分隔符 → 不解析', () => {
    expect(parseTimeRange('2019 上半年')).toBeNull()
    expect(parseTimeRange('2022 届')).toBeNull()
    expect(readTimeInput('2019 上半年').kind).toBe('freeform')
  })

  it('单一年份但带区间分隔符 → 仍按整年解析（如「2022 -」表示在职中）', () => {
    expect(parseTimeRange('2022 -')).toMatchObject({ start: { year: 2022 }, end: { year: 2022 } })
  })
})

describe('fromPickerValue · 拼回存储字符串', () => {
  it('开始时间没选全时返回空串（半截数据会被原样印到纸上）', () => {
    expect(fromPickerValue({ ...EMPTY_PICKER_VALUE, startMonth: 6 })).toBe('')
    expect(fromPickerValue({ ...EMPTY_PICKER_VALUE })).toBe('')
  })

  it('勾了「至今」时忽略结束时间', () => {
    expect(
      fromPickerValue({
        startYear: 2022,
        startMonth: 6,
        endYear: 2023,
        endMonth: 1,
        ongoing: true,
      }),
    ).toBe('2022-06 - 至今')
  })

  it('有完整结束时间时写成区间', () => {
    expect(
      fromPickerValue({
        startYear: 2019,
        startMonth: 7,
        endYear: 2022,
        endMonth: 5,
        ongoing: false,
      }),
    ).toBe('2019-07 - 2022-05')
  })

  it('只有年份时月份按 1 月补，不留下空位', () => {
    expect(
      fromPickerValue({
        startYear: 2022,
        startMonth: null,
        endYear: null,
        endMonth: null,
        ongoing: false,
      }),
    ).toBe('2022-01')
  })

  it('结束时间只选了一半时只写开始（比写半截强）', () => {
    expect(
      fromPickerValue({
        startYear: 2022,
        startMonth: 6,
        endYear: 2024,
        endMonth: null,
        ongoing: false,
      }),
    ).toBe('2022-06')
  })
})

describe('往返一致', () => {
  it('解析 → 取值 → 拼回，两边都是结构化的情形应逐字一致', () => {
    for (const text of [
      '2022-06 - 至今',
      '2019-07 - 2022-05',
      '2015-09 - 2019-06',
      '2022-06 - 2023-11',
    ]) {
      const value = toPickerValue(parseTimeRange(text))
      expect(fromPickerValue(value)).toBe(text)
    }
  })

  it('空 → 空', () => {
    expect(fromPickerValue(toPickerValue(null))).toBe('')
  })
})

describe('formatYearMonth / formatTimeRange', () => {
  it('月份补零', () => {
    expect(formatYearMonth({ year: 2022, month: 6 })).toBe('2022-06')
    expect(formatYearMonth({ year: 2022, month: 12 })).toBe('2022-12')
    expect(formatYearMonth(null)).toBe('')
  })

  it('归一成统一写法', () => {
    expect(formatTimeRange(parseTimeRange('2022年6月 - 至今'))).toBe('2022-06 - 至今')
    expect(formatTimeRange(parseTimeRange('2019.7-2022.5'))).toBe('2019-07 - 2022-05')
  })

  it('解析不出来时原样返回 fallback', () => {
    expect(formatTimeRange(null, '大学期间')).toBe('大学期间')
  })
})

describe('rangesOverlap', () => {
  const range = (text) => parseTimeRange(text)

  it('同年段重叠', () => {
    expect(rangesOverlap(range('2022-01 - 2023-01'), range('2022-06 - 2023-06'))).toBe(true)
  })

  it('完全不重叠', () => {
    expect(rangesOverlap(range('2019-01 - 2020-01'), range('2021-01 - 2022-01'))).toBe(false)
  })

  it('同月交接不算重叠（换工作是常态）', () => {
    expect(rangesOverlap(range('2019-01 - 2022-01'), range('2022-01 - 2023-01'))).toBe(false)
  })

  it('「至今」视为无限远', () => {
    expect(rangesOverlap(range('2022-01 - 至今'), range('2023-01 - 2024-01'))).toBe(true)
  })

  it('包含关系算重叠', () => {
    expect(rangesOverlap(range('2018-01 - 2024-01'), range('2020-01 - 2021-01'))).toBe(true)
  })
})

describe('monthIndex', () => {
  it('可比较且连续', () => {
    expect(monthIndex({ year: 2022, month: 1 })).toBeLessThan(monthIndex({ year: 2022, month: 2 }))
    expect(monthIndex({ year: 2022, month: 12 })).toBe(monthIndex({ year: 2023, month: 1 }) - 1)
  })
})

describe('yearOptions / MONTH_OPTIONS', () => {
  it('年份覆盖未来 5 年到过去 40 年，降序排列', () => {
    const years = yearOptions(new Date('2026-03-01T00:00:00Z'))
    expect(years[0]).toBe(2031)
    expect(years[years.length - 1]).toBe(1986)
    expect(years.length).toBe(46)
    expect([...years].sort((a, b) => b - a)).toEqual(years)
  })

  it('月份是 1..12', () => {
    expect(MONTH_OPTIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})
