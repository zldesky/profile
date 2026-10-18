<script setup lang="ts">
/**
 * 模块列表。
 * 拖拽排序交给 vue-draggable-plus，带位移动画并支持触屏；
 * 每张卡片由 ModuleCard 承载，本组件只负责列表编排与新增。
 */
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

import ModuleCard from '@/components/editor/ModuleCard.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { usePaperJump } from '@/composables/usePaperJump'
import { SECTION_PRESETS, SECTION_TYPES } from '@/data/defaultResume'
import { useResumeStore } from '@/stores/resume'
import type { Section, SectionType } from '@/types/resume'

const store = useResumeStore()

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

/** 删除模块：确认、清理展开状态、再改数据，避免留下悬空的展开项 */
function removeSection(section: Section) {
  if (!window.confirm(`确定删除模块「${section.title}」？该模块内容将一并移除。`)) return
  expandedIds.value = expandedIds.value.filter((item) => item !== section.id)
  store.removeSection(section.id)
}

/** 按常用模块预设新增，并自动展开便于继续填写 */
function addFromPreset() {
  expand(store.addSectionFromPreset(presetKey.value))
}

function addSection() {
  expand(store.addSection(addingType.value))
}

/** 卡片上闪一下的描边（跳转落点提示），动画结束即摘掉以便再次触发 */
const flashId = shallowRef('')
let flashTimer: ReturnType<typeof setTimeout> | null = null

const { targetId, requestSeq, consume } = usePaperJump()

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

    <VueDraggable
      v-model="store.resume.sections"
      class="ed-card-list"
      :animation="160"
      handle=".ed-drag"
      ghost-class="ed-ghost"
      chosen-class="ed-chosen"
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
    </VueDraggable>

    <div class="ed-add-row">
      <select v-model="presetKey" class="ed-select">
        <option v-for="preset in SECTION_PRESETS" :key="preset.key" :value="preset.key">
          {{ preset.title }}
        </option>
      </select>
      <button class="ed-btn ed-btn-primary" @click="addFromPreset">
        <SvgIcon name="plus" :size="14" />
        <span>添加</span>
      </button>
    </div>
    <p class="ed-hint">{{ presetHint }}</p>

    <div class="ed-add-row">
      <select v-model="addingType" class="ed-select">
        <option v-for="type in SECTION_TYPES" :key="type.value" :value="type.value">
          自定义：{{ type.label }}
        </option>
      </select>
      <button class="ed-btn" @click="addSection">
        <SvgIcon name="plus" :size="14" />
        <span>添加空白模块</span>
      </button>
    </div>
    <p class="ed-hint">{{ typeHint }}</p>
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
