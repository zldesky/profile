<script setup lang="ts">
/**
 * 模块的位置与对齐设置，对所有模块类型生效。
 * 只负责布局项，不涉及模块内容。
 *
 * 展开状态由外层受控：卡片头部新增了「布局」按钮，点它要能直接打开这里。
 * 早先是组件内部自管的 shallowRef，那样头部的按钮够不着它 —— 用户得先展开卡片、
 * 再找一遍「位置与对齐」才能调间距。
 */
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { DEFAULT_SECTION_LAYOUT } from '@/data/defaultResume'
import { SECTION_ALIGN_OPTIONS, SECTION_COLUMN_OPTIONS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'
import type { Section } from '@/types/resume'

const props = defineProps<{ section: Section; open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const store = useResumeStore()

/** 补齐历史数据缺失的布局项 */
const layout = computed(() => ({ ...DEFAULT_SECTION_LAYOUT, ...(props.section.layout || {}) }))

/** 列数只对键值网格与技能进度条有意义 */
const showColumns = computed(() => ['grid', 'skills'].includes(props.section.type))

/**
 * 四个方向的间距滑杆。
 *
 * 上下两个方向的范围比左右更宽（-12~48 对 -24~48 之外还多留了上提余量），
 * 因为垂直方向常用来把模块压紧到一页里；左右主要是对准视觉轴线，
 * 负值只用于抵消主题自带的缩进。范围与 server/sanitize.ts 的
 * LAYOUT_RANGE 一致 —— 越界会被服务端静默钳制，所以这边不能给更大的范围。
 */
const SPACING_FIELDS = [
  { key: 'extraGap', label: '上方', min: -12, max: 48 },
  { key: 'extraGapBottom', label: '下方', min: -12, max: 48 },
  { key: 'indent', label: '左侧', min: -24, max: 48 },
  { key: 'indentRight', label: '右侧', min: -24, max: 48 },
] as const

function setLayout(patch: Record<string, unknown>): void {
  store.updateSectionLayout(props.section.id, patch)
}

function resetLayout() {
  store.updateSectionLayout(props.section.id, { ...DEFAULT_SECTION_LAYOUT })
}
</script>

<template>
  <div class="layout-panel">
    <button class="ed-btn ed-btn-block layout-toggle" @click="emit('update:open', !props.open)">
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

      <div class="seg-caption">间距</div>
      <label v-for="field in SPACING_FIELDS" :key="field.key" class="ed-row">
        <span class="ed-label">{{ field.label }}</span>
        <input
          class="ed-range"
          type="range"
          :min="field.min"
          :max="field.max"
          step="1"
          :value="layout[field.key]"
          @input="setLayout({ [field.key]: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="ed-value">{{ layout[field.key] }}px</span>
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
        四个方向的间距都按像素微调：上下用来把模块压紧或撑开（负值为收拢），左右用来对准相邻内容的视觉轴线。列数为「自适应」时按可用宽度自动排布，空列会自动收拢。
      </p>

      <button class="ed-btn ed-btn-block" @click="resetLayout">恢复默认位置</button>
    </div>
  </div>
</template>

<style scoped>
.layout-panel {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--ed-fill-3);
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
