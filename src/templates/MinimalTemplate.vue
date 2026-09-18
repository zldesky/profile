<script setup>
/**
 * 极简留白模板。
 * 与其它模板一样使用主题定义的标题样式、标记与底边线，
 * 差异只体现在留白、字距与细线化处理上，适合学术、研究及外企岗位。
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
  <div class="tpl-minimal">
    <header class="head">
      <div class="head-main">
        <h1 class="name">{{ basics.name }}</h1>
        <p v-if="basics.jobTitle" class="job">{{ basics.jobTitle }}</p>
        <div v-if="basics.fields.length" class="meta">
          <span v-for="(field, index) in basics.fields" :key="field.id" class="meta-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="13" />
            <span>{{ field.value }}</span>
            <span v-if="field.label" class="meta-key">{{ field.label }}</span>
            <span v-if="index < basics.fields.length - 1" class="sep">·</span>
          </span>
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
.tpl-minimal {
  letter-spacing: 0.01em;
}

/* 标题沿用主题设置，只在上层包一层字距，保留极简排版偏松的观感 */
.tpl-minimal .r-title {
  letter-spacing: 0.2em;
}

/* 头像为绝对定位，页头需自行撑出与头像等高的空间 */
.head {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.6em;
  padding-bottom: 1.4em;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm));
}

/* 头像被拖离原位时，姓名与联系方式让出对应一侧的宽度 */
.head-main {
  min-width: 0;
  padding-left: var(--avatar-pad-left, 0);
  padding-right: var(--avatar-pad-right, 0);
}

/* 极简风格下头像用细边框 */
.head .r-avatar {
  border-width: 1px;
}

.name {
  font-size: 2.1em;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: 0.12em;
}

.job {
  margin-top: 0.3em;
  color: #6b7280;
  letter-spacing: 0.16em;
}

.meta {
  display: flex;
  flex-wrap: wrap;
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
  color: #9ca3af;
}

.meta-key {
  color: #9ca3af;
}

.sep {
  margin-left: 0.3em;
  color: #d1d5db;
}

.r-sec {
  margin-top: calc(1.5em * var(--gap));
}

/* 进度条改为细线风格 */
.tpl-minimal :deep(.r-bar-track) {
  height: 0.24em;
  border-radius: 0;
  background: #e5e7eb;
}

.tpl-minimal :deep(.r-bar-fill) {
  border-radius: 0;
}

.tpl-minimal :deep(.r-bullets li::before) {
  width: 0.26em;
  height: 0.26em;
  top: 0.7em;
}
</style>
