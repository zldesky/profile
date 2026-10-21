import { describe, expect, it } from 'vitest'

import { sectionLayoutStyle } from '../src/utils/sectionStyle.ts'

/**
 * sectionLayoutStyle 把「位置与间距」设置换算成内联样式。
 *
 * 这个函数最容易出错的不是搬字段，而是**零值不该输出**：
 * 它返回的是内联样式，一旦把未设置的项也写成 `0px`，就会盖掉主题里的
 * 默认间距（主题用 --gap 统一控制模块间距），改界面风格时全部失效。
 * 所以下面大半用例都在验证「没设置的项不出现」。
 */
function section(layout) {
  return { type: 'text', id: 's1', title: 't', visible: true, layout }
}

describe('sectionLayoutStyle：四个方向的间距', () => {
  it('全默认时返回空对象，不产生任何内联样式', () => {
    const style = sectionLayoutStyle(
      section({ align: 'inherit', indent: 0, extraGap: 0, indentRight: 0, extraGapBottom: 0 }),
    )
    expect(style).toEqual({})
  })

  it('左侧对应 paddingLeft', () => {
    expect(sectionLayoutStyle(section({ indent: 12 })).paddingLeft).toBe('12px')
  })

  it('右侧对应 paddingRight', () => {
    expect(sectionLayoutStyle(section({ indentRight: 16 })).paddingRight).toBe('16px')
  })

  it('负值同样生效（用于抵消主题自带缩进）', () => {
    const style = sectionLayoutStyle(section({ indent: -8, indentRight: -4 }))
    expect(style.paddingLeft).toBe('-8px')
    expect(style.paddingRight).toBe('-4px')
  })

  it('上方间距叠加在主题 --gap 之上，而不是直接覆盖', () => {
    const style = sectionLayoutStyle(section({ extraGap: 10 }))
    // 直接写 10px 会把主题的模块间距整个替换掉
    expect(style.marginTop).toBe('calc(1.15em * var(--gap) + 10px)')
  })

  it('下方间距同样叠加在 --gap 之上，方向为负值时可收拢', () => {
    const style = sectionLayoutStyle(section({ extraGapBottom: -6 }))
    expect(style.marginBottom).toBe('calc(1.15em * var(--gap) + -6px)')
  })

  it('四个方向互不影响，可同时存在', () => {
    const style = sectionLayoutStyle(
      section({ indent: 4, indentRight: 8, extraGap: 2, extraGapBottom: 6 }),
    )
    expect(style.paddingLeft).toBe('4px')
    expect(style.paddingRight).toBe('8px')
    expect(style.marginTop).toBe('calc(1.15em * var(--gap) + 2px)')
    expect(style.marginBottom).toBe('calc(1.15em * var(--gap) + 6px)')
  })

  it('只设置了下方时，上方不产生内联样式', () => {
    const style = sectionLayoutStyle(section({ extraGapBottom: 6 }))
    expect(style.marginTop).toBeUndefined()
    expect(style.marginBottom).toBeTruthy()
  })

  it('layout 缺失（旧数据）时不抛错也不产生间距', () => {
    expect(sectionLayoutStyle(section(undefined))).toEqual({})
    expect(sectionLayoutStyle({ type: 'text', id: 's', title: 't' })).toEqual({})
  })
})

describe('sectionLayoutStyle：对齐与列数', () => {
  it('对齐映射为自定义属性', () => {
    const style = sectionLayoutStyle(section({ align: 'center' }))
    expect(style['--sec-align']).toBe('center')
    expect(style['--sec-item-justify']).toBe('center')
  })

  it('inherit 不输出对齐，交给主题', () => {
    expect(sectionLayoutStyle(section({ align: 'inherit' }))['--sec-align']).toBeUndefined()
  })

  it('列数为 auto 时不覆盖网格模板', () => {
    const style = sectionLayoutStyle(section({ columns: 'auto' }))
    expect(style['--grid-template']).toBeUndefined()
    expect(style['--bars-template']).toBeUndefined()
  })

  it('显式列数分别写入 grid / bars 模板', () => {
    const grid = sectionLayoutStyle({ ...section({ columns: '3' }), type: 'grid' })
    expect(grid['--grid-template']).toBe('repeat(3, minmax(0, 1fr))')

    const skills = sectionLayoutStyle({ ...section({ columns: '2' }), type: 'skills' })
    expect(skills['--bars-template']).toBe('repeat(2, minmax(0, 1fr))')
  })
})
