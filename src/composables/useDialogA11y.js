import { nextTick, onScopeDispose, watch } from 'vue'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 同时打开的弹窗按开启顺序记栈，Esc 只关最上层：
 * 验证码弹窗叠在账号弹窗上时，一次 Esc 不该把两层都关掉。
 */
const openStack = []
let dialogSeq = 0

/**
 * 弹窗无障碍三件套：
 *  1. 打开时焦点移入卡片（先第一个可聚焦元素，否则卡片本身）；
 *  2. Tab 在卡片内圈禁循环，Shift+Tab 反向，焦点不会漏到遮罩后面的编辑器；
 *  3. Esc 请求关闭（最上层弹窗响应），关闭后焦点归还给打开前的元素。
 *
 * @param {import('vue').Ref<boolean>} open 弹窗开关，与 v-if 同源
 * @param {import('vue').Ref<HTMLElement|null>} cardRef 弹窗卡片根元素（建议加 tabindex="-1"）
 * @param {() => void} onClose 请求关闭的回调，语义与点关闭按钮一致
 */
export function useDialogA11y(open, cardRef, onClose) {
  const token = ++dialogSeq
  let lastActive = null
  let wasOpen = false

  const onKeydown = (event) => {
    if (openStack[openStack.length - 1] !== token) return

    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }

    if (event.key !== 'Tab') return
    const card = cardRef.value
    if (!card) return

    const items = [...card.querySelectorAll(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0,
    )
    if (!items.length) {
      event.preventDefault()
      card.focus()
      return
    }

    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    const inside = card.contains(current)

    if (event.shiftKey && (!inside || current === first)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!inside || current === last)) {
      event.preventDefault()
      first.focus()
    }
  }

  /** 摘除监听并出栈；正常关闭与「弹窗开着时组件被卸载」共用后者 */
  const detach = () => {
    wasOpen = false
    const index = openStack.indexOf(token)
    if (index !== -1) openStack.splice(index, 1)
    document.removeEventListener('keydown', onKeydown, true)
  }
  onScopeDispose(detach)

  watch(open, (value) => {
    if (value && !wasOpen) {
      wasOpen = true
      openStack.push(token)
      // 焦点先归还用：记下打开前的元素，关闭时送回去，键盘用户不会「掉回页面顶部」
      lastActive = document.activeElement
      document.addEventListener('keydown', onKeydown, true)
      nextTick(() => {
        const card = cardRef.value
        if (!card) return
        const target = [...card.querySelectorAll(FOCUSABLE)].find(
          (el) => el.getClientRects().length > 0,
        )
        if (target) target.focus()
        else card.focus()
      })
    } else if (!value && wasOpen) {
      detach()
      if (lastActive instanceof HTMLElement) lastActive.focus()
      lastActive = null
    }
  })
}
