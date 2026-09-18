<script setup>
/**
 * 模块标题：主体样式、标记形状、标题内间距与底部装饰。
 */
import { computed } from 'vue'

import {
  TITLE_BOTTOM_ALIGNS,
  TITLE_BOTTOM_STYLES,
  TITLE_MARKERS,
  TITLE_STYLES,
} from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

/** 折叠前也能看到当前底部装饰 */
const bottomLabel = computed(
  () => TITLE_BOTTOM_STYLES.find((item) => item.value === store.theme.titleBottom)?.label || '无',
)
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title"><span>模块标题</span></div>

    <div class="ed-seg">
      <button
        v-for="style in TITLE_STYLES"
        :key="style.value"
        :class="{ 'is-active': store.theme.titleStyle === style.value }"
        @click="store.setTheme({ titleStyle: style.value })"
      >
        {{ style.label }}
      </button>
    </div>

    <div class="seg-caption">标记形状</div>
    <div class="ed-seg">
      <button
        v-for="marker in TITLE_MARKERS"
        :key="marker.value"
        :class="{ 'is-active': store.theme.titleMarker === marker.value }"
        @click="store.setTheme({ titleMarker: marker.value })"
      >
        {{ marker.label }}
      </button>
    </div>

    <label class="ed-row">
      <span class="ed-label">标记间距</span>
      <input
        class="ed-range"
        type="range"
        min="0"
        max="1.2"
        step="0.02"
        :value="store.theme.titleGap"
        @input="store.setTheme({ titleGap: Number($event.target.value) })"
      />
      <span class="ed-value">{{ Number(store.theme.titleGap).toFixed(2) }}em</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">距下方正文</span>
      <input
        class="ed-range"
        type="range"
        min="0.1"
        max="1.6"
        step="0.05"
        :value="store.theme.titleMargin"
        @input="store.setTheme({ titleMargin: Number($event.target.value) })"
      />
      <span class="ed-value">{{ Number(store.theme.titleMargin).toFixed(2) }}em</span>
    </label>

    <p class="ed-hint">
      「标记间距」是标记形状与标题文字的横向距离，「距下方正文」是标题与模块内容的纵向距离。色块最醒目；投国企、事业单位时换成下划线或纯文字更稳重。
    </p>
  </div>

  <div class="ed-group">
    <div class="ed-group-title">
      <span>标题底部装饰</span>
      <span class="ed-count">{{ bottomLabel }}</span>
    </div>

    <div class="ed-seg">
      <button
        v-for="line in TITLE_BOTTOM_STYLES"
        :key="line.value"
        :class="{ 'is-active': store.theme.titleBottom === line.value }"
        @click="store.setTheme({ titleBottom: line.value })"
      >
        {{ line.label }}
      </button>
    </div>

    <template v-if="store.theme.titleBottom !== 'none'">
      <label class="ed-row">
        <span class="ed-label">长度</span>
        <input
          class="ed-range"
          type="range"
          min="10"
          max="100"
          step="1"
          :value="store.theme.titleBottomWidth"
          @input="store.setTheme({ titleBottomWidth: Number($event.target.value) })"
        />
        <span class="ed-value">{{ store.theme.titleBottomWidth }}%</span>
      </label>

      <label class="ed-row">
        <span class="ed-label">粗细</span>
        <input
          class="ed-range"
          type="range"
          min="1"
          max="6"
          step="0.5"
          :value="store.theme.titleBottomThickness"
          @input="store.setTheme({ titleBottomThickness: Number($event.target.value) })"
        />
        <span class="ed-value">{{ store.theme.titleBottomThickness }}px</span>
      </label>

      <label class="ed-row">
        <span class="ed-label">距标题文字</span>
        <input
          class="ed-range"
          type="range"
          min="0"
          max="16"
          step="1"
          :value="store.theme.titleBottomGap"
          @input="store.setTheme({ titleBottomGap: Number($event.target.value) })"
        />
        <span class="ed-value">{{ store.theme.titleBottomGap }}px</span>
      </label>

      <div class="seg-caption">线的起始位置</div>
      <div class="ed-seg">
        <button
          v-for="align in TITLE_BOTTOM_ALIGNS"
          :key="align.value"
          :class="{ 'is-active': store.theme.titleBottomAlign === align.value }"
          @click="store.setTheme({ titleBottomAlign: align.value })"
        >
          {{ align.label }}
        </button>
      </div>
    </template>

    <p class="ed-hint">
      底部装饰与主体样式相互独立，可以叠加；颜色跟随主色，左侧色栏等深色区域内自动转为白色。梯形、彩带、箭头按线宽的三倍作为高度。
    </p>
  </div>
</template>
