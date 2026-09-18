<script setup>
/**
 * 模块正文渲染器。
 * 按模块 type 输出不同结构，各模板共用，布局差异由外层模板组件决定。
 * 正文缩进统一加在 .r-body 上，避免内部块重复偏移。
 */
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'

const props = defineProps({
  section: { type: Object, required: true },
})

/** 未指定列数时改用流式排布，保证每一项的标签与内容始终在同一行 */
const gridFlow = computed(() => {
  const columns = props.section.layout?.columns
  return !columns || columns === 'auto'
})
</script>

<template>
  <div class="r-body">
    <!-- 键值网格 -->
    <div v-if="section.type === 'grid'" class="r-info-grid" :class="{ 'is-flow': gridFlow }">
      <div v-for="item in section.items" :key="item.id" class="r-info-item">
        <SvgIcon v-if="item.icon !== 'none'" :name="item.icon" :size="14" />
        <span class="r-lab">{{ item.label }}：</span>
        <span class="r-val">{{ item.value }}</span>
      </div>
    </div>

    <!-- 条目列表 -->
    <template v-else-if="section.type === 'entries'">
      <article v-for="entry in section.items" :key="entry.id" class="r-entry">
        <div class="r-entry-head">
          <span v-if="section.showLogo" class="r-logo" :class="{ 'is-placeholder': !entry.logo }">
            <img v-if="entry.logo" :src="entry.logo" :alt="entry.org" />
            <template v-else>{{ (entry.org || '?').slice(0, 1) }}</template>
          </span>
          <span v-if="entry.time" class="r-time">{{ entry.time }}</span>
          <span v-if="entry.org" class="r-org">{{ entry.org }}</span>
          <span v-if="entry.role" class="r-role">{{ entry.role }}</span>
        </div>
        <div v-for="meta in entry.meta" :key="meta.id" class="r-kv">
          <span class="r-k">{{ meta.label }}：</span>
          <span class="r-v">{{ meta.value }}</span>
        </div>
        <ul v-if="entry.bullets.length" class="r-bullets">
          <li v-for="bullet in entry.bullets" :key="bullet.id">{{ bullet.text }}</li>
        </ul>
      </article>
    </template>

    <!-- 技能特长 -->
    <template v-else-if="section.type === 'skills'">
      <div v-for="field in section.fields" :key="field.id" class="r-kv">
        <span class="r-k">{{ field.label }}：</span>
        <span class="r-v">{{ field.value }}</span>
      </div>
      <div v-if="section.showBars && section.items.length" class="r-bars">
        <div v-for="skill in section.items" :key="skill.id">
          <div class="r-bar-head">
            <span>{{ skill.name }}</span>
            <span class="r-bar-pct">{{ skill.level }}%</span>
          </div>
          <div class="r-bar-track">
            <span class="r-bar-fill" :style="{ width: `${skill.level}%` }"></span>
          </div>
        </div>
      </div>
    </template>

    <!-- 段落文本 -->
    <p v-else class="r-para">{{ section.content }}</p>
  </div>
</template>
