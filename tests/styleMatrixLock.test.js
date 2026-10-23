import { describe, expect, it } from 'vitest'

import { STYLE_PRESETS, TEMPLATES } from '../src/data/presets.ts'
import { resolveStyleWhitelist } from '../src/utils/styleMatrix.ts'

/**
 * 「后台保存过一次之后，默认模板的风格还能不能选」的端到端回归。
 *
 * 这是 K1 的真实形态：问题不出在任何单独的读或写，而出在**两端的组合**——
 * 后台把空行写进矩阵，读取侧又把空行当成「一个风格都不允许」。
 * 所以这里不复用 `buildMatrixPayload` 的返回值，而是**模拟服务端真实下发的
 * 响应体**（空对象 / 只含部分行 / 含空行三种历史形态），逐一看解析结果。
 *
 * 三段数据都取自真实运行过的服务端响应，不是臆造的：
 *   PUT /api/styles-admin {matrix:{}} → GET /api/styles -> {"matrix":{}}
 */
describe('后台保存后的读取（K1 回归）', () => {
  /** 服务端下发过的三种矩阵形态 */
  const serverPayloads = [
    {
      label: '后台保存空矩阵（本次修复后的正常形态）',
      matrix: {},
    },
    {
      label: '只给部分模板配了白名单',
      matrix: { sidebar: ['ink', 'indigo'] },
    },
    {
      label: '历史脏数据：空行被写进了库（修复前保存过的实例）',
      matrix: { classic: [], custom: [], sidebar: ['ink'] },
    },
  ]

  for (const { label, matrix } of serverPayloads) {
    it(`${label} → 默认模板「经典单栏」仍可选全部风格`, () => {
      const whitelist = resolveStyleWhitelist(matrix, 'classic')
      // 不限制 = null，而不是空数组
      expect(whitelist).toBeNull()

      // 逐个风格确认：任何一个被判成「锁定」都是回归
      for (const preset of STYLE_PRESETS) {
        const locked = Boolean(whitelist && !whitelist.includes(preset.key))
        expect(locked, `风格「${preset.key}」在经典单栏被误判为锁定`).toBe(false)
      }
    })
  }

  it('修复前的脏数据不会把「自由定制」也锁死', () => {
    // custom 同样没有 styles 白名单
    expect(resolveStyleWhitelist({ custom: [] }, 'custom')).toBeNull()
    expect(resolveStyleWhitelist({ custom: ['ink'] }, 'custom')).toEqual(['ink'])
  })

  it('显式白名单在脏数据里仍然生效（不能为了修空行把白名单一起废掉）', () => {
    const whitelist = resolveStyleWhitelist({ classic: [], sidebar: ['ink'] }, 'sidebar')
    expect(whitelist).toEqual(['ink'])
    expect(whitelist?.includes('violet')).toBe(false)
  })

  it('每个模板在「空矩阵」下都可选全部风格（不只 classic）', () => {
    for (const tpl of TEMPLATES) {
      expect(resolveStyleWhitelist({}, tpl.id), `模板「${tpl.id}」在空矩阵下被限制`).toBeNull()
    }
  })
})
