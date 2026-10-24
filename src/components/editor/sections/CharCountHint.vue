<script setup lang="ts">
/**
 * 字数提示：`已写 62 字（建议 40–80）`。
 *
 * 三个刻意的选择：
 *
 * 1. **只报「已写」与区间，不做「还剩 N 字」的进度条。**
 *    进度条会让人为了填满而灌水，而简历最怕的就是灌水。
 *
 * 2. **阈值与写作检查共用同一份常量**（data/writingRules.ts 的 BULLET_LENGTH）。
 *    两处各写一个数字，迟早出现「检查说超了、这里说没超」的自相矛盾。
 *
 * 3. **超长才变琥珀色，偏短不变色。**
 *    偏短只是「还可以再补」，用告警色会让人误以为写错了。
 */
import { computed } from 'vue'

import { BULLET_LENGTH } from '@/data/writingRules'
import { charCount } from '@/utils/expression'

const props = withDefaults(
  defineProps<{
    text?: string
    /** 建议区间；缺省用要点区间（8–80） */
    min?: number
    max?: number
  }>(),
  { text: '', min: BULLET_LENGTH.min, max: BULLET_LENGTH.max },
)

const count = computed(() => charCount(props.text))

/** 只有超过上限才提醒；为空时不显示（空内容由占位符引导，不需要再说一遍） */
const state = computed(() => {
  if (count.value === 0) return 'empty'
  if (count.value > props.max) return 'over'
  if (count.value < props.min) return 'under'
  return 'ok'
})

const hint = computed(() => {
  if (state.value === 'empty') return ''
  if (state.value === 'over') {
    return `已写 ${count.value} 字，超过建议的 ${props.max} 字，考虑拆成两条`
  }
  if (state.value === 'under') return `已写 ${count.value} 字，建议至少 ${props.min} 字`
  return `已写 ${count.value} 字（建议 ${props.min}–${props.max}）`
})
</script>

<template>
  <p class="cc-hint" :class="`is-${state}`">{{ hint }}</p>
</template>

<style scoped>
.cc-hint {
  margin: 2px 0 6px;
  color: var(--ed-text-3);
  font-size: 11.5px;
  line-height: 1.5;
}

/* 空内容不占位置：否则每个空要点下面都多一行空白 */
.cc-hint.is-empty {
  display: none;
}

/* 偏短与刚好都是中性灰，只有超长才变琥珀色 */
.cc-hint.is-over {
  color: var(--ed-warn);
}
</style>
