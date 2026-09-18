<script setup>
/**
 * 模块列表。
 * 拖拽排序交给 vue-draggable-plus，带位移动画并支持触屏；
 * 每张卡片由 ModuleCard 承载，本组件只负责列表编排与新增。
 */
import { computed, ref, shallowRef } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

import ModuleCard from '@/components/editor/ModuleCard.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { SECTION_PRESETS, SECTION_TYPES } from '@/data/defaultResume'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

// 数组整体替换，用 ref；两个下拉框选项是字符串，用 shallowRef
const expandedIds = ref([])
const addingType = shallowRef('entries')
const presetKey = shallowRef('project')

const isOpen = (id) => expandedIds.value.includes(id)

const typeHint = computed(
  () => SECTION_TYPES.find((t) => t.value === addingType.value)?.hint || '',
)

const presetHint = computed(
  () => SECTION_PRESETS.find((p) => p.key === presetKey.value)?.desc || '',
)

function toggle(id) {
  expandedIds.value = isOpen(id)
    ? expandedIds.value.filter((item) => item !== id)
    : [...expandedIds.value, id]
}

function expand(id) {
  if (!isOpen(id)) expandedIds.value = [...expandedIds.value, id]
}

/** 删除模块：确认、清理展开状态、再改数据，避免留下悬空的展开项 */
function removeSection(section) {
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
  border-color: #2b579a;
  box-shadow: 0 6px 18px rgba(20, 30, 50, 0.16);
}
</style>
