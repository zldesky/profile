import { shallowRef } from 'vue'

/**
 * 全局轻提示。
 * 模块级单例，任意组件调用 useToast() 得到的都是同一份状态。
 * message / visible 都是原始值，用 shallowRef 即可。
 */
const message = shallowRef('')
const visible = shallowRef(false)
let timer: ReturnType<typeof setTimeout> | null = null

export function useToast() {
  function toast(text: string, duration = 2000): void {
    message.value = text
    visible.value = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      visible.value = false
    }, duration)
  }

  return { message, visible, toast }
}
