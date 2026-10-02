<script setup>
/**
 * 通栏色带模板。
 * 顶部满宽主色色带承载头像、姓名与联系方式，正文单栏自上而下堆叠。
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
  <div class="tpl-banner">
    <header class="band on-dark">
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
 * 色带用负外边距顶到纸张边缘（左右 + 顶部），内层再用纸张页边距把
 * 文字拉回与正文同一竖轴，形成「出血色块 + 对齐内容」的通栏效果。
 * 打印时 @page 边距接管，负外边距需归零。
 */
.band {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1.5em;
  min-height: calc(var(--avatar-h, 35mm) + var(--avatar-extra-h, 0mm) + var(--band-pad) * 2);
  /* 色带贴边后，内边距里的页边距负责让内容与下方正文左轴对齐 */
  padding: var(--band-pad) var(--mh);
  margin: calc(var(--mv) * -1) calc(var(--mh) * -1) 0;
  background: linear-gradient(150deg, var(--accent) 55%, rgba(var(--accent-rgb), 0.86));
  --band-pad: 4.5mm;
}

@media print {
  .band {
    margin: 0;
  }
}

.who {
  flex: 1 1 auto;
  min-width: 0;
  padding-left: var(--avatar-pad-left, 0);
  padding-right: var(--avatar-pad-right, 0);
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

.contact {
  margin-top: calc(0.6em * var(--gap, 1));
  /* 列数由正文可用宽度决定：头像挤到中部时可退回单列 */
  grid-template-columns: repeat(var(--contact-cols, 2), minmax(0, 1fr));
}

/* 头像默认贴住色带顶边，按内边距下移与姓名齐观感 */
.band .r-avatar {
  top: var(--band-pad);
}

/* 页头后的第一个模块不再叠加整段模块间距，色带内边距已留出呼吸空间 */
.tpl-banner .r-sec:first-of-type {
  margin-top: 0.4em;
}
</style>
