<script setup lang="ts">
/**
 * 体检弹窗：完成度评分 + 按严重度分级的问题清单。
 * 检查逻辑在 utils/completeness.js（纯函数），这里只做展示与「带我去改」。
 *
 * 「带我去改」一个关键点：体检的价值不在于告诉人「有 7 个问题」，
 * 而在于把人直接送到出问题的那一处。原来的弹窗只给一句描述，
 * 用户还得自己在 6 个模块里找 —— 那正是这类功能做完没人用的原因。
 * 跳转复用 usePaperJump：它已经会切到「内容」页签、展开卡片、滚到位置并闪一下。
 */
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { usePaperJump } from '@/composables/usePaperJump'
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

/**
 * 体检结果：打开弹窗时算一次。
 *
 * 显式声明形状：checkResume 还在 JS 里（utils/completeness.js），
 * shallowRef(null) 会被推成 Ref<null>，模板里读 report.score 就报 never。
 * 就近声明所需形状，比为了一个返回值去转整个 300 行的规则文件更划算。
 */
interface CompletenessReport {
  score: number
  counts: { error: number; warn: number; tip: number }
  /** 未修复问题总处数（不受同名合并影响），顶栏角标与这里共用口径 */
  total: number
  issues: {
    level: 'error' | 'warn' | 'tip'
    title: string
    detail: string
    /** 该问题属于哪个模块；缺省表示没有单一落点 */
    sectionId?: string
    /** 'basics' 表示落到右侧面板顶部的「基本信息」 */
    target?: 'basics'
  }[]
}

const report = shallowRef<CompletenessReport | null>(null)

const { focusSection } = usePaperJump()

watch(
  () => props.open,
  (open) => {
    if (open) report.value = checkResume(store.resume) as CompletenessReport
  },
)

/**
 * 「去修改」：只对有落点的问题显示按钮。
 *
 * 没有落点的问题（例如「多数要点缺少量化数据」分散在多个模块里）不显示按钮 ——
 * 一个点了没反应的按钮比没有按钮更糟。
 */
function issueTarget(issue: CompletenessReport['issues'][number]): 'basics' | string | null {
  if (issue.target === 'basics') return 'basics'
  if (issue.sectionId) return issue.sectionId
  return null
}

function goFix(issue: CompletenessReport['issues'][number]): void {
  const target = issueTarget(issue)
  if (!target) return
  emit('close')
  if (target === 'basics') {
    /*
     * 基本信息不是「模块」，usePaperJump 只认模块 id。
     * 这里滚到面板顶部即可 —— 基本信息永远在内容页签的最上面。
     */
    document.querySelector('.editor-panel')?.scrollTo?.({ top: 0, behavior: 'smooth' })
    return
  }
  focusSection(target)
}

/**
 * 评分的一句话解读。
 *
 * 原则：说「下一步做什么」，不说「你做得怎么样」。
 * 原先的「完成度很好 / 更有竞争力 / 投递前微调」都是评价，读完不知道该干点什么；
 * 现在每档都带一个具体动作，且数字来自真实的计数，不是形容词。
 */
const scoreText = computed(() => {
  const r = report.value
  if (!r) return ''
  const { error, warn } = r.counts
  if (error > 0) return `有 ${error} 处会影响阅读的硬伤，先把它们补上`
  if (warn > 0) return `主体完整，还有 ${warn} 处建议补充，逐条改完可信度会明显不同`
  if (r.counts.tip > 0) return `没有硬伤。下面 ${r.counts.tip} 条是可选的优化，时间够再改`
  return '没有发现问题。投递前建议再对照目标岗位的通告看一遍关键词'
})

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
              <span class="ck-score-desc">{{ scoreText }}</span>
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
              <!-- 只对有落点的问题给按钮：点了没反应比没有按钮更糟 -->
              <button v-if="issueTarget(issue)" class="ed-btn ck-go" @click="goFix(issue)">
                <span>去修改</span>
                <SvgIcon name="redo" :size="12" />
              </button>
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
  background: var(--ed-overlay);
}

.ck-card {
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
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
  border-radius: var(--ed-radius-sm);
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
  border-radius: var(--ed-radius-lg);
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
  flex: 1 1 auto;
  min-width: 0;
}

/*
 * 「去修改」按钮：靠右、次按钮样式、命中区 ≥24px。
 * 它比问题描述更弱一级（dashed 边、无阴影），因为它是辅助动作而不是主操作 ——
 * 主操作永远是「先把内容写好」，不是「把分数刷上去」。
 */
.ck-go {
  flex: 0 0 auto;
  align-self: flex-start;
  min-height: 24px;
  padding: 2px 8px;
  border-style: dashed;
  box-shadow: none;
  color: var(--ed-text-2);
  font-size: 12px;
}

.ck-go:hover {
  border-style: solid;
  color: var(--ed-ink);
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
