<script setup lang="ts">
/**
 * 写简历向导：先定「求职类型 + 方向 + 城市」，再一键铺好骨架。
 *
 * 解决的是「右侧一个个填好麻烦」：原先新建简历要先想清楚有哪些模块、
 * 一个个添加、再逐段填。现在先回答三个问题，模块顺序、求职意向字段、
 * 技能起底与要点模板都由蓝图给出，用户只做「替换成自己的事实」这一步。
 *
 * 三条设计原则（与 README 里移除「AI 补充导入」的理由一脉相承）：
 *  1. **结构由代码决定，不由模型决定。** 模块顺序与字段来自
 *     `src/data/resumeBlueprint.ts` 的纯数据，可测试、可离线。
 *  2. **不生成假内容。** 产出的是带【】占位符的骨架，不是一份看着完整的简历。
 *  3. **可撤销。** 套用走 store 的 replaceResume（重建历史基线），
 *     但**覆盖前会先把当前内容存成历史快照**，误点也能回退。
 */
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import BaseSelect from '@/components/BaseSelect.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { usePaperJump } from '@/composables/usePaperJump'
import { useToast } from '@/composables/useToast'
import {
  CITY_TIERS,
  DIRECTIONS,
  TRACKS,
  applyBlueprintToResume,
  buildBlueprint,
  bulletTemplatesFor,
  describeBlueprint,
  trackByKey,
} from '@/data/resumeBlueprint'
import type { TrackKey } from '@/data/resumeBlueprint'
import { useResumeStore } from '@/stores/resume'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const store = useResumeStore()
const { toast } = useToast()
const { focusSection } = usePaperJump()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

const track = shallowRef<TrackKey>('social')
const direction = shallowRef('frontend')
const cityTier = shallowRef('tier1')
const city = shallowRef('')
const years = shallowRef('')
/** 是否同时清空当前内容（默认 false：只在空白简历上铺，避免误伤已写的内容） */
const replaceExisting = shallowRef(false)
const confirmOpen = shallowRef(false)

const trackOptions = TRACKS.map((item) => ({ value: item.key, label: item.label }))
const directionOptions = DIRECTIONS.map((item) => ({ value: item.key, label: item.label }))
const tierOptions = CITY_TIERS.map((item) => ({ value: item.key, label: item.label }))

const currentTrack = computed(() => trackByKey(track.value))

/**
 * 实时预览：用户改任何一项都能立刻看到「会铺出哪些模块、薪资写什么」，
 * 而不是点了「生成」之后才发现顺序不是想要的。
 */
const preview = computed(() =>
  buildBlueprint({
    track: track.value,
    direction: direction.value,
    cityTier: cityTier.value,
    city: city.value,
  }),
)

/** 当前简历里是否已有实质内容（用于提示「会覆盖」） */
const hasContent = computed(() => store.sections.length > 0 || Boolean(store.basics.name?.trim()))

const templates = computed(() => bulletTemplatesFor(track.value))

/** 每次打开重置成默认选项，并把「覆盖」开关关掉 */
watch(
  () => props.open,
  (open) => {
    if (!open) return
    replaceExisting.value = false
    confirmOpen.value = false
  },
)

/**
 * 应用骨架。
 *
 * 两条路：
 *  - 空白简历（或用户勾了「清空重来」）→ 直接套用；
 *  - 已有内容但没勾 → 先确认，因为这会**覆盖掉用户已经写的东西**。
 *    覆盖前会把当前内容存成历史快照，误点可从「我的简历 → 历史版本」回退。
 */
function apply() {
  if (hasContent.value && !replaceExisting.value) {
    confirmOpen.value = true
    return
  }
  commit()
}

function commit() {
  confirmOpen.value = false
  const blueprint = preview.value

  // 覆盖前先留档：这是「误点也能救回来」的唯一保障
  if (hasContent.value) store.sampleSnapshot(true)

  const next = applyBlueprintToResume(store.resume, blueprint)
  store.replaceResume(next)
  store.save()

  /*
   * 把用户带到「第一处该填的地方」，而不是丢回一个全是折叠卡片的列表。
   *
   * 不这么做的话，套用之后面板里是 5-6 张收起的卡片，用户还得自己找从哪开始 ——
   * 那正是这次要解决的「一个个填好麻烦」。跳到第二个模块（第一个是求职意向，
   * 已经由蓝图填好了）并展开它，视线和焦点都直接落到空白要点上。
   */
  const firstToFill = next.sections[1] || next.sections[0]
  if (firstToFill) focusSection(firstToFill.id)

  toast(
    `已按「${describeBlueprint({ track: track.value, direction: direction.value, cityTier: cityTier.value })}」铺好 ${next.sections.length} 个模块，替换【】里的内容即可`,
    4200,
  )
  emit('close')
}

/** 年限只影响提示语，不进数据 —— 不为了一个展示字段去改简历结构 */
const yearsHint = computed(() =>
  years.value.trim()
    ? `工作年限 ${years.value.trim()}：工作经历按时间倒序，最早那段可只留 1-2 条要点。`
    : '',
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="bw-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="bw-card"
        role="dialog"
        aria-modal="true"
        aria-label="写简历向导"
        tabindex="-1"
      >
        <div class="bw-head">
          <h3 class="bw-title">
            <SvgIcon name="sparkles" :size="15" />
            <span>先定方向，再铺骨架</span>
          </h3>
          <button class="bw-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <div class="bw-body">
          <p class="bw-lead">
            回答三个问题，模块顺序、求职意向与要点模板会自动铺好；
            你只需要把【】里的占位符换成自己的事实。
          </p>

          <!-- 1 求职类型：这一步决定模块顺序，是最重要的一问 -->
          <div class="bw-field">
            <span class="bw-label">你在找什么<span class="bw-req">必选</span></span>
            <BaseSelect v-model="track" :options="trackOptions" aria-label="求职类型" />
            <p class="bw-note">{{ currentTrack.hint }}</p>
          </div>

          <!-- 2 方向 -->
          <div class="bw-field">
            <span class="bw-label">求职方向</span>
            <BaseSelect v-model="direction" :options="directionOptions" aria-label="求职方向" />
          </div>

          <!-- 3 城市档位：只影响薪资默认值 -->
          <div class="bw-row">
            <div class="bw-field">
              <span class="bw-label">城市档位</span>
              <BaseSelect v-model="cityTier" :options="tierOptions" aria-label="城市档位" />
            </div>
            <div class="bw-field">
              <span class="bw-label">意向城市（可留空）</span>
              <input v-model="city" class="ed-input" placeholder="如：上海 / 杭州" />
            </div>
          </div>

          <div class="bw-field">
            <span class="bw-label">工作年限（可选，仅用于提示）</span>
            <input v-model="years" class="ed-input" placeholder="如：5 年 / 应届" />
            <p v-if="yearsHint" class="bw-note">{{ yearsHint }}</p>
          </div>

          <!-- 预览：改任何一项立刻能看到结果，不用先点了才知道 -->
          <div class="bw-preview">
            <div class="bw-preview-head">
              <span>将铺好的结构</span>
              <span class="bw-preview-count">{{ preview.sections.length }} 个模块</span>
            </div>

            <ol class="bw-steps">
              <li v-for="(section, index) in preview.sections" :key="`${section.title}-${index}`">
                <span class="bw-step-no">{{ index + 1 }}</span>
                <span class="bw-step-title">{{ section.title }}</span>
                <span class="bw-step-hint">{{ preview.hints[index]?.hint }}</span>
              </li>
            </ol>

            <p class="bw-emphasis">
              <SvgIcon name="star" :size="13" />
              <span>{{ preview.emphasis }}</span>
            </p>

            <details class="bw-details">
              <summary>看看要点该怎么写</summary>
              <ul class="bw-templates">
                <li v-for="(text, i) in templates" :key="i">{{ text }}</li>
              </ul>
            </details>

            <p class="bw-note bw-baseline">
              结构按 {{ preview.marketAsOf }} 整理的求职行情基线； 期望薪资先给区间
              {{ preview.intent.salary }}，面试时再谈。
            </p>
          </div>

          <label v-if="hasContent" class="ed-toggle bw-replace">
            <input v-model="replaceExisting" type="checkbox" class="ed-check" />
            <span>清空当前内容重来（当前内容会先存成历史版本，可回退）</span>
          </label>
        </div>

        <div class="bw-actions">
          <span class="bw-spacer"></span>
          <button class="ed-btn" @click="emit('close')">取消</button>
          <button class="ed-btn ed-btn-primary" @click="apply">
            <SvgIcon name="check" :size="14" />
            <span>{{ hasContent && !replaceExisting ? '替换当前内容' : '铺好骨架' }}</span>
          </button>
        </div>

        <ConfirmDialog
          :open="confirmOpen"
          title="替换当前内容？"
          description="当前简历里的模块与内容会被这份骨架替换掉。替换前会自动存一份历史版本，可从「我的简历 → 历史版本」恢复。"
          confirm-text="替换"
          cancel-text="先不换"
          danger
          @confirm="commit"
          @cancel="confirmOpen = false"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bw-mask {
  position: fixed;
  inset: 0;
  z-index: 86;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ed-overlay);
}

/* 与岗位对照同一套三段式：头/脚固定，只有中间滚 */
.bw-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - 40px);
  overflow: hidden;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.bw-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.bw-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.bw-close {
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

.bw-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.bw-body {
  flex: 1 1 auto;
  min-height: 0;
  padding-right: 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ed-line-3) transparent;
}

.bw-body::-webkit-scrollbar {
  width: 8px;
}

.bw-body::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--ed-line-3);
  background-clip: padding-box;
}

.bw-body::-webkit-scrollbar-thumb:hover {
  background: var(--ed-text-5);
  background-clip: padding-box;
}

.bw-body::-webkit-scrollbar-track {
  background: transparent;
}

.bw-lead {
  margin: 0 0 14px;
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.bw-field {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin-bottom: 12px;
}

.bw-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ed-text-2);
  font-size: 12.5px;
}

/* 「必选」标签：求职类型是唯一真正必须回答的一问 */
.bw-req {
  padding: 0 5px;
  border-radius: var(--ed-radius-pill);
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-size: 10.5px;
  font-weight: 600;
}

.bw-row {
  display: flex;
  gap: 10px;
}

.bw-note {
  margin: 0;
  color: var(--ed-text-3);
  font-size: 11.5px;
  line-height: 1.6;
}

/* 结构预览：编号 + 模块名 + 一句该写什么 */
.bw-preview {
  margin: 4px 0 12px;
  padding: 12px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-md);
  background: var(--ed-fill-2);
}

.bw-preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--ed-ink);
  font-size: 12.5px;
  font-weight: 600;
}

.bw-preview-count {
  color: var(--ed-text-3);
  font-size: 11.5px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.bw-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

.bw-steps li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--ed-line-soft);
}

.bw-steps li:last-child {
  border-bottom: 0;
}

.bw-step-no {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--ed-surface);
  color: var(--ed-text-3);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.bw-step-title {
  flex: 0 0 auto;
  color: var(--ed-ink);
  font-size: 12.5px;
  font-weight: 600;
}

.bw-step-hint {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ed-text-3);
  font-size: 11.5px;
  line-height: 1.5;
}

.bw-emphasis {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: var(--ed-radius-sm);
  background: var(--ed-warn-tint);
  color: var(--ed-warn);
  font-size: 12px;
  line-height: 1.6;
}

.bw-emphasis :deep(.svg-icon) {
  flex: 0 0 auto;
  margin-top: 2px;
}

.bw-details {
  margin-top: 10px;
}

.bw-details summary {
  color: var(--ed-brand-strong);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.bw-templates {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--ed-text-2);
  font-size: 12px;
  line-height: 1.7;
}

.bw-templates li {
  margin-bottom: 4px;
}

.bw-baseline {
  margin-top: 10px;
}

.bw-replace {
  margin-bottom: 4px;
}

.bw-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--ed-line-soft);
}

.bw-spacer {
  flex: 1 1 auto;
}
</style>
