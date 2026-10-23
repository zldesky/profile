/**
 * 拖拽过程中的「草稿顺序」预览。
 *
 * 存在的理由：拖动模块卡片时，右侧面板里能看到占位与让位动画，
 * 但左边纸面**纹丝不动** —— 只有松手才突然跳到新顺序。用户看不到自己要拖到哪儿。
 *
 * 直觉做法是拖动中直接调 `store.reorderSectionsByIds()`，但那是错的：
 * store 的每次改动都会
 *   1. 往撤销栈里压一笔（拖一次要按几十次 Ctrl+Z 才能退回去），
 *   2. 触发防抖自动保存（写 localStorage），
 *   3. 触发云端推送（登录态下真的会发请求）。
 * 拖动中顺序每秒可能变十几次，这三件事一件都不该发生。
 *
 * 所以拆成两层：
 *   - 拖动中：只写这里的 `previewOrder`，纯内存、无副作用，纸面按它渲染；
 *   - 松手：DraggableList 才 emit('reorder')，那时才真正写 store（一次）。
 *
 * 用模块级单例而不是 provide/inject：EditorPanel 与 PreviewPane 在 EditorPage
 * 里是兄弟节点，中间没有共同的 provide 源，传 props 要绕三层。
 * 与 useToast / useAuth 是同一个模式。
 */
import { computed, shallowRef } from 'vue'

import type { Section } from '@/types/resume'

/** 拖动中的模块 id 顺序；null = 不在拖动中（用真实数据） */
const previewOrder = shallowRef<string[] | null>(null)

/**
 * 按草稿顺序重排模块。
 *
 * 只在「拖动中」有值时才重排，并做两件保命的事：
 *   - 草稿里缺的模块（拖动瞬间被删、或草稿数组不完整）排在最后，一个都不丢；
 *   - 草稿里有但已不存在的 id 直接忽略，不会渲染出幽灵模块。
 * 这样即使拖拽组件给出不完整数组，纸面也只会「顺序略有出入」，不会漏内容。
 */
export function reorderSectionsByPreview(sections: Section[], order: string[] | null): Section[] {
  if (!order || !order.length) return sections

  const byId = new Map(sections.map((section) => [section.id, section]))
  const ordered: Section[] = []
  for (const id of order) {
    const section = byId.get(id)
    if (section) {
      ordered.push(section)
      byId.delete(id)
    }
  }
  // 剩下没被草稿覆盖的，保持原相对顺序附在末尾
  for (const section of sections) {
    if (byId.has(section.id)) ordered.push(section)
  }
  return ordered
}

export function useDragPreview() {
  /** 开始/更新预览：传 id 顺序 */
  function set(order: string[] | null): void {
    previewOrder.value = order
  }

  /** 结束预览：恢复成真实数据 */
  function clear(): void {
    previewOrder.value = null
  }

  /** 当前是否在拖动预览中 */
  const active = computed(() => previewOrder.value !== null)

  return { previewOrder, set, clear, active }
}
