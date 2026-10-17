import { ref, shallowRef } from 'vue'

/**
 * 纸面 → 编辑面板的跳转。
 *
 * 点纸面上某个模块，右侧编辑面板切到「内容」页签、展开对应卡片并滚动过去，
 * 卡片闪一下描边，避免「跳过去了但不知道看哪儿」。
 *
 * 用模块级单例（与 useToast 同一做法）：发起方是预览区、响应方在编辑面板内部两层，
 * 之间隔着一个页签切换，靠 props/emit 串起来会把无关组件都染上这个参数。
 *
 * requestSeq 是必需的：重复点同一张卡片时 id 不变，只靠 id 的 watch 不会再次触发，
 * 而用户显然期望「再点一次仍滚过去」。序号让每次请求都是一次新事件。
 *
 * 只有普通点击会发起跳转；按住 Ctrl/Cmd 的多选由 usePaperSelection 处理，不经过这里。
 */
const targetId = shallowRef('')
const requestSeq = ref(0)

export function usePaperJump() {
  /** 请求跳到某个模块的编辑卡片 */
  function focusSection(id: string): void {
    targetId.value = id
    requestSeq.value += 1
  }

  /** 消费掉当前请求（由响应方在跳转后调用），避免同一请求被重复响应 */
  function consume(): void {
    targetId.value = ''
  }

  return { targetId, requestSeq, focusSection, consume }
}
