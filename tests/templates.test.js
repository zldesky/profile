import { describe, expect, it } from 'vitest'

import { TEMPLATES } from '@/data/presets'
import { TEMPLATE_COMPONENTS, resolveTemplate } from '@/templates'

describe('模板注册表', () => {
  it('TEMPLATES 清单与组件注册一一对应', () => {
    const ids = TEMPLATES.map((t) => t.id)
    // 清单内不允许重复 id，否则选择器会出现两张同 id 卡片
    expect(new Set(ids).size).toBe(ids.length)

    // 清单里的每个模板都有对应组件，注册表里也没有清单外的孤儿组件
    for (const id of ids) {
      expect(TEMPLATE_COMPONENTS[id], `模板 ${id} 缺少组件注册`).toBeTruthy()
    }
    for (const key of Object.keys(TEMPLATE_COMPONENTS)) {
      expect(ids, `注册表中的 ${key} 未列入 TEMPLATES 清单`).toContain(key)
    }
  })

  it('每个模板都有名称、描述与标签', () => {
    for (const tpl of TEMPLATES) {
      expect(tpl.name).toBeTruthy()
      expect(tpl.desc).toBeTruthy()
      expect(Array.isArray(tpl.tags)).toBe(true)
    }
  })

  it('未知模板 id 回退到经典模板，避免数据异常白屏', () => {
    expect(resolveTemplate('nope')).toBe(TEMPLATE_COMPONENTS.classic)
  })
})
