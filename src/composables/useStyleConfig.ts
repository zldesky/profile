import { shallowRef } from 'vue'

import { STYLE_PRESETS, TEMPLATES } from '@/data/presets'
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
function builtinMatrix(): Record<string, string[]> {
  const matrix: Record<string, string[]> = {}
  for (const tpl of TEMPLATES) {
    if (tpl.styles) matrix[tpl.id] = [...tpl.styles]
  }
  return matrix
}

const presets = shallowRef<StylePreset[]>([])
const matrix = shallowRef<Record<string, string[]>>({})
/** loaded = 已拿到运行时配置；source: builtin | server */
const loaded = shallowRef(false)
const source = shallowRef<'builtin' | 'server'>('builtin')

function applyBuiltin(): void {
  presets.value = STYLE_PRESETS.map((preset) => ({ ...preset }))
  matrix.value = builtinMatrix()
  source.value = 'builtin'
}

interface ServerStyleConfig {
  presets?: { key: string; name: string; patch: StylePreset['patch'] }[]
  matrix?: Record<string, string[]>
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
      const response = await fetch('/api/styles')
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) throw new Error(data?.message || '配置读取失败')
      applyServerConfig(data.config)
    } catch {
      applyBuiltin()
    }
  }

  /** 管理后台保存：直接以传入内容更新本地态，成功后无需再拉取 */
  function applyLocal(nextPresets: StylePreset[], nextMatrix: Record<string, string[]>): void {
    presets.value = nextPresets
    matrix.value = nextMatrix
    loaded.value = true
    source.value = 'server'
  }

  /** 兼容矩阵：模板未声明白名单 = 不限制 */
  function stylesForTemplate(templateId: string): string[] | null {
    return matrix.value[templateId] || null
  }

  load()
  return { presets, matrix, loaded, source, load, applyLocal, stylesForTemplate }
}
