<script setup>
/**
 * 卡片分区模板。
 * 页头沿用经典布局，正文每个模块装入浅色底纹的圆角卡片，分区一目了然。
 */
import { computed } from 'vue'

import SectionBody from '@/components/paper/SectionBody.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { sectionLayoutStyle } from '@/utils/sectionStyle'

const props = defineProps({
  resume: { type: Object, required: true },
  /* 纸面多选时选中的模块 id，仅编辑态用于高亮 */
  selectedIds: { type: Array, default: () => [] },
})

const basics = computed(() => props.resume.basics)
const sections = computed(() => props.resume.sections.filter((s) => s.visible))
const selectedSet = computed(() => new Set(props.selectedIds))
</script>

<template>
  <div class="tpl-cards">
    <header class="head">
      <div class="who">
        <h1 class="r-name">{{ basics.name }}</h1>
        <p v-if="basics.jobTitle" class="r-job">{{ basics.jobTitle }}</p>

        <div v-if="basics.fields.length" class="r-info-grid contact r-body">
          <div v-for="field in basics.fields" :key="field.id" class="r-info-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="14" />
            <span class="r-lab">{{ field.label }}：</span>
            <span class="r-val">{{ field.value }}</span>
          </div>
        </div>
      </div>

      <div v-if="basics.showAvatar" class="r-avatar">
        <img v-if="basics.avatar" :src="basics.avatar" alt="头像" />
        <SvgIcon v-else name="user" />
      </div>
    </header>

    <section
      v-for="section in sections"
      :key="section.id"
      class="r-sec"
      :class="{ 'is-sec-selected': selectedSet.has(section.id) }"
      :data-sec-id="section.id"
      :style="sectionLayoutStyle(section)"
    >
      <h2 class="r-title">
        <span class="dot"></span>
        <span>{{ section.title }}</span>
        <span class="r-leader"></span>
      </h2>
      <SectionBody :section="section" />
    </section>
  </div>
</template>

<style scoped>
/*
 * 页头同时容纳「姓名 + 职位 + 基本信息」与绝对定位的头像，
 * 与经典模板一致：min-height 撑出头像高度带，基本信息随 .who 避让头像。
 */
.head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.5em;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm));
  padding-bottom: 0.5em;
}

/* 头像绝对定位后本行只剩一个子元素，需显式占满宽度，基本信息的两列网格才排得开 */
.who {
  flex: 1 1 auto;
  min-width: 0;
  padding-left: var(--avatar-pad-left, 0);
  padding-right: var(--avatar-pad-right, 0);
}

/* 间距跟随主题的模块间距，换主题时不会显得脱节 */
.contact {
  margin-top: calc(0.6em * var(--gap, 1));
  /* 列数由正文可用宽度决定：头像挤到中部时可退回单列 */
  grid-template-columns: repeat(var(--contact-cols, 2), minmax(0, 1fr));
}

/*
 * 卡片即模块：底纹与描边都从主色派生，换配色时整版卡片随之换色。
 * 模块间距（.r-sec 的 margin-top）直接充当卡片间距，不另造间距变量。
 */
.tpl-cards .r-sec {
  padding: 0.8em 1.1em 0.95em;
  background: rgba(var(--accent-rgb), 0.045);
  border: 1px solid rgba(var(--accent-rgb), 0.13);
  border-radius: 0.5em;
}

.tpl-cards .r-sec:first-of-type {
  margin-top: 0.65em;
}
</style>
