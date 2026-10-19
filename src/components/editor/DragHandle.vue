<script setup lang="ts">
/**
 * 拖拽手柄：列表里每一项左侧那个抓手。
 *
 * 为什么单独做成组件：项目里原本每处都手写一遍
 * `<span class="ed-drag" title="..."><SvgIcon name="drag" /></span>`，
 * 且**全部是鼠标专属** —— 键盘用户没有任何办法调整顺序。
 *
 * 这里把手柄收成一处，并补上键盘等价操作：
 *   - 方向键上/下把当前项上移/下移一位（与拖拽同一条路径，最终都走 reorder）；
 *   - role="button" + aria-label 让读屏能念出它是什么、能做什么。
 *
 * 代价是每个手柄多一个 Tab 停靠点。这是有意的取舍：
 * 另一种做法是每项再加「上移/下移」两个按钮（经历条目现在就是这样），
 * 但要点动辄十条，那样会把面板塞满图标按钮。直接操作更贴近拖拽本身。
 */
import { computed, nextTick } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 当前项在列表中的位置（从 0 开始） */
    index: number
    /**
     * 该项的 id。键盘重排后靠它把焦点找回来 ——
     * 重排会让 store 换掉整个数组，Vue 重新渲染后原来的 DOM 节点可能已被替换，
     * 焦点会掉回 body（实测：按一次方向键后 activeElement 变成 BODY），
     * 于是连按方向键必须先重新 Tab 一次，键盘操作基本不可用。
     */
    itemId: string
    /** 列表总长，用于说明边界与 aria 描述 */
    total: number
    /** 无障碍名称。默认按位置生成 */
    label?: string
    /**
     * 手柄的类名。SortableJS 靠它识别「按住这里才算拖拽」。
     *
     * 必须能区分层级：要点 / 标签列表是**嵌套在条目列表内部**的，
     * 若两层都用 .ed-drag，外层那个 Sortable 会把内层手柄也认成自己的，
     * 于是拖要点会变成拖整段经历。所以内层用 .ed-drag-sub。
     */
    handleClass?: string
  }>(),
  { label: '', handleClass: 'ed-drag' },
)

/** 让验证与焦点恢复都能按项 id 精确定位到这个手柄 */
const dragFor = computed(() => props.itemId)

const emit = defineEmits<{
  /** 请求把第 from 项移到第 to 项 */
  move: [from: number, to: number]
}>()

const ariaLabel = computed(
  () => props.label || `第 ${props.index + 1} 项，共 ${props.total} 项。拖动或用上下方向键调整顺序`,
)

async function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') {
    if (props.index === 0) return
    emit('move', props.index, props.index - 1)
  } else if (event.key === 'ArrowDown') {
    if (props.index >= props.total - 1) return
    emit('move', props.index, props.index + 1)
  } else {
    return
  }
  // 阻止方向键滚动面板：这里的方向键是「调整顺序」，不是「滚动」
  event.preventDefault()

  /*
   * 把焦点找回来。重排会换掉整个数组，重渲染后当前节点可能已不是原来那个，
   * 焦点会掉回 body。等 DOM 补丁完成，再按项 id 找回来 ——
   * 按 id 而不是按引用，正是为了应对「节点被替换」这种情况。
   */
  await nextTick()
  const el = document.querySelector(`[data-drag-for="${CSS.escape(props.itemId)}"]`)
  if (el instanceof HTMLElement) el.focus()
}
</script>

<template>
  <span
    :class="handleClass"
    role="button"
    tabindex="0"
    :data-drag-for="dragFor"
    :aria-label="ariaLabel"
    :title="ariaLabel"
    @keydown="onKeydown"
  >
    <SvgIcon name="drag" :size="14" />
  </span>
</template>
