<script setup lang="ts">
/**
 * 模块编辑器调度器。
 * 只做两件事：渲染位置面板，并按模块 type 选中对应的分段编辑器，
 * 具体表单由 components/editor/sections 下的子组件承载。
 *
 * layoutOpen 由 ModuleCard 透传：卡片头部的「布局」按钮要能直接打开位置面板。
 */
import { computed } from 'vue'

import EntriesSectionEditor from '@/components/editor/sections/EntriesSectionEditor.vue'
import GridSectionEditor from '@/components/editor/sections/GridSectionEditor.vue'
import SectionLayoutPanel from '@/components/editor/sections/SectionLayoutPanel.vue'
import SkillsSectionEditor from '@/components/editor/sections/SkillsSectionEditor.vue'
import TextSectionEditor from '@/components/editor/sections/TextSectionEditor.vue'
import type { Section, SectionType } from '@/types/resume'

const props = defineProps<{ section: Section; layoutOpen: boolean }>()
const emit = defineEmits<{ 'update:layoutOpen': [value: boolean] }>()

/** 模块类型 → 编辑器组件 */
const EDITORS: Record<SectionType, unknown> = {
  grid: GridSectionEditor,
  entries: EntriesSectionEditor,
  skills: SkillsSectionEditor,
  text: TextSectionEditor,
}

const editorComponent = computed(() => EDITORS[props.section.type] || TextSectionEditor)
</script>

<template>
  <div class="section-editor">
    <SectionLayoutPanel
      :section="section"
      :open="layoutOpen"
      @update:open="emit('update:layoutOpen', $event)"
    />
    <component :is="editorComponent" :section="section" />
  </div>
</template>

<style scoped>
.section-editor {
  display: block;
}
</style>
