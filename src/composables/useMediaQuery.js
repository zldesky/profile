import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

/**
 * 窄屏断点。
 *
 * 这是布局切换的唯一依据：窄屏同一时刻只显示一栏，宽屏两栏并排。
 * CSS 里的 @media 必须用同一个 900px —— 改这里时记得同步
 * App.vue / EditorPanel.vue / TopBar.vue / PreviewToolbar.vue / editor.css。
 */
export const MOBILE_QUERY = '(max-width: 900px)'

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
