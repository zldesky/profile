<script setup lang="ts">
/**
 * 模块列表。
 * 拖拽排序交给 vue-draggable-plus，带位移动画并支持触屏；
 * 每张卡片由 ModuleCard 承载，本组件只负责列表编排与新增。
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import BaseSelect from '@/components/BaseSelect.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DraggableList from '@/components/editor/DraggableList.vue'
import ModuleCard from '@/components/editor/ModuleCard.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { usePaperJump } from '@/composables/usePaperJump'
import { useDragPreview } from '@/composables/useDragPreview'
import { useToast } from '@/composables/useToast'
import { SECTION_PRESETS, SECTION_TYPES } from '@/data/defaultResume'
import { useResumeStore } from '@/stores/resume'
import type { Section, SectionType } from '@/types/resume'

const store = useResumeStore()
const { toast } = useToast()

/*
 * 下拉选项。SECTION_PRESETS 用的是 { key, title }、SECTION_TYPES 用 { value, label }，
 * 而 BaseSelect 统一收 { value, label } —— 在调用点映射，而不是改动这些常量：
 * 它们还被别处使用（默认简历生成等），为了一次下拉去改公共数据形状得不偿失。
 */
const presetOptions = computed(() =>
  SECTION_PRESETS.map((preset) => ({ value: preset.key, label: preset.title })),
)
const typeOptions = computed(() =>
  SECTION_TYPES.map((type) => ({ value: type.value, label: `自定义：${type.label}` })),
)

// 数组整体替换，用 ref；两个下拉框选项是字符串，用 shallowRef
const expandedIds = ref<string[]>([])
const addingType = shallowRef<SectionType>('entries')
const presetKey = shallowRef('project')

const isOpen = (id: string) => expandedIds.value.includes(id)

const typeHint = computed(() => SECTION_TYPES.find((t) => t.value === addingType.value)?.hint || '')

const presetHint = computed(
  () => SECTION_PRESETS.find((p) => p.key === presetKey.value)?.desc || '',
)

function toggle(id: string) {
  expandedIds.value = isOpen(id)
    ? expandedIds.value.filter((item) => item !== id)
    : [...expandedIds.value, id]
}

function expand(id: string) {
  if (!isOpen(id)) expandedIds.value = [...expandedIds.value, id]
}

/**
 * 删除模块：确认、清理展开状态、再改数据，避免留下悬空的展开项。
 *
 * 用 ConfirmDialog 而不是 window.confirm：原生 confirm 无法样式化、
 * 在移动端是系统弹窗、且会被部分浏览器拦截；更重要的是它没法写「可撤销」这层信息 ——
 * 而本项目所有删除都能 Ctrl+Z。界面里混一种系统弹窗，也是最明显的「不像产品」的信号。
 */
const pendingRemove = shallowRef<Section | null>(null)

function removeSection(section: Section) {
  pendingRemove.value = section
}

function confirmRemove() {
  const section = pendingRemove.value
  pendingRemove.value = null
  if (!section) return
  expandedIds.value = expandedIds.value.filter((item) => item !== section.id)
  store.removeSection(section.id)
  toast('已删除该模块，Ctrl+Z 可撤销')
}

/**
 * 按常用模块预设新增，并自动展开、聚焦到第一个输入框。
 * 只展开不聚焦的话，用户还得自己找到该填哪儿 —— 新建之后立刻能打字才算顺手。
 */
async function addFromPreset() {
  expand(store.addSectionFromPreset(presetKey.value))
  await focusFirstEmptyInput()
}

async function addSection() {
  expand(store.addSection(addingType.value))
  await focusFirstEmptyInput()
}

/**
 * 把焦点放到最后一首张卡片里第一个空输入框。
 * 用 `nextTick` 之后查 DOM：卡片是 v-if 挂载的，同一 tick 里还不存在。
 */
async function focusFirstEmptyInput() {
  await nextTick()
  const cards = document.querySelectorAll('.ed-card')
  const card = cards[cards.length - 1]
  const input = card?.querySelector<HTMLInputElement>('input.ed-input')
  input?.focus()
}

/** 卡片上闪一下的描边（跳转落点提示），动画结束即摘掉以便再次触发 */
const flashId = shallowRef('')
let flashTimer: ReturnType<typeof setTimeout> | null = null

const { targetId, requestSeq, consume } = usePaperJump()

/*
 * 拖动模块时的纸面实时预览。
 *
 * 只把草稿顺序交给 useDragPreview 的纯内存状态，**不写 store** ——
 * 拖动中顺序每秒可能变十几次，若每次都写 store，会压满撤销栈、
 * 触发自动保存与云端推送（登录态下真的发请求）。
 * 松手由 DraggableList emit('reorder') 一次性落盘。
 */
const dragPreview = useDragPreview()
function onDragPreview(ids: string[] | null) {
  if (ids) dragPreview.set(ids)
  else dragPreview.clear()
}

/*
 * 卸载时务必清掉预览顺序：拖到一半切页签 / 关面板，DragableList 不会再 emit end，
 * 残留的草稿顺序会让纸面一直按一个不存在的顺序渲染。
 */
onBeforeUnmount(() => dragPreview.clear())

/**
 * 把卡片滚到可见位置。
 *
 * 卡片已经完整在视野里就**完全不动**，避免「明明看得见却猛跳一下」；
 * 否则居中，上下都留出上下文。
 *
 * 这里原来写的是 `scrollMode: 'if-needed'`，但那**不是标准属性**
 * （标准里只有 behavior / block / inline），浏览器直接忽略 ——
 * 也就是说注释承诺的「已在视野就不动」从来没有生效过，一直是无条件滚动。
 * 之所以很久没被发现：这个选项被忽略时**不报错也不警告**。
 * 迁 TS 时类型检查把它报了出来。现在自己判可见性，把承诺真正落实。
 */
function revealCard(id: string) {
  const el = document.querySelector(`.ed-card[data-section-id="${CSS.escape(id)}"]`)
  if (!el) return

  const rect = el.getBoundingClientRect()
  const fullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight
  if (!fullyVisible) {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }
  flashId.value = id
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashId.value = ''
  }, 700)
}

/*
 * 响应纸面点击。watch 的是 requestSeq 而不是 targetId：
 * 连点同一个模块时 id 不变，只有序号会变。
 */
watch(requestSeq, async () => {
  const id = targetId.value
  if (!id) return
  consume()
  // 模块可能已被删除；隐藏模块没有卡片，不跳
  const section = store.sections.find((item) => item.id === id)
  if (!section || !section.visible) return
  expand(id)
  await nextTick()
  revealCard(id)
})
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title">
      <span>简历模块</span>
      <span class="ed-count">{{ store.sections.length }} 个</span>
    </div>

    <div v-if="!store.sections.length" class="ed-empty">还没有模块，先在下方添加一个</div>

    <DraggableList
      :items="store.sections"
      class="ed-card-list"
      @reorder="(ids) => store.reorderSectionsByIds(ids)"
      @preview="onDragPreview"
    >
      <ModuleCard
        v-for="(section, index) in store.sections"
        :key="section.id"
        :section="section"
        :index="index"
        :total="store.sections.length"
        :open="isOpen(section.id)"
        :flash="flashId === section.id"
        @toggle="toggle(section.id)"
        @remove="removeSection(section)"
      />
    </DraggableList>

    <div class="ed-add-row">
      <BaseSelect v-model="presetKey" :options="presetOptions" />
      <button class="ed-btn ed-btn-primary" @click="addFromPreset">
        <SvgIcon name="plus" :size="14" />
        <span>添加</span>
      </button>
    </div>
    <p class="ed-hint">{{ presetHint }}</p>

    <div class="ed-add-row">
      <BaseSelect v-model="addingType" :options="typeOptions" />
      <button class="ed-btn" @click="addSection">
        <SvgIcon name="plus" :size="14" />
        <span>添加空白模块</span>
      </button>
    </div>
    <p class="ed-hint">{{ typeHint }}</p>

    <ConfirmDialog
      :open="!!pendingRemove"
      title="删除模块"
      :description="`「${pendingRemove?.title ?? ''}」里的内容会一并移除。删除后可用 Ctrl+Z 撤销。`"
      confirm-text="删除"
      danger
      @confirm="confirmRemove"
      @cancel="pendingRemove = null"
    />
  </div>
</template>

<style scoped>
.ed-card-list {
  display: block;
}

/* 拖拽过程中的占位与浮动卡片 */
.ed-ghost {
  opacity: 0.35;
  border-style: dashed;
}

.ed-chosen {
  border-color: var(--ed-brand);
  box-shadow: var(--ed-shadow-float);
}
</style>
