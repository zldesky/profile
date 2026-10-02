<script setup>
/**
 * 自由定制模板。
 * 布局结构全部参数化（theme.customLayout）：
 * - mode    栏式布局：单栏 / 左侧栏 / 右侧栏 / 双栏
 * - ratio   窄栏占版心宽度比例
 * - header  页头形态：左对齐 / 居中 / 通栏色带
 * - cards   模块装入浅色卡片
 * - divider 双栏时的栏间分隔线
 * 标题样式、配色等仍由主题统一控制，本组件只组合结构。
 */
import { computed } from 'vue'

import SectionBody from '@/components/paper/SectionBody.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { DEFAULT_CUSTOM_LAYOUT } from '@/data/presets'
import { sectionLayoutStyle } from '@/utils/sectionStyle'

const props = defineProps({
  resume: { type: Object, required: true },
  /* 纸面多选时选中的模块 id，仅编辑态用于高亮 */
  selectedIds: { type: Array, default: () => [] },
})

const basics = computed(() => props.resume.basics)
const sections = computed(() => props.resume.sections.filter((s) => s.visible))
const selectedSet = computed(() => new Set(props.selectedIds))

const layout = computed(() => props.resume.theme?.customLayout || DEFAULT_CUSTOM_LAYOUT)
const mode = computed(() => layout.value.mode)
const headerKind = computed(() => layout.value.header)
const isRail = computed(() => mode.value === 'railLeft' || mode.value === 'railRight')
const isSingle = computed(() => mode.value === 'single')

const rootStyle = computed(() => ({ '--rail-w': `${layout.value.ratio}%` }))
const rootClass = computed(() => [
  { 'has-cards': layout.value.cards, 'is-right': mode.value === 'railRight' },
  { 'tpl-bleed': isRail.value },
])

/* 侧栏放静态信息（键值与技能），经历与段落留给正文栏 */
const railTypes = ['grid', 'skills']
const railSections = computed(() => sections.value.filter((s) => railTypes.includes(s.type)))
const bodySections = computed(() => sections.value.filter((s) => !railTypes.includes(s.type)))

/* 双栏时经历条目信息量大，独占宽栏 */
const wideTypes = ['entries']
const sideSections = computed(() => sections.value.filter((s) => !wideTypes.includes(s.type)))
const wideSections = computed(() => sections.value.filter((s) => wideTypes.includes(s.type)))
</script>

<template>
  <div class="tpl-custom" :class="rootClass" :style="rootStyle">
    <!-- 页头：通栏色带 -->
    <header v-if="headerKind === 'banner'" class="band on-dark" :class="{ 'is-inbleed': isRail }">
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

    <!-- 页头：左对齐 / 居中（侧栏模式下页头由侧栏自身承担，不另起页头） -->
    <header v-else-if="!isRail" class="head" :class="{ 'is-center': headerKind === 'center' }">
      <div v-if="basics.showAvatar" class="r-avatar">
        <img v-if="basics.avatar" :src="basics.avatar" alt="头像" />
        <SvgIcon v-else name="user" />
      </div>

      <div class="who">
        <h1 class="r-name">{{ basics.name }}</h1>
        <p v-if="basics.jobTitle" class="r-job">{{ basics.jobTitle }}</p>

        <div v-if="basics.fields.length && headerKind === 'center'" class="meta">
          <span v-for="(field, index) in basics.fields" :key="field.id" class="meta-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="13" />
            <span class="r-lab">{{ field.label }}：</span>
            <span class="r-val">{{ field.value }}</span>
            <span v-if="index < basics.fields.length - 1" class="sep">·</span>
          </span>
        </div>

        <div v-else-if="basics.fields.length" class="r-info-grid contact r-body">
          <div v-for="field in basics.fields" :key="field.id" class="r-info-item">
            <SvgIcon v-if="field.icon !== 'none'" :name="field.icon" :size="14" />
            <span class="r-lab">{{ field.label }}：</span>
            <span class="r-val">{{ field.value }}</span>
          </div>
        </div>
      </div>
    </header>

    <!-- 单栏 -->
    <div v-if="isSingle" class="layout is-single">
      <main class="main">
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
      </main>
    </div>

    <!-- 左右侧栏 -->
    <div v-else-if="isRail" class="layout is-rail">
      <aside class="rail on-dark">
        <div
          v-if="headerKind !== 'banner'"
          class="profile"
          :class="{ 'is-left': headerKind === 'left' }"
        >
          <div v-if="basics.showAvatar" class="r-avatar">
            <img v-if="basics.avatar" :src="basics.avatar" alt="头像" />
            <SvgIcon v-else name="user" />
          </div>
          <h1 class="r-name">{{ basics.name }}</h1>
          <p v-if="basics.jobTitle" class="r-job">{{ basics.jobTitle }}</p>
        </div>

        <section v-if="basics.fields.length && headerKind !== 'banner'" class="r-sec">
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
      </aside>

      <main class="main">
        <section
          v-for="section in bodySections"
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
      </main>
    </div>

    <!-- 双栏 -->
    <div v-else class="layout is-split" :class="{ 'has-divider': layout.divider }">
      <div class="side">
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
      <div class="wide">
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
.tpl-custom {
  display: flex;
  flex-direction: column;
}

.layout {
  display: flex;
  flex: 1 1 auto;
  align-items: stretch;
}

/* ---------------- 页头：左对齐 / 居中 ---------------- */

/*
 * 与经典模板一致：头像绝对定位，min-height 撑出头像高度带，
 * 姓名与联系方式随 .who 让位（--avatar-pad-*）。
 */
.head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.5em;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm));
  padding-bottom: 0.85em;
  border-bottom: 1px solid rgba(var(--accent-rgb), 0.35);
}

.who {
  flex: 1 1 auto;
  min-width: 0;
  padding-left: var(--avatar-pad-left, 0);
  padding-right: var(--avatar-pad-right, 0);
}

.head.is-center {
  flex-direction: column;
  align-items: center;
  padding-bottom: 1em;
  text-align: center;
}

.head.is-center .r-name {
  letter-spacing: 0.3em;
  text-indent: 0.3em;
}

.contact {
  margin-top: calc(0.6em * var(--gap, 1));
  /* 列数由正文可用宽度决定：头像挤到中部时可退回单列 */
  grid-template-columns: repeat(var(--contact-cols, 2), minmax(0, 1fr));
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

/* ---------------- 页头：通栏色带 ---------------- */

/*
 * 色带负外边距顶到纸张边缘（出血），内层用页边距把内容拉回正文竖轴；
 * 侧栏模式下根容器已整体出血，色带直接贴边即可。
 */
.band {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.5em;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm) + var(--band-pad) * 2);
  padding: var(--band-pad) var(--mh);
  margin: calc(var(--mv) * -1) calc(var(--mh) * -1) 0;
  background: linear-gradient(150deg, var(--accent) 55%, rgba(var(--accent-rgb), 0.86));
  --band-pad: 4.5mm;
}

.band.is-inbleed {
  margin: 0;
}

@media print {
  .band {
    margin: 0;
  }
}

.band .r-name,
.band .r-job {
  color: #fff;
}

.band .r-job {
  font-weight: 500;
  opacity: 0.9;
}

/* 深色底上主色图标会隐没，反白处理 */
.band .r-info-item .svg-icon {
  color: rgba(255, 255, 255, 0.85);
}

.band .r-avatar {
  top: var(--band-pad);
}

/* ---------------- 左右侧栏 ---------------- */

.is-rail.is-right {
  flex-direction: row-reverse;
}

.rail {
  /* 窄栏横向空间紧张，正文不再额外缩进 */
  --body-indent: 0;
  flex: 0 0 var(--rail-w, 34%);
  padding: var(--mv) 1.6em;
  background: var(--accent);
  color: #fff;
}

.is-rail .main {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--mv) 1.6em var(--mv) 1.8em;
}

.is-right .main {
  padding: var(--mv) 1.8em var(--mv) 1.6em;
}

.profile {
  text-align: center;
}

.profile.is-left {
  text-align: left;
}

/*
 * 侧栏里头像竖排在姓名上方，保留文档流定位：
 * 向下拖拽靠 margin-bottom 把姓名等量推开。
 */
.profile .r-avatar {
  position: static;
  transform: translate(var(--avatar-dx, 0mm), var(--avatar-dy, 0mm));
  margin: 0 auto calc(0.85em + var(--avatar-extra-h, 0mm));
}

.profile.is-left .r-avatar {
  margin: 0 0 calc(0.85em + var(--avatar-extra-h, 0mm));
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

.is-rail .main .r-sec:first-child {
  margin-top: 0;
}

/* ---------------- 双栏 ---------------- */

.is-split {
  gap: 1.6em;
  margin-top: 1.15em;
}

.is-split .side {
  --body-indent: 0;
  flex: 0 0 var(--rail-w, 34%);
  padding-right: 1.4em;
}

.is-split.has-divider .side {
  border-right: 1px solid rgba(var(--accent-rgb), 0.28);
}

.is-split .wide {
  flex: 1 1 auto;
  min-width: 0;
}

.is-split .r-sec:first-child {
  margin-top: 0;
}

/* 窄栏改为单列，避免信息被挤压 */
.is-split .side :deep(.r-info-grid),
.is-split .side :deep(.r-bars) {
  grid-template-columns: 1fr;
  gap: 0.6em;
}

/* ---------------- 卡片化模块 ---------------- */

.has-cards .r-sec {
  padding: 0.8em 1.1em 0.95em;
  background: rgba(var(--accent-rgb), 0.045);
  border: 1px solid rgba(var(--accent-rgb), 0.13);
  border-radius: 0.5em;
}

/* 深色栏里的卡片换成白色透明底，保持层次 */
.has-cards .rail .r-sec {
  padding: 0.7em 0.9em 0.8em;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
}
</style>
