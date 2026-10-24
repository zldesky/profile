<script setup lang="ts">
/**
 * 纸面就地编辑。
 *
 * 点纸上的某段文字，**那段文字原地变成输入框**：无遮罩、无标题栏、无保存/取消按钮，
 * 看起来就是「这段字进入了可编辑状态」。回车或点别处即写回，Esc 放弃。
 *
 * 为什么仍然用一个浮层（而不是把模板元素变成 contenteditable）：
 *  - 纸上元素同时是**拖拽排序**与**框选多选**的命中目标，contenteditable 会与之抢指针；
 *  - 渲染件是各模板的私有结构（`<h1 class="r-name">` / `<h2 class="r-title">`），
 *    让它们全部变成表单控件会把可编辑逻辑渗进 12 个模板；
 *  - 浮层可以精确覆盖在被点元素上，所有模板自动可用。
 *
 * 关于纸面缩放：纸面用的是 CSS `zoom`（不是 `transform: scale`），
 * 输入框放在纸面内会**跟着一起缩放**，光标与输入法候选框跟随缩放、不会错位。
 * 所以本组件的字号与盒子尺寸都按锚点的**实际渲染尺寸**（getBoundingClientRect）
 * 反向补偿，缩放下视觉上也与被替换的文字一样大。
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'

import { BOLDABLE_FIELDS, type EditTarget } from '@/composables/useInlineEdit'
import { isRangeInsideBold, toggleBoldRange } from '@/utils/richText'

const props = defineProps<{
  /** 被编辑的字段；为 null 时不显示 */
  target: EditTarget | null
  /** 锚点元素（被点的那个纸面元素） */
  anchor: HTMLElement | null
  /** 纸张根元素，用于限制浮层不越出纸张 */
  boundary: HTMLElement | null
}>()

const emit = defineEmits<{ close: [] }>()

/** 浮层相对锚点的外扩量，让它正好盖住原文字又不切边 */
const PAD_X = 4
const PAD_Y = 2
/** 单行输入框的最小宽度，避免只改一个字时框窄到点不中 */
const MIN_WIDTH = 64

const draft = shallowRef('')
const inputRef = useTemplateRef('inputRef')
const boxRef = useTemplateRef('boxRef')
/** 浮层位置与尺寸，未定位前置空以免闪一下 */
const pos = shallowRef<{ top: number; left: number; width: number; height: number } | null>(null)
/** 字号（已按缩放补偿后的像素值） */
const fontSize = shallowRef<number | null>(null)

/**
 * 输入框内当前的文字选区（原始字符串坐标，与数据的下标一一对应）。
 * 非空时浮层上方浮出「加粗」按钮；null 表示没有选中。
 */
const selRange = shallowRef<{ start: number; end: number } | null>(null)

/** 当前字段是否支持行内加粗 —— 只收经 RichText 渲染的值类字段 */
const boldable = computed(() => BOLDABLE_FIELDS.has(props.target?.field ?? ''))

/** 选区是否已完全在粗体里：决定按钮是「加粗」还是「取消加粗」 */
const boldActive = computed(() => {
  const range = selRange.value
  if (!range) return false
  return isRangeInsideBold(draft.value, range.start, range.end)
})

function syncSelection(): void {
  const el = inputRef.value
  if (!el) return
  const { selectionStart, selectionEnd } = el
  selRange.value =
    selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart
      ? { start: selectionStart, end: selectionEnd }
      : null
}

/**
 * 对选区执行加粗/取消加粗，写回草稿并恢复选区。
 *
 * 按钮上用 `@mousedown.prevent` 保住输入框焦点（blur 会提交并关闭浮层），
 * 这里只需要改草稿、把 DOM 选区拨回切换后的位置即可。
 */
async function applyBold(): Promise<void> {
  const range = selRange.value
  const el = inputRef.value
  if (!range || !el) return
  const next = toggleBoldRange(draft.value, range.start, range.end)
  draft.value = next.text
  await nextTick()
  el.focus({ preventScroll: true })
  el.setSelectionRange(next.selectionStart, next.selectionEnd)
  syncSelection()
}

/**
 * 本次打开是否已经收尾（提交或取消）。
 *
 * 回车保存、失焦保存、Esc 取消可能在同一瞬间先后触发（回车会让输入框失焦，
 * 从而再触发一次 blur），重复提交会把同一笔改动压两次历史。
 */
let settled = false

const target = computed(() => props.target)

/** 输入框的提示语：按字段能力拼装，改能力清单时只动 BOLDABLE_FIELDS */
const inputTitle = computed(() => {
  const t = target.value
  if (!t) return ''
  const base =
    t.kind === 'multiline'
      ? `${t.label} · Ctrl+Enter 保存，Esc 取消`
      : `${t.label} · 回车保存，Esc 取消`
  return boldable.value ? `${base}；选中文字后 Ctrl+B 加粗` : base
})

const boxStyle = computed(() => {
  const at = pos.value
  if (!at) return {}
  return {
    top: `${at.top}px`,
    left: `${at.left}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
    fontSize: fontSize.value ? `${fontSize.value}px` : undefined,
  }
})

/**
 * 用锚点的**实际渲染矩形**决定浮层的位置与大小。
 *
 * 单行字段（姓名 / 年龄 / 岗位…）要贴着文字本身，不能用元素宽度：
 * 姓名所在的 `<h1>` 是块级元素，宽度占满整个页头，
 * 直接取 rect.width 会让输入框拉成整行 —— 看起来又像"弹了个框"，
 * 而不是"这两个字变成可编辑"。
 * 因此单行用 Range 量出**文字实际占的宽度**，再留一点余量。
 *
 * 多行字段（正文 / 要点）相反：要盖住整个段落块，所以取整块矩形。
 * 全部基于 getBoundingClientRect，因此纸面缩放（zoom<1）时自动得到正确的视觉尺寸。
 */
function place(): void {
  const anchor = props.anchor
  if (!anchor) return

  const rect = anchor.getBoundingClientRect()
  const multiline = target.value?.kind === 'multiline'

  // 单行：量文字本身（Range 比元素矩形准，块级元素会被父容器撑满）
  let textWidth = rect.width
  if (!multiline) {
    try {
      const range = document.createRange()
      range.selectNodeContents(anchor)
      const textRect = range.getBoundingClientRect()
      if (textRect.width > 0) textWidth = textRect.width
    } catch {
      /* 量不到就用元素宽度兜底 */
    }
  }

  const width = multiline ? Math.max(rect.width, 120) : Math.max(textWidth + 12, MIN_WIDTH)
  const height = multiline ? Math.max(rect.height, 28) : Math.max(rect.height, 22)

  let left = rect.left - PAD_X
  let top = rect.top - PAD_Y

  // 夹在纸张范围内，避免浮层伸到纸外（窄屏缩放后纸张可能比输入框还窄）
  const bounds = props.boundary?.getBoundingClientRect()
  if (bounds) {
    left = Math.max(bounds.left, Math.min(left, bounds.right - width))
    top = Math.max(bounds.top, Math.min(top, bounds.bottom - height))
  }
  // 再夹一次视口，防止纸面滚出屏幕时浮层跑到看不见的地方
  left = Math.max(0, Math.min(left, window.innerWidth - width))
  top = Math.max(0, Math.min(top, window.innerHeight - height))

  // 字号取锚点的计算字号 —— 它是 zoom 之前的值，浏览器再按 zoom 缩小，
  // 视觉大小正好与原文字一致（实测 zoom=0.78 下渲染高度与原文字相符）
  //
  // 已知取舍：手机上纸面缩得很小（390 宽实测 46%），这里算出的字号可能低于
  // 16px，iOS 聚焦时会放大整个视口。不做「最低 16px」的钳制 —— 那会让输入框
  // 明显大于被替换的文字，浮层与锚点错位；手机上的主要编辑路径是右侧面板
  // （其输入控件全部 ≥16px），纸面就地编辑是次要用路。
  const computedFont = parseFloat(getComputedStyle(anchor).fontSize)
  fontSize.value = Number.isFinite(computedFont) && computedFont > 0 ? computedFont : null

  pos.value = { top, left, width, height }
}

/**
 * 打开时填值、定位、聚焦并全选（改的是已有内容，全选最省事）。
 *
 * 焦点为什么要在**两帧之后**再确认一次：
 * 纸面的 pointerdown 里调了 `event.preventDefault()`（阻止原生文字选择），
 * 它同时也阻止了浏览器「按下即聚焦」的默认行为，所以浮层的 input 挂上来后
 * 焦点会落在 BODY 上。`nextTick` 只保证 DOM 补丁完成，不保证 Teleport
 * 已经把节点插进 body，因此这里用 rAF 再等一帧，并在焦点仍然不在输入框时补一次。
 */
async function sync(): Promise<void> {
  if (!props.target) {
    pos.value = null
    return
  }
  // 新目标 / 重新打开：允许本轮的提交或取消
  settled = false
  draft.value = props.target.value
  selRange.value = null
  pos.value = null
  await nextTick()
  place()

  const focusInput = (): void => {
    const input = inputRef.value
    if (!input) return
    input.focus({ preventScroll: true })
    input.select?.()
  }

  focusInput()
  // 下一帧再兜一次：等 Teleport 节点真正入 body、且 pointerdown 的默认行为彻底结束
  requestAnimationFrame(() => {
    if (!inputRef.value) return
    if (document.activeElement === inputRef.value) return
    focusInput()
  })
}

const stopWatch = watch([() => props.target, () => props.anchor], sync, { immediate: true })

onMounted(() => {
  // 缩放、滚动、窗口变化都会让锚点位移，浮层要跟着走
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
})

onBeforeUnmount(() => {
  stopWatch()
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
})

/**
 * 每次打开只允许收尾一次。
 */
function commit(): void {
  if (settled) return
  settled = true
  const t = props.target
  if (!t) return
  // 值没变就不写回：避免给撤销历史塞一条空记录
  if (draft.value !== t.value) t.commit(draft.value)
  emit('close')
}

function cancel(): void {
  if (settled) return
  settled = true
  emit('close')
}

/*
 * 供父级在「按到纸面别处」时主动收尾。
 *
 * 为什么需要它：纸面 pointerdown 的 preventDefault 会阻止焦点转移，
 * 输入框**不会失焦**，blur 永远不触发 —— 只靠 @blur 收尾会静默丢改动。
 * 父级在按下那一刻调这个方法，先把草稿写回，再关浮层。
 */
defineExpose({ commitNow: () => commit() })

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  // Ctrl/Cmd+B：切换选区的加粗（与浮出的 B 按钮同一份逻辑）
  if (
    boldable.value &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 'b'
  ) {
    event.preventDefault()
    void applyBold()
    return
  }
  // 多行框里回车换行，Ctrl/Cmd+Enter 才保存；单行框直接回车保存
  if (event.key !== 'Enter') return
  if (target.value?.kind === 'multiline' && !event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  commit()
}

/**
 * 失焦即保存。
 *
 * 没有遮罩之后，「点别处」不会经过某个 layer 的 click，只能靠 blur 收尾。
 *
 * **必须在 blur 事件里同步提交，不要放进 setTimeout。** 原先这里用
 * `setTimeout(() => { if (!inputRef.value) return; commit() })`，而点击空白处时
 * 纸面的 pointerdown 会先一步 `closeInlineEdit()` 把浮层卸载，等定时器跑起来
 * `inputRef.value` 已是 null，于是 `return` 掉了 —— **改的内容静默丢失**。
 * 现在直接调 commit()，它只依赖 `props.target` 与 `draft`，不依赖 DOM 是否还在。
 */
function onBlur(): void {
  commit()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="target"
      ref="boxRef"
      class="ie-box"
      :class="{ 'is-placing': !pos }"
      :style="boxStyle"
    >
      <textarea
        v-if="target.kind === 'multiline'"
        ref="inputRef"
        v-model="draft"
        class="ie-input ie-textarea"
        :aria-label="target.label"
        :title="inputTitle"
        @keydown="onKeydown"
        @blur="onBlur"
        @select="syncSelection"
        @keyup="syncSelection"
        @mouseup="syncSelection"
      ></textarea>
      <input
        v-else
        ref="inputRef"
        v-model="draft"
        class="ie-input"
        type="text"
        :aria-label="target.label"
        :title="inputTitle"
        @keydown="onKeydown"
        @blur="onBlur"
        @select="syncSelection"
        @keyup="syncSelection"
        @mouseup="syncSelection"
      />
      <!--
        选区加粗按钮：只在「有选中且字段支持」时出现。
        mousedown.prevent 是关键 —— 否则点按钮会让输入框失焦，
        blur 先一步提交并关闭浮层，加粗就没机会执行了。
      -->
      <button
        v-if="boldable && selRange"
        type="button"
        class="ie-bold no-print"
        :aria-label="boldActive ? '取消加粗' : '加粗'"
        :title="boldActive ? '取消加粗（Ctrl+B）' : '加粗（Ctrl+B）'"
        @mousedown.prevent
        @click="applyBold"
      >
        B
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * 浮层 = 一枚「贴着原文字」的输入框。
 * 没有遮罩、没有标题栏、没有按钮：视觉上就是这段字进入了编辑态。
 * 用 accent 描边 + 轻微提亮，明确「这里正在编辑」，但不弹窗、不打断视线。
 */
.ie-box {
  position: fixed;
  z-index: 96;
  box-sizing: border-box;
}

/* 尚未算出位置：占位但不可见，据此测出真实尺寸 */
.ie-box.is-placing {
  visibility: hidden;
}

.ie-input {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 0 2px;
  border: 1px solid var(--accent, #2563eb);
  border-radius: 2px;
  background: #fff;
  color: inherit;
  font: inherit;
  font-size: inherit;
  line-height: 1.4;
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #2563eb) 18%, transparent);
}

/* 多行：允许在框内滚动，不撑破纸张 */
.ie-textarea {
  min-height: 28px;
  padding: 1px 2px;
  line-height: inherit;
  resize: none;
  overflow: auto;
}

.ie-textarea:focus,
.ie-input:focus {
  border-color: var(--accent, #2563eb);
}

/*
 * 选区加粗按钮：浮在编辑框**下方右侧**。上方是字段微调提示条（FieldNudgeHint），
 * 放上面会与它叠在一行；下方只在就地编辑期间出现，压住下一行文字是可接受的瞬时态。
 * 24px 高与全站最小点击目标一致（audit-ui 的达标线），描边与阴影取界面令牌。
 */
.ie-bold {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--ed-line-2, #d0d5dd);
  border-radius: var(--ed-radius-sm, 6px);
  background: var(--ed-surface, #fff);
  color: var(--ed-ink, #101828);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--ed-shadow-sm, 0 1px 3px rgba(16, 24, 40, 0.1));
}

.ie-bold:hover {
  background: var(--ed-fill-2, #f9fafb);
}
</style>
