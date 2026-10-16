import { describe, expect, it } from 'vitest'

import { STYLE_PRESETS, TEMPLATES } from '../src/data/presets.ts'

const styleKeys = new Set(STYLE_PRESETS.map((preset) => preset.key))

describe('模板 × 风格 SKU 矩阵', () => {
  it('每个模板的 styles 白名单都引用真实存在的风格键', () => {
    for (const tpl of TEMPLATES) {
      if (!tpl.styles) continue
      for (const key of tpl.styles) {
        expect(styleKeys.has(key), `${tpl.id} 引用了不存在的风格「${key}」`).toBe(true)
      }
      // 白名单内无重复
      expect(new Set(tpl.styles).size).toBe(tpl.styles.length)
    }
  })

  it('每个风格至少兼容 3 套模板，每套模板至少可选 3 种风格', () => {
    for (const preset of STYLE_PRESETS) {
      const count = TEMPLATES.filter((tpl) => !tpl.styles || tpl.styles.includes(preset.key)).length
      expect(count, `风格「${preset.key}」可用模板不足`).toBeGreaterThanOrEqual(3)
    }

    for (const tpl of TEMPLATES) {
      const count = tpl.styles ? tpl.styles.length : STYLE_PRESETS.length
      expect(count, `模板「${tpl.id}」可选风格不足`).toBeGreaterThanOrEqual(3)
    }
  })

  it('默认主题（纯黑 + fill 方块标题）命中「墨黑正式」，与任何模板都兼容', () => {
    const ink = STYLE_PRESETS.find((preset) => preset.key === 'ink')
    expect(ink).toBeTruthy()
    // 墨黑正式的 patch 与 DEFAULT_THEME 的默认值一致，保证初始状态有激活风格
    for (const [key, value] of Object.entries(ink.patch)) {
      expect(value, `墨黑正式的 ${key} 应与默认主题一致`).toBe(
        key === 'accent'
          ? '#000000'
          : key === 'titleStyle'
            ? 'fill'
            : key === 'titleMarker'
              ? 'square'
              : 'none',
      )
    }
    // classic / custom 未声明白名单 = 全兼容；ink 不缺席任何显式白名单
    for (const tpl of TEMPLATES) {
      expect(!tpl.styles || tpl.styles.includes('ink'), `${tpl.id} 应兼容墨黑正式`).toBe(true)
    }
  })
})
