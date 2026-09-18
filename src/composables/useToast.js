import { shallowRef } from 'vue'

/**
 * 全局轻提示。
 * 模块级单例，任意组件调用 useToast() 得到的都是同一份状态。
 * message / visible 都是原始值，用 shallowRef 即可。
 */
const message = shallowRef('')
const visible = shallowRef(false)
let timer = null

export function useToast() {
  function toast(text, duration = 2000) {
    message.value = text
    visible.value = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      visible.value = false
    }, duration)
  }

  return { message, visible, toast }
}
