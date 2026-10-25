import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

/**
 * 窄屏断点（布局切换）。
 *
 * 这是布局切换的唯一依据：命中时同一时刻只显示一栏 + 底部操作条，未命中两栏并排。
 * 两个条件（任一命中即单栏）：
 *  - 宽度 ≤768px —— 手机、折叠屏外屏，以及 iPad mini 竖屏（768 恰好单栏大纸，
 *    两栏会把纸压到 ~42%；769 起（iPad Air/Pro 竖屏、折叠屏内屏）宽度足够两栏，
 *    单栏只会把面板输入拉到 700px 宽、纸张完全藏起来（实测 810px）；
 *  - 宽度 ≤900px 且高度 ≤500px —— 横屏手机：宽度过了 768 但高度只剩三四百，
 *    再对半分两栏就都不可用了。
 *
 * 布局 CSS（EditorPanel.vue 的单栏块）必须用同一个查询 —— 改这里时记得同步。
 * 注意它**不是**触控适配的断点：≥36px 触控目标、16px 输入字号、安全区那些
 * 在平板/折叠屏上同样需要，仍走各自的 max-width: 900px（editor.css / TopBar /
 * PreviewToolbar / BaseSelect），两个断点职责不同、刻意分开。
 */
export const MOBILE_QUERY = '(max-width: 768px), (max-width: 900px) and (max-height: 500px)'

/**
 * 订阅媒体查询。
 *
 * 初值在 setup 阶段同步读取，而不是放到 onMounted：后者会让首帧先按桌面布局
 * 渲染一次再跳变，窄屏上能明显看到一次闪动。
 *
 * @param {string} query 媒体查询字符串
 * @returns {import('vue').ShallowRef<boolean>} 是否命中
 */
export function useMediaQuery(query) {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const list = supported ? window.matchMedia(query) : null
  const matches = shallowRef(list ? list.matches : false)

  const onChange = (event) => {
    matches.value = event.matches
  }

  onMounted(() => list?.addEventListener('change', onChange))
  onBeforeUnmount(() => list?.removeEventListener('change', onChange))

  return matches
}
