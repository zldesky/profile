<script setup>
/**
 * 时间轴模板。
 * 单栏结构，经历条目沿左侧竖轴排列，突出职业发展节奏。
 */
import { computed } from 'vue'

import SectionBody from '@/components/paper/SectionBody.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { sectionLayoutStyle } from '@/utils/sectionStyle'

const props = defineProps({
  resume: { type: Object, required: true },
})

const basics = computed(() => props.resume.basics)
const sections = computed(() => props.resume.sections.filter((s) => s.visible))
</script>

<template>
  <div class="tpl-timeline">
    <header class="head">
      <div v-if="basics.showAvatar" class="r-avatar">
        <img v-if="basics.avatar" :src="basics.avatar" alt="头像" />
        <SvgIcon v-else name="user" />
      </div>
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
    </header>

    <section
      v-for="section in sections"
      :key="section.id"
      class="r-sec"
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
/* 头像为绝对定位，页头需自行撑出与头像等高的空间 */
.head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.1em;
  padding-bottom: 0.9em;
  border-bottom: 2px solid var(--accent);
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm));
}

.head .r-avatar {
  border-width: 1px;
}

/*
 * 基本信息放进页头，与经典 / 双栏模板一致：
 * 既填满头像 35mm 的高度带（否则这段高度整片空着把内容推远），
 * 也让它随 .who 一起获得头像避让内边距，头像拖到哪边都不会压住它。
 *
 * 本行只剩一个子元素（头像绝对定位），必须显式占满宽度，
 * 否则两列网格会按内容宽度收缩而不是铺满整行。
 */
.who {
  flex: 1 1 auto;
  min-width: 0;
  padding-left: var(--avatar-pad-left, 0);
  padding-right: var(--avatar-pad-right, 0);
}

.contact {
  margin-top: calc(0.6em * var(--gap, 1));
  /* 列数由正文可用宽度决定：头像挤到中部时可退回单列 */
  grid-template-columns: repeat(var(--contact-cols, 2), minmax(0, 1fr));
}

/* 经历条目改为沿竖轴排列 */
.tpl-timeline :deep(.r-entry) {
  position: relative;
  margin-top: 0;
  padding: 0.55em 0 0.55em 1.7em;
  border-left: 1px solid rgba(var(--accent-rgb), 0.35);
}

.tpl-timeline :deep(.r-entry:first-child) {
  padding-top: 0.15em;
}

.tpl-timeline :deep(.r-entry:last-child) {
  padding-bottom: 0;
  border-left-color: transparent;
}

.tpl-timeline :deep(.r-entry)::before {
  content: '';
  position: absolute;
  top: 0.75em;
  left: -0.34em;
  width: 0.68em;
  height: 0.68em;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--accent);
  box-sizing: content-box;
}

.tpl-timeline :deep(.r-entry:first-child)::before {
  top: 0.35em;
}
</style>
