<script setup lang="ts">
/**
 * 填写进度条：告诉用户「还差哪几段」，并一键跳到下一处该填的地方。
 *
 * 解决的是「右侧一个个填好麻烦」里最烦的那一半 —— **不知道还差什么**。
 * 用户看到的是一列折叠的卡片，得逐个展开才知道哪儿是空的；
 * 这个条把它变成一条可数的进度，并且点一下就到下一处。
 *
 * 判定规则刻意宽松（只看「有没有字」，不评判质量）：
 *   - 基本信息：姓名 + 至少一个联系方式；
 *   - 求职意向：求职岗位有值；
 *   - 经历类模块：至少一条非空要点；
 *   - 技能：至少一条文字描述；
 *   - 段落：有正文。
 * 质量判断交给「简历体检」，这里只负责「有没有填」。
 */
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { usePaperJump } from '@/composables/usePaperJump'
import { useResumeStore } from '@/stores/resume'
import type { Section } from '@/types/resume'

const store = useResumeStore()
const { focusSection } = usePaperJump()

const str = (value: unknown): string => String(value ?? '').trim()

/** 一个待填项：id 用于跳转，title 显示，done 表示已填 */
interface FillItem {
  id: string
  title: string
  done: boolean
}

/** 单个模块是否已有实质内容 */
function sectionFilled(section: Section): boolean {
  if (section.type === 'grid') {
    // 求职意向这类：至少有一项有值
    return section.items.some((item) => str(item.value) !== '')
  }
  if (section.type === 'entries') {
    // 经历：至少一条要点，或至少填了机构名（有的模块只需机构）
    return section.items.some(
      (entry) => entry.bullets.some((b) => str(b.text) !== '') || str(entry.org) !== '',
    )
  }
  if (section.type === 'skills') {
    return (
      section.fields.some((f) => str(f.value) !== '') ||
      section.items.some((i) => str(i.name) !== '')
    )
  }
  return str(section.content) !== ''
}

const basicsFilled = computed(
  () => Boolean(str(store.basics.name)) && store.basics.fields.some((f) => str(f.value) !== ''),
)

const items = computed<FillItem[]>(() => [
  { id: 'basics', title: '基本信息', done: basicsFilled.value },
  ...store.sections
    .filter((section) => section.visible)
    .map((section) => ({
      id: section.id,
      title: section.title,
      done: sectionFilled(section),
    })),
])

const doneCount = computed(() => items.value.filter((item) => item.done).length)
const total = computed(() => items.value.length)
const percent = computed(() =>
  total.value ? Math.round((doneCount.value / total.value) * 100) : 0,
)

/** 第一个还没填的项；全部填完则为 null */
const nextEmpty = computed(() => items.value.find((item) => !item.done) || null)

const allDone = computed(() => total.value > 0 && doneCount.value === total.value)

/**
 * 跳到下一处该填的地方。
 *
 * 基本信息不在 SectionList 的卡片里，它的锚点由 ContentPanel 的 data-section-id="basics"
 * 承载，所以这里统一用 focusSection —— 两者都走同一套「滚过去 + 闪一下」。
 */
function jumpNext() {
  const target = nextEmpty.value
  if (!target) return
  focusSection(target.id)
}
</script>

<template>
  <div class="fill-progress" :class="{ 'is-done': allDone }">
    <div class="fp-head">
      <span class="fp-title">
        <SvgIcon :name="allDone ? 'check' : 'text'" :size="13" />
        <span>{{ allDone ? '都填好了' : '还差几段' }}</span>
      </span>
      <span class="fp-count">{{ doneCount }} / {{ total }}</span>
    </div>

    <!-- 进度条本体：用原生 progress 会引入浏览器默认样式，这里自己画一条 -->
    <div
      class="fp-bar"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`填写进度 ${percent}%`"
    >
      <span class="fp-fill" :style="{ width: `${percent}%` }"></span>
    </div>

    <p v-if="!allDone" class="fp-next">
      <span>下一步：{{ nextEmpty?.title }}</span>
      <button class="fp-jump" @click="jumpNext">
        去填
        <SvgIcon name="down" :size="12" />
      </button>
    </p>
    <p v-else class="fp-next is-ok">
      内容都填了，接下来可以点「简历体检」看哪些地方还能更有说服力。
    </p>
  </div>
</template>

<style scoped>
.fill-progress {
  margin-bottom: 14px;
  padding: 10px 11px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-md);
  background: var(--ed-fill-2);
}

/* 全部填完：边框转成功色，给一个明确的「这一段结束了」的信号 */
.fill-progress.is-done {
  border-color: var(--ed-ok-line);
  background: var(--ed-ok-tint);
}

.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}

.fp-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ed-ink);
  font-size: 12.5px;
  font-weight: 600;
}

.fp-count {
  color: var(--ed-text-3);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.fp-bar {
  height: 4px;
  overflow: hidden;
  border-radius: var(--ed-radius-pill);
  background: var(--ed-fill-3);
}

.fp-fill {
  display: block;
  height: 100%;
  border-radius: var(--ed-radius-pill);
  background: var(--ed-brand);
  transition: width 0.25s ease;
}

/* 动效要能被关掉：进度条每次输入都会动，眩晕用户尤其敏感 */
@media (prefers-reduced-motion: reduce) {
  .fp-fill {
    transition: none;
  }
}

.fp-next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 0 0;
  color: var(--ed-text-2);
  font-size: 11.5px;
}

.fp-next.is-ok {
  display: block;
  color: var(--ed-ok);
  line-height: 1.6;
}

.fp-jump {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--ed-line-2);
  border-radius: var(--ed-radius-pill);
  background: var(--ed-surface);
  color: var(--ed-brand-strong);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.15s;
}

.fp-jump:hover {
  border-color: var(--ed-brand-border);
  background: var(--ed-brand-tint);
}

.fp-jump:focus-visible {
  outline: 2px solid var(--ed-brand);
  outline-offset: 1px;
}
</style>
