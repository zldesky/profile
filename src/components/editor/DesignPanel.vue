<script setup>
/**
 * 设计页签。
 * 只做组合：模板、配色、排版、标题四个分区各自独立成组件，
 * 用单一根容器包裹以便父级用 v-show 切换。
 */
import ColorSection from '@/components/editor/design/ColorSection.vue'
import TemplatePicker from '@/components/editor/design/TemplatePicker.vue'
import TitleSection from '@/components/editor/design/TitleSection.vue'
import TypographySection from '@/components/editor/design/TypographySection.vue'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()
</script>

<template>
  <div class="panel-design">
    <TemplatePicker />
    <ColorSection />
    <TypographySection />
    <TitleSection />

    <div class="ed-group">
      <button class="ed-btn ed-btn-block" @click="store.resetTheme()">恢复默认主题</button>
    </div>
  </div>
</template>
