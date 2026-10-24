<script setup lang="ts">
/**
 * 行内加粗渲染：把 `**加粗**` 片段套上 <strong>，其余文字原样输出。
 *
 * 为什么不用 v-html：简历文本全部来自用户输入，仓库的 ESLint 规则禁用 v-html
 * （既有 XSS 风险面也难测）；拆成片段用模板渲染，输出完全可控。
 * 未闭合的 `**` 按普通文字显示，不会打散用户内容（解析规则见 utils/richText.ts）。
 *
 * 粗体的实际字重不在这里指定 —— 各模板对正文有自己的字重档位，
 * <strong> 的默认 bolder 语义交给浏览器与模板继承，避免 12 套模板逐个调。
 */
import { computed } from 'vue'

import { parseBoldSegments } from '@/utils/richText'

const props = defineProps<{ text: string }>()

const segments = computed(() => parseBoldSegments(props.text ?? ''))
</script>

<template>
  <template v-for="(seg, i) in segments" :key="i">
    <strong v-if="seg.bold">{{ seg.text }}</strong>
    <template v-else>{{ seg.text }}</template>
  </template>
</template>
