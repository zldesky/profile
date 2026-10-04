<script setup>
/**
 * 简历体检弹窗：完成度评分 + 按严重度分级的问题清单。
 * 检查逻辑在 utils/completeness.js（纯函数），这里只做打开时的即时体检与展示。
 */
import { shallowRef, useTemplateRef, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useResumeStore } from '@/stores/resume'
import { checkResume } from '@/utils/completeness'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const store = useResumeStore()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

/** 体检结果：打开弹窗时算一次 */
const report = shallowRef(null)

watch(
  () => props.open,
  (open) => {
    if (open) report.value = checkResume(store.resume)
  },
)

/** 评分的一句话解读 */
const scoreText = (score) => {
  if (score >= 90) return '完成度很好，投递前可再对照 JD 微调'
  if (score >= 70) return '主体完整，把下面的问题补一补更有竞争力'
  if (score >= 40) return '还有明显缺口，建议逐项修复后再投递'
  return '内容还很少，先从基本信息和核心经历补起'
}

/** 问题计数徽标：按级别着色 */
const levelChipText = { error: '硬伤', warn: '待补', tip: '优化' }
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ck-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="ck-card"
        role="dialog"
        aria-modal="true"
        aria-label="简历体检"
        tabindex="-1"
      >
        <div class="ck-head">
          <h3 class="ck-title">
            <SvgIcon name="check" :size="15" />
            <span>简历体检</span>
          </h3>
          <button class="ck-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <template v-if="report">
          <div class="ck-score">
            <span class="ck-score-num" :class="{ 'is-low': report.score < 70 }">
              {{ report.score }}
            </span>
            <span class="ck-score-side">
              <span class="ck-score-label">完成度评分（满分 100）</span>
              <span class="ck-score-desc">{{ scoreText(report.score) }}</span>
            </span>
          </div>

          <div v-if="report.issues.length" class="ck-counts">
            <span
              v-for="level in ['error', 'warn', 'tip']"
              :key="level"
              class="ck-count"
              :class="`is-${level}`"
            >
              {{ report.counts[level] ? `${levelChipText[level]} ${report.counts[level]}` : '' }}
            </span>
          </div>

          <ul v-if="report.issues.length" class="ck-list">
            <li v-for="issue in report.issues" :key="issue.title" class="ck-item">
              <span class="ck-dot" :class="`is-${issue.level}`" aria-hidden="true"></span>
              <div class="ck-item-body">
                <p class="ck-item-title">{{ issue.title }}</p>
                <p class="ck-item-detail">{{ issue.detail }}</p>
              </div>
            </li>
          </ul>
          <div v-else class="ed-empty">没有发现问题，这份简历已经很完整了。</div>

          <p class="ed-hint">
            体检只检查内容完整度与常见表达问题，不评价经历本身；分数仅供参考，不影响投递。
          </p>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ck-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 24, 40, 0.42);
}

.ck-card {
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.ck-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ck-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.ck-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ed-text-4);
  cursor: pointer;
}

.ck-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.ck-score {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--ed-fill-2);
}

.ck-score-num {
  color: var(--ed-brand-strong);
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.ck-score-num.is-low {
  color: var(--ed-danger-strong);
}

.ck-score-side {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ck-score-label {
  color: var(--ed-ink);
  font-size: 13px;
  font-weight: 600;
}

.ck-score-desc {
  color: var(--ed-text-2);
  font-size: 12px;
  line-height: 1.5;
}

/* 级别计数行：为空的级别不占位 */
.ck-counts {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.ck-count {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.ck-count:empty {
  display: none;
}

.ck-count.is-error {
  background: var(--ed-danger-tint);
  color: var(--ed-danger-strong);
}

.ck-count.is-warn {
  background: var(--ed-fill);
  color: var(--ed-warn);
}

.ck-count.is-tip {
  background: var(--ed-fill);
  color: var(--ed-text-2);
}

.ck-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ck-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ed-line-soft);
}

.ck-item:last-child {
  border-bottom: 0;
}

/* 级别色点：error 红、warn 琥珀、tip 灰 */
.ck-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--ed-text-4);
}

.ck-dot.is-error {
  background: var(--ed-danger-strong);
}

.ck-dot.is-warn {
  background: var(--ed-warn);
}

.ck-item-body {
  min-width: 0;
}

.ck-item-title {
  margin: 0 0 2px;
  color: var(--ed-ink);
  font-size: 13px;
  font-weight: 600;
}

.ck-item-detail {
  margin: 0;
  color: var(--ed-text-2);
  font-size: 12px;
  line-height: 1.55;
}
</style>
