<script setup>
/**
 * 合集卡片：迷你 A4 实时预览 + 摘要信息。
 *
 * 预览复用真实模板组件，与编辑器/分享页同一套渲染管线；
 * 挂载即拉取分享数据（每页至多 12 份小体积 JSON，个人站规模无压力），
 * 缩放走 paper.css 的 zoom: var(--zoom) 约定。多页简历只露首页做封面。
 * 整卡是跳转分享只读页的链接，预览层不响应指针。
 */
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { MM_TO_PX, PAGE, TEMPLATES } from '@/data/presets'
import { resolveTemplate } from '@/templates'
import { computePageStyle } from '@/utils/resumeStyle'
import { fetchShare } from '@/utils/shareApi'

const props = defineProps({
  /** /api/collection 条目：{ id, name, jobTitle, template, accent, createdAt } */
  item: { type: Object, required: true },
})

const viewportRef = useTemplateRef('viewportRef')
const resume = shallowRef(null)
const state = shallowRef('loading') // loading | ready | error
const zoom = shallowRef(0)

const templateComponent = computed(() =>
  resume.value ? resolveTemplate(resume.value.template) : null,
)
const pageStyle = computed(() =>
  resume.value
    ? { ...computePageStyle(resume.value), '--zoom': zoom.value }
    : { '--zoom': zoom.value },
)

const templateName = computed(
  () => TEMPLATES.find((t) => t.id === props.item.template)?.name || '自定义模板',
)
const dateText = computed(() => formatDay(props.item.createdAt))

/** 创建时间只露日期部分 */
function formatDay(timestamp) {
  const d = new Date(timestamp)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 卡片宽度换算纸张缩放，容器变化时跟随 */
function fit() {
  const el = viewportRef.value
  if (!el) return
  zoom.value = Math.max(0.1, el.clientWidth / (PAGE.width * MM_TO_PX))
}

let resizeObserver = null

onMounted(() => {
  resizeObserver = new ResizeObserver(fit)
  resizeObserver.observe(viewportRef.value)
  fit()
  load()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

async function load() {
  try {
    const data = await fetchShare(props.item.id)
    resume.value = data.resume
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}
</script>

<template>
  <router-link
    class="cc-card"
    :to="{ name: 'share', params: { id: item.id } }"
    :title="`查看 ${item.name || '这份简历'}`"
  >
    <div ref="viewportRef" class="cc-viewport">
      <div
        v-if="state === 'ready' && resume"
        class="paper cc-paper"
        :style="pageStyle"
        :data-tstyle="resume.theme.titleStyle"
        :data-marker="resume.theme.titleMarker"
        :data-line="resume.theme.titleBottom"
        :data-shape="resume.basics.avatarShape"
      >
        <component :is="templateComponent" :resume="resume" :selected-ids="[]" />
      </div>

      <div v-else-if="state === 'error'" class="cc-hold">
        <SvgIcon name="image" :size="18" />
        <span>预览暂不可用，点击查看</span>
      </div>

      <div v-else class="cc-hold is-loading">
        <SvgIcon name="layout" :size="18" />
        <span>加载预览…</span>
      </div>
    </div>

    <div class="cc-meta">
      <div class="cc-row">
        <span class="cc-name">{{ item.name || '未署名简历' }}</span>
        <SvgIcon class="cc-go" name="eye" :size="14" />
      </div>
      <div class="cc-row">
        <span class="cc-job">{{ item.jobTitle || '求职意向待补充' }}</span>
      </div>
      <div class="cc-foot">
        <span class="cc-chip">{{ templateName }}</span>
        <span class="cc-date">{{ dateText }}</span>
      </div>
    </div>
  </router-link>
</template>

<style scoped>
.cc-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  overflow: hidden;
  text-decoration: none;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.cc-card:hover,
.cc-card:focus-visible {
  transform: translateY(-2px);
  border-color: var(--ed-line-2);
  box-shadow: var(--ed-shadow-lg);
}

/* 预览视口固定 A4 纵横比，点阵背景与编辑器舞台一致 */
.cc-viewport {
  aspect-ratio: 210 / 297;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow: hidden;
  background-color: var(--ed-fill);
  background-image: radial-gradient(rgba(16, 24, 40, 0.075) 1px, transparent 1.6px);
  background-size: 24px 24px;
}

.cc-paper {
  flex: 0 0 auto;
  box-shadow: var(--ed-paper-shadow);
}

/* 预览壳层禁止响应指针，交互统一交给整卡链接 */
.cc-paper :deep(*) {
  pointer-events: none;
}

.cc-hold {
  flex: 1 1 auto;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ed-text-4);
  font-size: 12px;
}

.cc-hold.is-loading {
  color: var(--ed-text-3);
}

.cc-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px 11px;
  border-top: 1px solid var(--ed-line-soft);
}

.cc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cc-name {
  color: var(--ed-ink);
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cc-go {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--ed-text-4);
  transition: color 0.18s ease;
}

.cc-card:hover .cc-go {
  color: var(--ed-brand-strong);
}

.cc-job {
  color: var(--ed-text-2);
  font-size: 12.5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
}

.cc-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 11px;
  white-space: nowrap;
}

.cc-date {
  color: var(--ed-text-4);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
