<script setup>
/**
 * 配色：主色预设、主色与文字色的自定义取色。
 */
import { computed } from 'vue'

import { ACCENT_PRESETS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

/** 预设色板高亮：忽略大小写差异 */
const activePreset = computed(() => store.theme.accent.toLowerCase())

function isPresetActive(color) {
  return activePreset.value === color.toLowerCase()
}
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title"><span>配色</span></div>

    <div class="ed-swatches">
      <button
        v-for="color in ACCENT_PRESETS"
        :key="color"
        class="ed-swatch"
        :class="{ 'is-active': isPresetActive(color) }"
        :style="{ background: color }"
        :title="color"
        @click="store.setTheme({ accent: color })"
      ></button>
    </div>

    <label class="ed-row">
      <span class="ed-label">主色</span>
      <input
        class="ed-color"
        type="color"
        :value="store.theme.accent"
        @input="store.setTheme({ accent: $event.target.value })"
      />
      <span class="color-text">{{ store.theme.accent }}</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">文字色</span>
      <input
        class="ed-color"
        type="color"
        :value="store.theme.text"
        @input="store.setTheme({ text: $event.target.value })"
      />
      <span class="color-text">{{ store.theme.text }}</span>
    </label>
  </div>
</template>

<style scoped>
.color-text {
  color: #8b93a1;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
</style>
