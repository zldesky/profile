import ClassicTemplate from './ClassicTemplate.vue'
import MinimalTemplate from './MinimalTemplate.vue'
import SidebarTemplate from './SidebarTemplate.vue'
import TimelineTemplate from './TimelineTemplate.vue'
import TwoColTemplate from './TwoColTemplate.vue'

/** 模板注册表：key 需与 data/presets.js 中 TEMPLATES 的 id 一致 */
export const TEMPLATE_COMPONENTS = {
  classic: ClassicTemplate,
  sidebar: SidebarTemplate,
  twocol: TwoColTemplate,
  timeline: TimelineTemplate,
  minimal: MinimalTemplate,
}

/**
 * 按 id 取模板组件，未注册时回退到经典单栏，避免数据异常导致白屏。
 */
export function resolveTemplate(id) {
  return TEMPLATE_COMPONENTS[id] || ClassicTemplate
}
