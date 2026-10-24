<script setup lang="ts">
/**
 * 可拖拽排序的列表。
 *
 * 把原先散在 5 处的同一套写法收成一处：
 *   - `VueDraggable` + `handle=".ed-drag"` + `:animation="160"` + ghost/chosen 类；
 *   - 拖完把新顺序换算成 id 数组（而不是各自写一遍 computed get/set）。
 *
 * 为什么按 id 而不是按下标：拖拽组件天然给出「新的整个数组」，
 * 反推 from/to 需要额外比对；而 store 侧统一收 `reorderXByIds`，
 * 校验「传入顺序必须是现有 id 的一个排列」，残缺数组会被安静忽略
 * （拖拽组件在增删的中间态偶尔会给出不完整的数组，那时宁可不换序）。
 *
 * 根元素固定带 `dl-list` 类（调用方的 class 会与它合并）。这不只是样式钩子：
 * 嵌套列表里「某个手柄属于哪一层」需要精确判定，靠 `closest('.dl-list')` 就能拿到
 * 最近的列表容器 —— 而各层自己传的类名（.entry-list / .ed-sub-list）并不统一，
 * 内层甚至没有类名。验证脚本与将来的工具都依赖这一点。
 *
 * **不直接 v-model 到传入的数组**：那是 prop，往它的属性上赋值会被 Vue 拦下 ——
 * 拖完 SortableJS 改过 DOM、数据却没变，Vue 重渲染时顺序**回弹**，
 * 看起来像「拖拽没生效」，实际是写回被吞了。这里改用一份浅拷贝承接，
 * 再把 id 顺序交给调用方（通常是 store 的 reorder 动作）。
 *
 * **拖动过程中的实时预览**（`sort` / `change` 事件）：
 * 只把「当前草稿顺序」emit 出去供别处预览，**不写 store**。
 * 原因见 DragHandle / SectionList 的注释：写 store 会污染撤销历史、
 * 触发自动保存与云端推送 —— 拖一次要按几十次撤销键才能退回去。
 */
import { computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { SortableEvent } from 'vue-draggable-plus'

import { useMediaQuery } from '@/composables/useMediaQuery'

/** 至少要有 id —— 顺序是按 id 传递的 */
interface Identified {
  id: string
}

const props = withDefaults(
  defineProps<{
    /** 当前列表内容（只读使用，组件不会改它） */
    items: Identified[]
    /** 拖拽手柄的选择器。默认 `.ed-drag`，与 DragHandle 组件一致 */
    handle?: string
    /** 位移动画时长（ms） */
    animation?: number
  }>(),
  { handle: '.ed-drag', animation: 160 },
)

/**
 * 触屏上必须「按住一会儿」才开始拖。
 *
 * 起因是一个真实的移动端体验问题：手指按在手柄上想上下滑页面，
 * SortableJS 立刻把它当成拖拽，页面不滚、卡片跟着手指跑。
 * 桌面端没有这个问题（鼠标本来就要「按住再拖」），所以只对触屏生效。
 *
 * 250ms 是取舍：太短（<150ms）与轻扫滚动难以区分；太长（>400ms）会让人觉得卡。
 * `touchStartThreshold: 3` 允许手指轻微抖动而不会取消长按。
 * `delayOnTouchOnly` 保证鼠标拖拽立刻响应 —— 桌面上多等 250ms 就是迟钝。
 */
const isTouch = useMediaQuery('(hover: none), (pointer: coarse)')
const dragOptions = computed(() =>
  isTouch.value
    ? {
        delay: 250,
        delayOnTouchOnly: true,
        touchStartThreshold: 3,
        // 长按期间不允许页面滚动，否则会把拖拽手势抢走
        preventOnFilter: false,
      }
    : {},
)

const emit = defineEmits<{
  /** 新顺序的 id 列表（松手后，调用方应落盘） */
  reorder: [ids: string[]]
  /**
   * 拖动过程中的草稿顺序（每秒可能数十次）。
   * 只用来看，不要在这里落盘。
   */
  preview: [ids: string[] | null]
}>()

/**
 * 交给 VueDraggable 的数组用浅拷贝。
 * 一来避免它就地改写 prop（那是 Vue 的反模式，也会让数据与来源脱节），
 * 二来拖完我们只关心「新顺序是什么」，具体数组由 store 的动作重建。
 */
const source = computed(() => props.items.slice())

function idsOf(list: unknown): string[] | null {
  if (!Array.isArray(list) || list.length !== props.items.length) return null
  const ids = list.map((item) => (item as Identified)?.id)
  return ids.every((id) => typeof id === 'string') ? ids : null
}

function onUpdate(next: Identified[] | undefined): void {
  const ids = idsOf(next)
  if (ids) emit('reorder', ids)
}

/**
 * 读「DOM 上当前的模块顺序」。
 *
 * 数据来源是 **SortableEvent.to** —— 它就是当前拖拽所在的列表 DOM 元素，
 * Sortable 在拖动过程中已经把节点挪好了，每个卡片都带 `data-section-id`。
 * 按 DOM 顺序读出 id 即可，既不用推算 oldIndex/newIndex，也不会因事件载荷变化失效。
 *
 * 两个踩过的坑，别再犯：
 *  1. **不能读组件 ref**：`useTemplateRef` 拿到的是 `useDraggable` 暴露的 API 对象
 *     （{ start, pause, option, ... }），不是元素 —— 取 `.children` 会抛
 *     `TypeError: root.children is not iterable`，而事件处理器里的异常会被 Vue
 *     吞掉、只留一条控制台错误，表现为「预览毫无反应」。
 *  2. **不能加外层包裹 div**：`.dl-list` 是 `DraggableList` 的对外契约
 *     （`tests/testing.md` 与验证脚本靠它判定「手柄属于哪一层」），
 *     多包一层会改变 `closest('.dl-list')` 的结果。
 */
function readDomOrder(target: unknown): string[] | null {
  const root = target instanceof HTMLElement ? target : null
  if (!root) return null
  const ids = [...root.children]
    .map((el) => (el as HTMLElement).dataset.sectionId)
    .filter((id): id is string => typeof id === 'string' && id !== '')
  return ids.length === props.items.length ? ids : null
}

/*
 * 拖动中：把草稿顺序交给调用方做实时预览。
 *
 * 用 `change` 而不是 `move`：
 *  - `move` 的载荷是 `MoveEvent`，**没有 `to`**（它只用来「拦截是否允许移动」），
 *    拿不到列表 DOM，也不该用来做副作用；
 *  - `change` 的载荷是 `SortableEvent`，带 `to`（当前列表元素），
 *    且只在「插入位置真的变了」时触发 —— 频率天然被限制在落点变化上，
 *    不会每移动一像素就重渲染一次纸面，正好够顺滑。
 * 真正的重排（写 store）仍然只在松手的 `update` 里发生，频率只有一次。
 */
function onDraft(event: SortableEvent): void {
  emit('preview', readDomOrder(event?.to))
}

/** 拖动结束：清掉预览，顺序已由 onUpdate 落盘 */
function onEnd(): void {
  emit('preview', null)
}

/**
 * 把第 from 项移到第 to 项，供键盘操作用。
 * 与拖拽走同一条出口（emit reorder），所以两种操作的行为与撤销 / 落盘完全一致。
 */
function move(from: number, to: number): void {
  const ids = props.items.map((item) => item.id)
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return
  const [moved] = ids.splice(from, 1)
  ids.splice(to, 0, moved)
  emit('reorder', ids)
}
</script>

<template>
  <VueDraggable
    class="dl-list"
    :model-value="source"
    :animation="animation"
    :handle="handle"
    v-bind="dragOptions"
    ghost-class="ed-ghost"
    chosen-class="ed-chosen"
    @update:model-value="onUpdate"
    @change="onDraft"
    @end="onEnd"
  >
    <!-- move 通过插槽交给调用方，好让 DragHandle 的键盘操作能接到同一条重排路径上 -->
    <slot :move="move" />
  </VueDraggable>
</template>
