<script setup lang="ts">
/**
 * 纸面就地编辑浮层。
 *
 * 点纸上的某段文字就地弹出一个输入框，改完回车 / 点别处即写回简历。
 * 位置上跟随被点的元素（见 useInlineEdit 的字段解析），
 * 因此模板怎么排版都不用为「编辑框该放哪儿」做适配。
 *
 * 为什么不做 contenteditable 直接改：
 *  - 纸面是按 --zoom 缩放渲染的（见 usePaperZoom），contenteditable 里的选区、
 *    光标与输入法候选框在缩放层里都会错位；
 *  - 纸上元素同时也是拖拽排序与框选多选的命中目标，两者会抢指针事件；
 *  - 渲染件是各模板的私有结构（<h1 class="name"> / <h2 class="r-title">），
 *    让它们全部变成表单控件会渗进每一个模板。
 * 浮层的代价是「编辑时离纸面稍远」，但换来的是所有模板自动可用。
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

import SvgIcon from '@/components/SvgIcon.vue'
import type { EditTarget } from '@/composables/useInlineEdit'

const props = defineProps<{
  /** 被编辑的字段；为 null 时浮层不显示 */
  target: EditTarget | null
  /** 锚点元素（被点的那个纸面元素） */
  anchor: HTMLElement | null
  /** 纸张根元素，用于限制浮层不越出纸张 */
  boundary: HTMLElement | null
}>()

const emit = defineEmits<{ close: [] }>()

const GAP = 8
const EDGE = 8

const draft = shallowRef('')
const inputRef = useTemplateRef('inputRef')
const boxRef = useTemplateRef('boxRef')
/** 浮层位置，未定位前置空以免闪一下 */
const pos = shallowRef<{ top: number; left: number } | null>(null)

/** 被编辑的字段（模板与键盘处理都用它，故在 watch 之前先定义） */
const target = computed(() => props.target)

/**
 * 定位前的落位方式用 class 而不是 style：
 * 位置是一个「有 top/left」或「只有 visibility」的联合，直接绑到 :style 上
 * Vue 的属性类型不接受这种联合（会报不可赋值），用 class 表达更干净。
 * 不用 v-if 隐藏：不渲染就拿不到浮层尺寸，也就算不出该放哪儿。
 */
const boxStyle = computed(() => {
  const at = pos.value
  return at ? { top: `${at.top}px`, left: `${at.left}px` } : {}
})

/**
 * 定位：优先贴在元素下方，下方放不下则翻到上方；
 * 水平居中于元素，并夹在纸张范围内。
 */
function place() {
  const anchor = props.anchor
  const box = boxRef.value
  if (!anchor || !box) return

  const rect = anchor.getBoundingClientRect()
  const size = box.getBoundingClientRect()
  const bounds = props.boundary?.getBoundingClientRect()

  let top = rect.bottom + GAP
  if (top + size.height > window.innerHeight - EDGE) {
    top = rect.top - size.height - GAP
  }
  top = Math.max(EDGE, Math.min(top, window.innerHeight - size.height - EDGE))

  let left = rect.left + rect.width / 2 - size.width / 2
  const minLeft = bounds ? bounds.left + EDGE : EDGE
  const maxLeft = bounds ? bounds.right - size.width - EDGE : window.innerWidth - size.width - EDGE
  // 纸张比浮层还窄时（小屏缩放后）夹取会反转，此时以纸张左边界为准
  left = maxLeft < minLeft ? minLeft : Math.max(minLeft, Math.min(left, maxLeft))

  pos.value = { top, left }
}

/** 打开时填值、定位、聚焦并全选（改的是已有内容，全选最省事） */
async function sync() {
  if (!props.target) {
    pos.value = null
    return
  }
  draft.value = props.target.value
  pos.value = null
  await nextTick()
  place()
  const input = inputRef.value
  input?.focus()
  input?.select?.()
}

/**
 * 目标变化时才重新填值与定位。
 * 用 watch 而不是只在挂载时同步：同一个浮层会被复用于不同字段 ——
 * 用户改完一处直接点另一处文字时，浮层并不重新创建。
 */
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

function commit() {
  const target = props.target
  if (!target) return
  // 值没变就不写回：避免给撤销历史塞一条空记录
  if (draft.value !== target.value) target.commit(draft.value)
  emit('close')
}

function cancel() {
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  if (event.key !== 'Enter') return
  // 多行框里回车要能换行（提示文案也写的是 Ctrl+Enter 保存）
  if (target.value?.kind === 'multiline' && !event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  commit()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="target" class="ie-layer" @click.self="commit">
      <div
        ref="boxRef"
        class="ie-box"
        :class="{ 'is-placing': !pos }"
        :style="boxStyle"
        role="dialog"
        :aria-label="target.label"
      >
        <div class="ie-head">
          <span class="ie-title">{{ target.label }}</span>
          <button class="ie-close" title="取消（Esc）" aria-label="取消" @click="cancel">
            <SvgIcon name="close" :size="12" />
          </button>
        </div>

        <textarea
          v-if="target.kind === 'multiline'"
          ref="inputRef"
          v-model="draft"
          class="ie-input ie-textarea"
          rows="3"
          @keydown="onKeydown"
        ></textarea>
        <input
          v-else
          ref="inputRef"
          v-model="draft"
          class="ie-input"
          :type="target.kind === 'number' ? 'number' : 'text'"
          :min="target.kind === 'number' ? 0 : undefined"
          :max="target.kind === 'number' ? 100 : undefined"
          @keydown="onKeydown"
        />

        <div class="ie-actions">
          <span class="ie-tip">
            {{ target.kind === 'multiline' ? 'Ctrl+Enter 保存' : '回车保存' }} · Esc 取消
          </span>
          <button class="ie-btn" @click="cancel">取消</button>
          <button class="ie-btn ie-btn-primary" @click="commit">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 透明遮罩：接住「点别处即保存」，同时挡住下层纸面的点击与拖拽 */
.ie-layer {
  position: fixed;
  inset: 0;
  z-index: 96;
}

.ie-box {
  position: fixed;
  width: 280px;
  padding: 10px 12px 8px;
  border: 1px solid var(--ed-line-2);
  border-radius: 10px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
}

/* 尚未算出位置：占位但不可见，据此测出真实尺寸再定位 */
.ie-box.is-placing {
  visibility: hidden;
}

.ie-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}

.ie-title {
  color: var(--ed-text-2);
  font-size: 12px;
  font-weight: 600;
}

.ie-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--ed-text-4);
  cursor: pointer;
}

.ie-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.ie-input {
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--ed-line-2);
  border-radius: 8px;
  background: var(--ed-surface);
  color: var(--ed-ink);
  font: inherit;
  font-size: 13px;
}

.ie-input:focus {
  border-color: var(--ed-brand);
  outline: none;
  box-shadow: 0 0 0 3px var(--ed-brand-ring);
}

.ie-textarea {
  min-height: 58px;
  line-height: 1.6;
  resize: vertical;
}

.ie-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}

.ie-tip {
  flex: 1 1 auto;
  color: var(--ed-text-4);
  font-size: 11px;
}

.ie-btn {
  padding: 4px 9px;
  border: 1px solid var(--ed-line-2);
  border-radius: 7px;
  background: var(--ed-surface);
  color: var(--ed-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ie-btn:hover {
  background: var(--ed-fill);
}

.ie-btn-primary {
  border-color: var(--ed-brand-strong);
  background: var(--ed-brand);
  color: #fff;
}

.ie-btn-primary:hover {
  background: var(--ed-brand-deep);
}
</style>
