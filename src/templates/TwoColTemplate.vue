<script setup>
/**
 * 双栏紧凑模板。
 * 顶部通栏放姓名与联系方式，下方左右分栏：窄栏放键值、技能与段落，宽栏放经历条目。
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

/** 经历条目信息量大，独占宽栏 */
const wideTypes = ['entries']
const wideSections = computed(() => sections.value.filter((s) => wideTypes.includes(s.type)))
const sideSections = computed(() => sections.value.filter((s) => !wideTypes.includes(s.type)))
</script>

<template>
  <div class="tpl-twocol">
    <header class="head">
      <div class="who">
        <h1 class="r-name">{{ basics.name }}</h1>
        <p v-if="basics.jobTitle" class="r-job">{{ basics.jobTitle }}</p>

        <div v-if="basics.fields.length" class="r-info-grid contact r-body">
          <div v-for="field in basics.fields" :key="field.id" class="r-info-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="13" />
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

    <div class="cols">
      <div class="col side">
        <section
          v-for="section in sideSections"
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
      <div class="col wide">
        <section
          v-for="section in wideSections"
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
    </div>
  </div>
</template>

<style scoped>
/*
 * 页头同时容纳「姓名 + 职位 + 基本信息」与绝对定位的头像。
 * 头像高 35mm，只放姓名会让这段高度整片空着把内容推远；
 * 基本信息放进页头既填满这条高度带，也随 .who 一起获得头像避让内边距。
 */
.head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.5em;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm));
  padding-bottom: 0.75em;
  /* 分隔线挂在页头上，保证始终落在头像下方且不被头像左右移动截断 */
  border-bottom: 1px solid rgba(var(--accent-rgb), 0.35);
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

.cols {
  display: flex;
  align-items: stretch;
  gap: 1.6em;
  margin-top: 1.15em;
}

.side {
  /* 窄栏横向空间紧张，正文不再额外缩进 */
  --body-indent: 0;
  flex: 0 0 34%;
  padding-right: 1.4em;
  border-right: 1px solid rgba(var(--accent-rgb), 0.28);
}

.wide {
  flex: 1 1 auto;
  min-width: 0;
}

.cols .r-sec:first-child {
  margin-top: 0;
}

/* 窄栏改为单列，避免信息被挤压 */
.side :deep(.r-info-grid),
.side :deep(.r-bars) {
  grid-template-columns: 1fr;
  gap: 0.6em;
}
</style>
