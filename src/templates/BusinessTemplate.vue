<script setup>
/**
 * 居中正式模板。
 * 页头与模块标题沿中轴对称排布，双细线收束页头，适合国企、事业单位等正式投递场景。
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
  <div class="tpl-business">
    <header class="head">
      <div v-if="basics.showAvatar" class="r-avatar">
        <img v-if="basics.avatar" :src="basics.avatar" alt="头像" />
        <SvgIcon v-else name="user" />
      </div>

      <div class="who">
        <h1 class="r-name">{{ basics.name }}</h1>
        <p v-if="basics.jobTitle" class="r-job">{{ basics.jobTitle }}</p>

        <div v-if="basics.fields.length" class="meta">
          <span v-for="(field, index) in basics.fields" :key="field.id" class="meta-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="13" />
            <span class="r-lab">{{ field.label }}：</span>
            <span class="r-val">{{ field.value }}</span>
            <span v-if="index < basics.fields.length - 1" class="sep">·</span>
          </span>
        </div>
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
 * 头像为绝对定位，页头需自行撑出与头像等高的空间。
 * 内容竖排居中，整条页头沿中轴对称，与正文的居中标题呼应。
 */
.head {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm));
  padding-bottom: 1.1em;
  border-bottom: 4px double rgba(var(--accent-rgb), 0.5);
  text-align: center;
}

/* 头像被拖离原位时，姓名与联系方式让出对应一侧的宽度 */
.who {
  min-width: 0;
  padding-left: var(--avatar-pad-left, 0);
  padding-right: var(--avatar-pad-right, 0);
}

/* 宽字距是居中排版的仪式感来源；text-indent 抵消末字后的字距，让视觉居中不偏移 */
.tpl-business .r-name {
  letter-spacing: 0.3em;
  text-indent: 0.3em;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35em 0.9em;
  margin-top: 0.9em;
  color: #4b5563;
  font-size: 0.94em;
}

/* 一个字段整体换行，不允许在字段内部断开 */
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  white-space: nowrap;
}

.meta-item .svg-icon {
  width: 1em;
  height: 1em;
  color: var(--accent);
}

.meta-item .r-val {
  white-space: nowrap;
}

.sep {
  margin-left: 0.55em;
  color: #d1d5db;
}

/* 标题居中排布；点线延伸与两端对齐的标题样式互斥，居中下隐藏 */
.tpl-business .r-title {
  justify-content: center;
  letter-spacing: 0.16em;
}

.tpl-business .r-title .r-leader {
  display: none;
}
</style>
