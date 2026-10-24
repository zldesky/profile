import { nextTick, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

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
const openStack: number[] = []
let dialogSeq = 0

/**
 * 背景滚动锁的引用计数。
 *
 * 为什么用计数而不是布尔：弹窗会叠加（登录弹窗里再开验证码、分享弹窗里再开确认框）。
 * 用布尔时，内层关闭就把 body 的滚动恢复了，而外层还开着 ——
 * 表现为「弹窗还在，但后面的页面能滚了」，比不加锁更怪。
 *
 * 锁的是 body 而不是某个容器：弹窗都 Teleport 到 body，
 * 页面上同时存在多个可滚动容器（纸面舞台、右侧面板），逐个锁会漏。
 */
let scrollLockCount = 0
let savedOverflow = ''

function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) {
    // 还原成原来的值而不是清空：调用方可能本来就有 overflow 设置
    document.body.style.overflow = savedOverflow
  }
}

/**
 * 弹窗无障碍三件套：
 *  1. 打开时焦点移入卡片（先第一个可聚焦元素，否则卡片本身）；
 *  2. Tab 在卡片内圈禁循环，Shift+Tab 反向，焦点不会漏到遮罩后面的编辑器；
 *  3. Esc 请求关闭（最上层弹窗响应），关闭后焦点归还给打开前的元素。
 *
 * `open` 接受 Ref 或 getter（MaybeRefOrGetter），内部统一用 toValue 取值。
 * 这一点是必要的，不是宽松：组件普遍写 `() => props.open`，而 watch 直接传函数时
 * 会把**函数本身**当作 getter 求值一次，之后不再追踪 —— 于是弹窗其实从没被登记进
 * openStack，Esc 便由下层弹窗（或外层弹窗）响应。曾经有 9 个弹窗都是这个状态。
 * 现在统一在内部归一化，调用方传哪种都能正确追踪。
 *
 * @param open 弹窗开关，与 v-if 同源
 * @param cardRef 弹窗卡片根元素（建议加 tabindex="-1"）
 * @param onClose 请求关闭的回调，语义与点关闭按钮一致
 */
export function useDialogA11y(
  open: MaybeRefOrGetter<boolean>,
  cardRef: Ref<HTMLElement | null>,
  onClose: () => void,
): void {
  const token = ++dialogSeq
  let lastActive: HTMLElement | null = null
  let wasOpen = false

  const onKeydown = (event: KeyboardEvent): void => {
    if (openStack[openStack.length - 1] !== token) return

    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }

    if (event.key !== 'Tab') return
    const card = cardRef.value
    if (!card) return

    const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
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
    const inside = current instanceof Node && card.contains(current)

    if (event.shiftKey && (!inside || current === first)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!inside || current === last)) {
      event.preventDefault()
      first.focus()
    }
  }

  /** 摘除监听并出栈；正常关闭与「弹窗开着时组件被卸载」共用后者 */
  const detach = (): void => {
    if (!wasOpen) return
    wasOpen = false
    const index = openStack.indexOf(token)
    if (index !== -1) openStack.splice(index, 1)
    document.removeEventListener('keydown', onKeydown, true)
    unlockBodyScroll()
  }
  onScopeDispose(detach)

  watch(
    () => Boolean(toValue(open)),
    (value) => {
      if (value && !wasOpen) {
        wasOpen = true
        openStack.push(token)
        lockBodyScroll()
        // 焦点先归还用：记下打开前的元素，关闭时送回去，键盘用户不会「掉回页面顶部」
        lastActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
        document.addEventListener('keydown', onKeydown, true)
        nextTick(() => {
          const card = cardRef.value
          if (!card) return
          const target = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
            (el) => el.getClientRects().length > 0,
          )
          if (target) target.focus()
          else card.focus()
        })
      } else if (!value && wasOpen) {
        detach()
        lastActive?.focus()
        lastActive = null
      }
    },
  )
}
