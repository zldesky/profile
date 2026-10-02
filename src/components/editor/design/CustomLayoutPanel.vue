<script setup>
/**
 * 自由定制模板的布局参数面板。
 * 仅在模板切到「自由定制」时显示，参数存于 theme.customLayout，
 * 改动即时反映在预览纸面；标题样式、配色等仍由其他主题分区控制。
 */
import { computed } from 'vue'

import { CUSTOM_HEADERS, CUSTOM_MODES, CUSTOM_RATIOS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

const visible = computed(() => store.resume.template === 'custom')
const layout = computed(() => store.theme.customLayout)

function set(key, value) {
  store.setTheme({ customLayout: { ...store.theme.customLayout, [key]: value } })
}
</script>

<template>
  <div v-if="visible" class="ed-group">
    <div class="ed-group-title"><span>自由定制布局</span></div>

    <div class="seg-caption">栏式布局</div>
    <div class="ed-seg">
      <button
        v-for="item in CUSTOM_MODES"
        :key="item.value"
        :class="{ 'is-active': layout.mode === item.value }"
        @click="set('mode', item.value)"
      >
        {{ item.label }}
      </button>
    </div>

    <template v-if="layout.mode !== 'single'">
      <div class="seg-caption">窄栏宽度</div>
      <div class="ed-seg">
        <button
          v-for="item in CUSTOM_RATIOS"
          :key="item.value"
          :class="{ 'is-active': layout.ratio === item.value }"
          @click="set('ratio', item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </template>

    <div class="seg-caption">页头形态</div>
    <div class="ed-seg">
      <button
        v-for="item in CUSTOM_HEADERS"
        :key="item.value"
        :class="{ 'is-active': layout.header === item.value }"
        @click="set('header', item.value)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="seg-caption">模块样式</div>
    <div class="ed-seg">
      <button :class="{ 'is-active': layout.cards }" @click="set('cards', !layout.cards)">
        {{ layout.cards ? '卡片化：开' : '卡片化：关' }}
      </button>
      <button
        v-if="layout.mode === 'split'"
        :class="{ 'is-active': layout.divider }"
        @click="set('divider', !layout.divider)"
      >
        {{ layout.divider ? '栏间线：开' : '栏间线：关' }}
      </button>
    </div>

    <p class="ed-hint">
      这些参数只作用于「自由定制」模板；配色、字体与标题样式仍由下方主题设置统一控制。
    </p>
  </div>
</template>
