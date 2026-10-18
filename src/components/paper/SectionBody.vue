<script setup lang="ts">
/**
 * 模块正文渲染器。
 * 按模块 type 输出不同结构，各模板共用，布局差异由外层模板组件决定。
 * 正文缩进统一加在 .r-body 上，避免内部块重复偏移。
 *
 * `data-field` / `data-item-id` 是为「在纸上直接改」提供的稳定锚点：
 * 预览区据此把点到的 DOM 映射回数据字段（见 composables/useInlineEdit.ts）。
 * 不能靠 index 推断 —— 模板层会过滤掉隐藏模块，索引与 store 里的位置并不一致。
 */
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import type { Section } from '@/types/resume'

const props = defineProps<{ section: Section }>()

/** 未指定列数时改用流式排布，保证每一项的标签与内容始终在同一行 */
const gridFlow = computed(() => {
  const layout = props.section.layout
  const columns = layout?.columns
  return !columns || columns === 'auto'
})
</script>

<template>
  <div class="r-body">
    <!-- 键值网格 -->
    <div v-if="section.type === 'grid'" class="r-info-grid" :class="{ 'is-flow': gridFlow }">
      <div v-for="item in section.items" :key="item.id" class="r-info-item">
        <SvgIcon v-if="item.icon !== 'none'" :name="item.icon" :size="14" />
        <span class="r-lab" data-field="gridLabel" :data-item-id="item.id">{{ item.label }}：</span>
        <span class="r-val" data-field="gridValue" :data-item-id="item.id">{{ item.value }}</span>
      </div>
    </div>

    <!-- 条目列表 -->
    <template v-else-if="section.type === 'entries'">
      <article
        v-for="entry in section.items"
        :key="entry.id"
        class="r-entry"
        :data-item-id="entry.id"
      >
        <div class="r-entry-head">
          <span v-if="section.showLogo" class="r-logo" :class="{ 'is-placeholder': !entry.logo }">
            <img v-if="entry.logo" :src="entry.logo" :alt="entry.org" />
            <template v-else>{{ (entry.org || '?').slice(0, 1) }}</template>
          </span>
          <span v-if="entry.time" class="r-time" data-field="entryTime">{{ entry.time }}</span>
          <span v-if="entry.org" class="r-org" data-field="entryOrg">{{ entry.org }}</span>
          <span v-if="entry.role" class="r-role" data-field="entryRole">{{ entry.role }}</span>
        </div>
        <div v-for="meta in entry.meta" :key="meta.id" class="r-kv">
          <span class="r-k" data-field="metaLabel" :data-item-id="meta.id">{{ meta.label }}：</span>
          <span class="r-v" data-field="metaValue" :data-item-id="meta.id">{{ meta.value }}</span>
        </div>
        <ul v-if="entry.bullets.length" class="r-bullets">
          <li
            v-for="bullet in entry.bullets"
            :key="bullet.id"
            data-field="bulletText"
            :data-item-id="bullet.id"
          >
            {{ bullet.text }}
          </li>
        </ul>
      </article>
    </template>

    <!-- 技能特长 -->
    <template v-else-if="section.type === 'skills'">
      <div v-for="field in section.fields" :key="field.id" class="r-kv">
        <span class="r-k" data-field="skillLabel" :data-item-id="field.id"
          >{{ field.label }}：</span
        >
        <span class="r-v" data-field="skillValue" :data-item-id="field.id">{{ field.value }}</span>
      </div>
      <!--
        这里原先在 showBars 打开时渲染技能进度条。已整套移除：
        简历里给技能打百分比既不精确也不加分。现在技能只走上方的文字描述。
        showBars 字段保留在数据里（旧简历照常加载），只是不再被读取。
      -->
    </template>

    <!-- 段落文本 -->
    <p v-else class="r-para" data-field="content">{{ section.content }}</p>
  </div>
</template>
