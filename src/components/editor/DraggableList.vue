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
 */
import { computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

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

const emit = defineEmits<{
  /** 新顺序的 id 列表 */
  reorder: [ids: string[]]
}>()

/**
 * 交给 VueDraggable 的数组用浅拷贝。
 * 一来避免它就地改写 prop（那是 Vue 的反模式，也会让数据与来源脱节），
 * 二来拖完我们只关心「新顺序是什么」，具体数组由 store 的动作重建。
 */
const source = computed(() => props.items.slice())

function onUpdate(next: Identified[] | undefined): void {
  if (!Array.isArray(next) || next.length !== props.items.length) return
  emit(
    'reorder',
    next.map((item) => item.id),
  )
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
    ghost-class="ed-ghost"
    chosen-class="ed-chosen"
    @update:model-value="onUpdate"
  >
    <!-- move 通过插槽交给调用方，好让 DragHandle 的键盘操作能接到同一条重排路径上 -->
    <slot :move="move" />
  </VueDraggable>
</template>
