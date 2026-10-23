import { shallowRef } from 'vue'

import { STYLE_PRESETS, TEMPLATES } from '@/data/presets'
import { API, request } from '@/utils/api'
import { resolveStyleWhitelist } from '@/utils/styleMatrix'
import type { StyleMatrix } from '@/utils/styleMatrix'
import type { StylePreset } from '@/types/resume'

/**
 * 模板 × 风格 SKU 配置的运行时来源（模块级单例）。
 *
 * 服务器存了管理后台发布的配置就用它；没存（未配置 / 服务未启动 / 拉取失败）
 * 则回退到代码内置的默认组合——编辑器永远可用，后台是增强而非依赖。
 *
 * presets: [{ key, name, swatch?, patch }]
 * matrix:  { [templateId]: [styleKey] }；缺模板键 = 不限制
 */

/** 内置兜底：从 TEMPLATES 的静态白名单推导矩阵 */
function builtinMatrix(): StyleMatrix {
  const matrix: StyleMatrix = {}
  for (const tpl of TEMPLATES) {
    if (tpl.styles) matrix[tpl.id] = [...tpl.styles]
  }
  return matrix
}

const presets = shallowRef<StylePreset[]>([])
const matrix = shallowRef<StyleMatrix>({})
/** loaded = 已拿到运行时配置；source: builtin | server */
const loaded = shallowRef(false)
const source = shallowRef<'builtin' | 'server'>('builtin')

function applyBuiltin(): void {
  presets.value = STYLE_PRESETS.map((preset) => ({ ...preset }))
  matrix.value = builtinMatrix()
  source.value = 'builtin'
}

/** 服务端 /api/styles 下发的配置形状（管理后台与编辑器共用） */
export interface ServerStyleConfig {
  presets?: { key: string; name: string; patch: StylePreset['patch'] }[]
  matrix?: StyleMatrix
}

function applyServerConfig(config: ServerStyleConfig | null): void {
  if (!config || !Array.isArray(config.presets) || !config.presets.length) {
    applyBuiltin()
  } else {
    presets.value = config.presets.map((preset) => ({
      key: preset.key,
      name: preset.name,
      swatch: preset.patch?.accent,
      patch: { ...preset.patch },
    }))
    matrix.value = config.matrix && typeof config.matrix === 'object' ? { ...config.matrix } : {}
    source.value = 'server'
  }
  loaded.value = true
}

export function useStyleConfig() {
  /** 拉取服务器配置；幂等（已加载时不重复请求），force 用于后台保存后强制刷新 */
  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    try {
      const data = await request<{ config: ServerStyleConfig | null }>(API.styles)
      applyServerConfig(data.config)
    } catch {
      // 配置读不到就用内置默认：编辑器永远可用，后台只是增强而非依赖
      applyBuiltin()
    }
  }

  /** 管理后台保存：直接以传入内容更新本地态，成功后无需再拉取 */
  function applyLocal(nextPresets: StylePreset[], nextMatrix: StyleMatrix): void {
    presets.value = nextPresets
    matrix.value = nextMatrix
    loaded.value = true
    source.value = 'server'
  }

  /**
   * 兼容矩阵：模板未声明白名单 = 不限制。
   *
   * 判空走 `resolveStyleWhitelist`，**不要**写成 `matrix[id] || null` ——
   * 空数组是 truthy，那样写会把「空行」解读成「一个风格都不允许」，
   * 把该模板下的风格胶囊全部置灰（见 utils/styleMatrix.ts 开头的说明）。
   */
  function stylesForTemplate(templateId: string): string[] | null {
    return resolveStyleWhitelist(matrix.value, templateId)
  }

  load()
  return { presets, matrix, loaded, source, load, applyLocal, stylesForTemplate }
}
