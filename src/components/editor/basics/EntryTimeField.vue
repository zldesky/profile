<script setup lang="ts">
/**
 * 经历时间的输入控件。
 *
 * 为什么不继续用自由文本框：用户在同一个框里会写出 `2022.6`、`2022年6月`、`22/6`、
 * `2022-06-15` 四种格式，它们并排出现在一张简历上就显得业余；
 * 而 PDF 导入、Markdown 导入还会带进来别的写法。
 *
 * 为什么不**强制**结构化：简历里有「大学期间」「2019 上半年」这类真实且合理的写法。
 * 强行改成月份等于替用户编了一段时间。所以这里分三种状态：
 *
 *   empty      → 显示空的年月选择器
 *   structured → 预填选择器，改动即写回 `YYYY-MM - YYYY-MM`
 *   freeform   → **原样保留文本框**，并给一个「改成选择年月」的入口让用户自己决定
 *
 * 一句话原则：**帮用户把常见情况写对，但不夺走他对内容的决定权。**
 */
import { computed, shallowRef, watch } from 'vue'

import BaseSelect from '@/components/BaseSelect.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import {
  MONTH_OPTIONS,
  fromPickerValue,
  readTimeInput,
  toPickerValue,
  yearOptions,
} from '@/utils/entryTime'
import type { TimePickerValue } from '@/utils/entryTime'

const props = defineProps<{
  /** 存储用的时间字符串（entry.time） */
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const YEARS = yearOptions()
const YEAR_OPTIONS = YEARS.map((year) => ({ value: String(year), label: `${year}` }))
const MONTH_OPTIONS_UI = MONTH_OPTIONS.map((month) => ({
  value: String(month),
  label: `${month} 月`,
}))

/**
 * 用户显式选择的填写方式。
 *
 * 为什么不能只靠 `readTimeInput` 推断：点「自由填写」时，当前值往往**仍然可解析**
 * （例如 `2022-06 - 至今`），于是按内容推断会立刻又切回选择器 ——
 * 用户点了按钮却什么都没发生。这是真实存在过的 bug，
 * 由 tools/verify-time-field.mjs 抓到。
 *
 *   auto   ：按内容推断（默认，也是撤销 / 切换文档后的状态）
 *   picker ：用户明确选择年月
 *   free   ：用户明确选择自由填写
 */
const mode = shallowRef<'auto' | 'picker' | 'free'>('auto')

/** 我们自己最后一次写出的值。用于区分「外部改动」（撤销、导入）与「本地输入」 */
const lastEmitted = shallowRef<string | null>(null)

const state = computed(() => {
  if (mode.value === 'free') return { kind: 'freeform' as const }
  return readTimeInput(props.modelValue)
})

/**
 * 外部改动（撤销、切换文档、导入）后回到自动推断。
 * 判断依据是「值不是我们刚写出的那个」—— 只看值变化会在每次输入时误重置。
 */
watch(
  () => props.modelValue,
  (next) => {
    if (lastEmitted.value !== null && next === lastEmitted.value) return
    mode.value = 'auto'
  },
)

function write(value: string): void {
  lastEmitted.value = value
  emit('update:modelValue', value)
}

/**
 * 空取值常量。
 *
 * 必须定义在 `value` 之前：`computed` 第一次求值时会读它，
 * 而那个求值发生在 setup 执行期间（模板渲染前），
 * 定义在后面会直接踩到 TDZ（Cannot access before initialization）。
 */
const EMPTY_PICKER: TimePickerValue = {
  startYear: null,
  startMonth: null,
  endYear: null,
  endMonth: null,
  ongoing: false,
}

/** 当前取值：结构化时来自字符串，空时是全空 */
const value = computed<TimePickerValue>(() =>
  state.value.kind === 'structured' ? toPickerValue(state.value.range) : { ...EMPTY_PICKER },
)

/**
 * 改动任意一段后重新拼字符串。
 *
 * 注意这里**不做「开始晚于结束」的校验**。
 * 逆序时间在简历里是允许的（写错、或者确实有特殊情况），
 * 静默改掉用户的值比留一个看起来不对的值更糟 —— 体检里的时间重叠检查会提示，
 * 那才是该提示的地方。
 */
function patch(next: Partial<TimePickerValue>): void {
  write(fromPickerValue({ ...value.value, ...next }))
}

function onStartYear(raw: string): void {
  patch({ startYear: raw ? Number(raw) : null })
}
function onStartMonth(raw: string): void {
  patch({ startMonth: raw ? Number(raw) : null })
}
function onEndYear(raw: string): void {
  patch({ endYear: raw ? Number(raw) : null })
}
function onEndMonth(raw: string): void {
  patch({ endMonth: raw ? Number(raw) : null })
}
/** 勾选「至今」时一并清掉结束时间，避免留下自相矛盾的数据 */
function onOngoing(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  patch({ ongoing: checked, ...(checked ? { endYear: null, endMonth: null } : {}) })
}

/** 自由写法下改成结构化：把能认出来的年份预填进去，剩下的交给用户 */
function switchToPicker(): void {
  mode.value = 'picker'
  const range = readTimeInput(props.modelValue)
  if (range.kind === 'structured') {
    // 已经能解析：原地换成选择器即可，值不用动
    return
  }
  const year = Number(String(props.modelValue).match(/\d{4}/)?.[0])
  write(fromPickerValue({ ...EMPTY_PICKER, startYear: Number.isFinite(year) ? year : null }))
}

/**
 * 结构化写法下改回自由文本：把当前区间拼成一句话填进文本框，用户接着改。
 *
 * `mode` 必须先切到 'free'：否则写出的仍是可解析的 `2022-06 - 至今`，
 * 推断逻辑会立刻把它判回 structured，按钮看起来毫无反应（真实发生过的 bug）。
 */
function switchToFreeform(): void {
  mode.value = 'free'
  write(fromPickerValue(value.value))
}
</script>

<template>
  <div class="et-wrap">
    <!-- 自由写法：原样保留，不夺走用户的内容 -->
    <div v-if="state.kind === 'freeform'" class="et-row">
      <input
        class="ed-input"
        :value="modelValue"
        placeholder="如 大学期间"
        @input="write(($event.target as HTMLInputElement).value)"
      />
      <button class="ed-icon-btn" title="改成按年月选择" @click="switchToPicker">
        <SvgIcon name="clock" :size="14" />
      </button>
    </div>

    <!-- 空或结构化：年月选择器 -->
    <template v-else>
      <!--
        两行式布局：开始一行、结束一行。
        一开始写成单行 4 个控件，在 300px 宽的面板里会把「至今」挤到第二行、
        而破折号留在第一行末尾 —— 截图一眼就看出来不对。
        分两行既不会挤，也让「起点 / 终点」的关系更清楚。
      -->
      <div class="et-grid">
        <span class="et-tag">开始</span>
        <div class="et-cell">
          <BaseSelect
            class="et-select"
            dense
            :model-value="value.startYear ? String(value.startYear) : ''"
            :options="YEAR_OPTIONS"
            placeholder="年"
            @update:model-value="onStartYear(String($event ?? ''))"
          />
          <BaseSelect
            class="et-select et-month"
            dense
            :model-value="value.startMonth ? String(value.startMonth) : ''"
            :options="MONTH_OPTIONS_UI"
            placeholder="月"
            @update:model-value="onStartMonth(String($event ?? ''))"
          />
        </div>

        <span class="et-tag">结束</span>
        <div class="et-cell">
          <template v-if="!value.ongoing">
            <BaseSelect
              class="et-select"
              dense
              :model-value="value.endYear ? String(value.endYear) : ''"
              :options="YEAR_OPTIONS"
              placeholder="年"
              @update:model-value="onEndYear(String($event ?? ''))"
            />
            <BaseSelect
              class="et-select et-month"
              dense
              :model-value="value.endMonth ? String(value.endMonth) : ''"
              :options="MONTH_OPTIONS_UI"
              placeholder="月"
              @update:model-value="onEndMonth(String($event ?? ''))"
            />
          </template>
          <span v-else class="et-ongoing">至今</span>
        </div>
      </div>

      <div class="et-foot">
        <label class="ed-toggle et-check">
          <input class="ed-check" type="checkbox" :checked="value.ongoing" @change="onOngoing" />
          <span>至今</span>
        </label>
        <button class="et-link" title="改成自由填写，如「大学期间」" @click="switchToFreeform">
          自由填写
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.et-wrap {
  flex: 1 1 auto;
  min-width: 0;
}

.et-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

/*
 * 两行：标签列固定宽、控件列自适应。
 * 用 grid 而不是 flex，是为了让「开始 / 结束」两个标签右对齐成一列 ——
 * 手写 padding 对齐在换字体后就会错开。
 */
.et-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px 8px;
}

.et-tag {
  color: var(--ed-text-3);
  font-size: 12px;
  white-space: nowrap;
}

.et-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

/*
 * 选择器宽度：年份放得下四位数字，月份放得下「12 月」。
 * 用固定宽度而不是 flex:1，是因为两个控件平分时年份会被压到看不清。
 */
.et-select {
  width: 88px;
}

.et-month {
  width: 76px;
}

.et-ongoing {
  padding: 4px 8px;
  border-radius: var(--ed-radius-xs);
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 12px;
}

.et-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.et-check {
  margin: 0;
  font-size: 12px;
}

/* 「自由填写」是低频出口，做成文字按钮，不占视觉重量 */
.et-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ed-text-3);
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
}

.et-link:hover {
  color: var(--ed-ink);
}

@media (max-width: 480px) {
  /* 窄屏把选择器放宽一点，手指更容易点中 */
  .et-select {
    flex: 1 1 auto;
    width: auto;
    min-width: 72px;
  }

  .et-month {
    flex: 0 0 76px;
  }
}
</style>
