<script setup>
/**
 * 字体与排版：字族选择、字号、行距、模块间距、页面留白。
 */
import { computed } from 'vue'

import { FONTS, FONT_GROUPS, FONT_SIZE_TIPS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

/** 当前字体，用于字样预览 */
const currentFont = computed(() => FONTS[store.theme.fontKey] || FONTS.yahei)
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title"><span>字体与排版</span></div>

    <label class="ed-row">
      <span class="ed-label">字体</span>
      <select
        class="ed-select"
        :value="store.theme.fontKey"
        @change="store.setTheme({ fontKey: $event.target.value })"
      >
        <optgroup v-for="group in FONT_GROUPS" :key="group.name" :label="group.name">
          <option v-for="font in group.items" :key="font.value" :value="font.value">
            {{ font.name }}{{ font.recommended ? '（推荐）' : '' }}
          </option>
        </optgroup>
      </select>
    </label>

    <div class="font-preview" :style="{ fontFamily: currentFont.stack }">
      <span class="fp-name">{{ currentFont.name }}</span>
      <span class="fp-sample">简历排版预览 Resume 2026</span>
    </div>
    <p class="ed-hint">{{ currentFont.desc }}</p>

    <label class="ed-row">
      <span class="ed-label">字号</span>
      <input
        class="ed-range"
        type="range"
        min="0.8"
        max="1.2"
        step="0.01"
        :value="store.theme.fs"
        @input="store.setTheme({ fs: Number($event.target.value) })"
      />
      <span class="ed-value">{{ Math.round(store.theme.fs * 100) }}%</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">行距</span>
      <input
        class="ed-range"
        type="range"
        min="1.4"
        max="2.1"
        step="0.05"
        :value="store.theme.lh"
        @input="store.setTheme({ lh: Number($event.target.value) })"
      />
      <span class="ed-value">{{ store.theme.lh.toFixed(2) }}</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">模块间距</span>
      <input
        class="ed-range"
        type="range"
        min="0.6"
        max="1.6"
        step="0.05"
        :value="store.theme.gap"
        @input="store.setTheme({ gap: Number($event.target.value) })"
      />
      <span class="ed-value">{{ store.theme.gap.toFixed(1) }}</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">上下留白</span>
      <input
        class="ed-range"
        type="range"
        min="8"
        max="24"
        step="1"
        :value="store.theme.mv"
        @input="store.setTheme({ mv: Number($event.target.value) })"
      />
      <span class="ed-value">{{ store.theme.mv }}mm</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">左右留白</span>
      <input
        class="ed-range"
        type="range"
        min="8"
        max="24"
        step="1"
        :value="store.theme.mh"
        @input="store.setTheme({ mh: Number($event.target.value) })"
      />
      <span class="ed-value">{{ store.theme.mh }}mm</span>
    </label>

    <p class="ed-hint">留白同时作用于预览与打印的页边距。</p>
    <p class="ed-hint">{{ FONT_SIZE_TIPS }}同一份简历建议只用 1–2 种字体。</p>
    <p class="ed-hint">
      「一键导出 PDF」会把字体嵌入文件，不受对方电脑字体影响；「打印导出」以本机字体渲染，建议优先选系统自带字体（微软雅黑、宋体、Arial、Times New Roman 最保险）。
    </p>
  </div>
</template>

<style scoped>
.font-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 6px;
  padding: 10px 12px;
  border: 1px solid #eceff4;
  border-radius: 8px;
  background: #fcfdfe;
}

.fp-name {
  color: #8b93a1;
  font-size: 11px;
  letter-spacing: 0.4px;
}

.fp-sample {
  color: #1f2329;
  font-size: 16px;
  line-height: 1.5;
}
</style>
