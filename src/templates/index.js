import { defineAsyncComponent } from 'vue'

import ClassicTemplate from './ClassicTemplate.vue'

/**
 * 模板组件按需加载：除兜底用的经典单栏保持同步外，其余模板切换到时才拉取，
 * 首屏只带一个模板的实现，EditorPage 体积随模板数量解耦。
 * 加载失败（网络异常等）回退到经典模板，避免数据异常导致白屏。
 */
const lazy = (loader) =>
  defineAsyncComponent(async () => {
    try {
      const module = await loader()
      return module.default
    } catch (error) {
      console.error(`模板加载失败，已回退到经典单栏：${error}`)
      return ClassicTemplate
    }
  })

/** 模板注册表：key 需与 data/presets.js 中 TEMPLATES 的 id 一致 */
export const TEMPLATE_COMPONENTS = {
  classic: ClassicTemplate,
  sidebar: lazy(() => import('./SidebarTemplate.vue')),
  twocol: lazy(() => import('./TwoColTemplate.vue')),
  timeline: lazy(() => import('./TimelineTemplate.vue')),
  minimal: lazy(() => import('./MinimalTemplate.vue')),
  banner: lazy(() => import('./BannerTemplate.vue')),
  business: lazy(() => import('./BusinessTemplate.vue')),
  cards: lazy(() => import('./CardsTemplate.vue')),
  rightbar: lazy(() => import('./RightbarTemplate.vue')),
  labelcol: lazy(() => import('./LabelcolTemplate.vue')),
  flowcols: lazy(() => import('./FlowcolsTemplate.vue')),
  custom: lazy(() => import('./CustomTemplate.vue')),
}

/**
 * 按 id 取模板组件，未注册时回退到经典单栏，避免数据异常导致白屏。
 */
export function resolveTemplate(id) {
  return TEMPLATE_COMPONENTS[id] || ClassicTemplate
}
