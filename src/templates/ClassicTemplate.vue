<script setup lang="ts">
/**
 * 经典单栏模板。
 * 姓名 + 头像居顶，基本信息两列网格，正文模块自上而下堆叠。
 */
import { computed } from 'vue'

import SectionBody from '@/components/paper/SectionBody.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { sectionLayoutStyle } from '@/utils/sectionStyle'
import type { Resume } from '@/types/resume'

/*
 * 模板统一以 Resume 收口：这些组件在编辑器、分享页、官网合集三处共用同一份数据，
 * 用具体类型而不是 { type: Object }，模板里取 basics.fields / section.visible
 * 才有约束 —— 数据形状漂移时会在这里报出来，而不是渲染成空白。
 * 可见性过滤放在 computed 里，模板只管遍历。
 */
const props = defineProps<{
  resume: Resume
  /** 纸面多选时选中的模块 id，仅编辑态用于高亮 */
  selectedIds?: string[]
}>()

const basics = computed(() => props.resume.basics)
const sections = computed(() => props.resume.sections.filter((s) => s.visible))
const selectedSet = computed(() => new Set(props.selectedIds ?? []))
</script>

<template>
  <div class="tpl-classic">
    <header class="head">
      <div class="who">
        <h1 class="r-name" data-field="name">{{ basics.name }}</h1>
        <p v-if="basics.jobTitle" class="r-job" data-field="jobTitle">{{ basics.jobTitle }}</p>

        <div v-if="basics.fields.length" class="r-info-grid contact r-body">
          <div v-for="field in basics.fields" :key="field.id" class="r-info-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="14" />
            <span class="r-lab" data-field="basicsLabel" :data-item-id="field.id"
              >{{ field.label }}：</span
            >
            <span class="r-val" data-field="basicsValue" :data-item-id="field.id">{{
              field.value
            }}</span>
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
      <h2 class="r-title" data-field="sectionTitle">
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
 * 页头同时容纳「姓名 + 职位 + 基本信息」与绝对定位的头像。
 *
 * 头像高 35mm，若页头里只放姓名，这 35mm 就整片空着把下方内容平白推远；
 * 把基本信息一并放进页头，等于用内容填满头像的高度带，间距自然收拢。
 * 附带好处是基本信息随 .who 一起拿到避让内边距，头像左右拖动时压不到它。
 */
.head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.5em;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm));
  padding-bottom: 0.85em;
  /* 分隔线挂在页头而非基本信息上：页头是唯一保证不低于头像高度的容器，
     线挂这里才能始终落在头像下方，也不会因头像左右移动而被截断 */
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
</style>
