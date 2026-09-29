<script setup>
/**
 * 左侧色栏模板。
 * 左侧深色竖栏承载联系方式与静态信息（键值网格、技能），右侧正文栏承载经历描述。
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

/** 键值与技能适合窄栏，经历与段落留给正文栏 */
const railTypes = ['grid', 'skills']
const railSections = computed(() => sections.value.filter((s) => railTypes.includes(s.type)))
const bodySections = computed(() => sections.value.filter((s) => !railTypes.includes(s.type)))
</script>

<template>
  <div class="tpl-sidebar tpl-bleed">
    <aside class="rail on-dark">
      <div class="profile">
        <div v-if="basics.showAvatar" class="r-avatar">
          <img v-if="basics.avatar" :src="basics.avatar" alt="头像" />
          <SvgIcon v-else name="user" />
        </div>
        <h1 class="r-name">{{ basics.name }}</h1>
        <p v-if="basics.jobTitle" class="r-job">{{ basics.jobTitle }}</p>
      </div>

      <section v-if="basics.fields.length" class="r-sec">
        <h2 class="r-title">
          <span class="dot"></span>
          <span>联系方式</span>
          <span class="r-leader"></span>
        </h2>
        <div class="rail-list">
          <div v-for="field in basics.fields" :key="field.id" class="rail-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="13" />
            <span class="r-lab">{{ field.label }}</span>
            <span class="r-val">{{ field.value }}</span>
          </div>
        </div>
      </section>

      <section
        v-for="section in railSections"
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
    </aside>

    <main class="body">
      <section
        v-for="section in bodySections"
        :key="section.id"
        class="r-sec"
        :style="sectionLayoutStyle(section)"
      >
        <h2 class="r-title">
          <span class="dot"></span><span>{{ section.title }}</span>
        </h2>
        <SectionBody :section="section" />
      </section>
    </main>
  </div>
</template>

<style scoped>
.tpl-sidebar {
  display: flex;
  align-items: stretch;
}

.rail {
  /* 窄栏横向空间紧张，正文不再额外缩进 */
  --body-indent: 0;
  flex: 0 0 33%;
  padding: var(--mv) 1.6em;
  background: var(--accent);
  color: #fff;
}

.body {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--mv) 1.6em var(--mv) 1.8em;
}

.profile {
  text-align: center;
}

/*
 * 侧栏里头像竖排在姓名上方，横向不与正文争空间，
 * 因此保留文档流定位：向下拖拽靠 margin-bottom 把姓名等量推开。
 */
.profile .r-avatar {
  position: static;
  transform: translate(var(--avatar-dx, 0mm), var(--avatar-dy, 0mm));
  margin: 0 auto calc(0.85em + var(--avatar-extra-h, 0mm));
}

.rail .r-name,
.rail .r-job {
  color: #fff;
}

.rail .r-job {
  font-weight: 500;
  opacity: 0.9;
}

.rail-list {
  display: flex;
  flex-direction: column;
  gap: 0.45em;
}

.rail-item {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  min-width: 0;
}

.rail-item .r-lab {
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
}

.rail-item .r-lab::after {
  content: '：';
}

.rail-item .r-val {
  color: #fff;
  word-break: break-all;
}

/* 窄栏内改单列排布 */
.rail :deep(.r-info-grid),
.rail :deep(.r-bars) {
  grid-template-columns: 1fr;
  gap: 0.6em;
}

.rail .r-sec:first-of-type {
  margin-top: 1.3em;
}

.body .r-sec:first-child {
  margin-top: 0;
}
</style>
