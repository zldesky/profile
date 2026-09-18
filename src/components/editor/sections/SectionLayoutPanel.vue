<script setup>
/**
 * 模块的位置与对齐设置，对所有模块类型生效。
 * 只负责布局项，不涉及模块内容。
 */
import { computed, shallowRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { DEFAULT_SECTION_LAYOUT } from '@/data/defaultResume'
import { SECTION_ALIGN_OPTIONS, SECTION_COLUMN_OPTIONS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const props = defineProps({
  section: { type: Object, required: true },
})

const store = useResumeStore()
const open = shallowRef(false)

/** 补齐历史数据缺失的布局项 */
const layout = computed(() => ({ ...DEFAULT_SECTION_LAYOUT, ...(props.section.layout || {}) }))

/** 列数只对键值网格与技能进度条有意义 */
const showColumns = computed(() => ['grid', 'skills'].includes(props.section.type))

function setLayout(patch) {
  store.updateSectionLayout(props.section.id, patch)
}

function resetLayout() {
  store.updateSectionLayout(props.section.id, { ...DEFAULT_SECTION_LAYOUT })
}
</script>

<template>
  <div class="layout-panel">
    <button class="ed-btn ed-btn-block layout-toggle" @click="open = !open">
      <SvgIcon name="layout" :size="14" />
      <span>位置与对齐</span>
      <SvgIcon name="down" :size="13" class="caret" :class="{ 'is-open': open }" />
    </button>

    <div v-if="open" class="layout-body">
      <div class="seg-caption">内容对齐</div>
      <div class="ed-seg">
        <button
          v-for="option in SECTION_ALIGN_OPTIONS"
          :key="option.value"
          :class="{ 'is-active': layout.align === option.value }"
          @click="setLayout({ align: option.value })"
        >
          {{ option.label }}
        </button>
      </div>

      <label class="ed-row">
        <span class="ed-label">左缩进</span>
        <input
          class="ed-range"
          type="range"
          min="-24"
          max="48"
          step="1"
          :value="layout.indent"
          @input="setLayout({ indent: Number($event.target.value) })"
        />
        <span class="ed-value">{{ layout.indent }}px</span>
      </label>

      <label class="ed-row">
        <span class="ed-label">上方间距</span>
        <input
          class="ed-range"
          type="range"
          min="-12"
          max="48"
          step="1"
          :value="layout.extraGap"
          @input="setLayout({ extraGap: Number($event.target.value) })"
        />
        <span class="ed-value">{{ layout.extraGap }}px</span>
      </label>

      <template v-if="showColumns">
        <div class="seg-caption">列数</div>
        <div class="ed-seg">
          <button
            v-for="option in SECTION_COLUMN_OPTIONS"
            :key="option.value"
            :class="{ 'is-active': layout.columns === option.value }"
            @click="setLayout({ columns: option.value })"
          >
            {{ option.label }}
          </button>
        </div>
      </template>

      <p class="ed-hint">
        左缩进与上方间距按像素微调，用来把模块对准相邻内容的视觉轴线。列数为「自适应」时按可用宽度自动排布，空列会自动收拢。
      </p>

      <button class="ed-btn ed-btn-block" @click="resetLayout">恢复默认位置</button>
    </div>
  </div>
</template>

<style scoped>
.layout-panel {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #eef0f4;
}

.layout-toggle {
  justify-content: center;
}

.layout-toggle .caret {
  transition: transform 0.18s;
}

.layout-toggle .caret.is-open {
  transform: rotate(180deg);
}

.layout-body {
  margin-top: 10px;
}
</style>
