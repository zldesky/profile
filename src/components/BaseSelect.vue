<script setup lang="ts">
/**
 * 通用下拉框。
 *
 * 为什么要有它：项目里原本散着 12 处原生 `<select class="ed-select">`，
 * 写法分成两派（6 处 `v-model`、6 处 `:value` + `@change`），
 * 选项来源也是三种形状（`{value,label}` 数组、字符串数组、`<optgroup>` 分组）。
 * 结果就是同一类控件在字体、内边距、箭头、禁用态上各自漂移 ——
 * 统一到一处，顺手把「带分组」和「值为 undefined 的占位项」这两种特例收进组件，
 * 而不是让每个调用点各写一遍。
 *
 * 刻意**不换掉原生 select**：原生控件在键盘操作、移动端选择器、
 * 无障碍语义上都是现成且正确的，自绘下拉要重写这一整套。
 * 这里只统一它的外观与调用方式。
 */
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'

/** 一个选项。value 允许 undefined —— 见下面「空值占位项」的说明 */
export interface SelectOption {
  value: string | number | undefined
  label: string
  disabled?: boolean
}

/** 一组选项；有 label 时渲染成 optgroup */
export interface SelectOptionGroup {
  label: string
  items: SelectOption[]
}

export type SelectOptions = SelectOption[] | SelectOptionGroup[]

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | undefined
    /** 选项：扁平数组，或带 label 的分组数组 */
    options?: SelectOptions
    /** 仅在没有选项时显示为禁用提示；有 undefined 选项时用该选项自己的标签 */
    placeholder?: string
    disabled?: boolean
    /** 紧凑版：用于表格 / 行内工具栏 */
    dense?: boolean
    ariaLabel?: string
  }>(),
  {
    modelValue: undefined,
    options: () => [],
    placeholder: '',
    disabled: false,
    dense: false,
    ariaLabel: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | undefined]
  change: [value: string | number | undefined]
}>()

/** 是否分组：看第一项有没有 items，而不是猜类型名 —— 传空数组时两种都成立 */
const isGrouped = computed(() => {
  const first = props.options?.[0]
  return Boolean(first && typeof first === 'object' && 'items' in first)
})

const groups = computed(() => (isGrouped.value ? (props.options as SelectOptionGroup[]) : []))
const items = computed(() => (isGrouped.value ? [] : (props.options as SelectOption[])))

/**
 * 值为 undefined 的选项怎么处理。
 *
 * 有些下拉需要一个「不限 / 跟随当前」的空值项（例如管理员设置里的
 * 「字体（可选）」）。原生 `<option :value="undefined">` 在 DOM 里会变成字符串
 * "undefined"，读写两个方向都不牢靠。
 *
 * 做法是**只规范化值、不改标签**：这类选项照原样渲染（标签由调用点决定，
 * 各处的说法本来就不一样），只在 DOM 层把它的 value 写成空字符串，
 * change 时再还原成 undefined。
 *
 * 早先的版本是「另渲染一个 placeholder 空值项」，那样会把调用点自己的标签顶掉
 * （实测「跟随简历当前字体」被换成了占位文案），属于多余的间接层。
 */
const EMPTY = ''
const hasUndefinedOption = computed(
  () => !isGrouped.value && items.value.some((o) => o.value === undefined),
)

/** DOM 层的值：undefined 与空字符串都表现为空字符串 */
const domValue = (v: string | number | undefined) => (v === undefined || v === null ? EMPTY : v)

const current = computed(() => domValue(props.modelValue))

function onSelect(event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  // 仅当该下拉确实有 undefined 选项时才还原，避免把「真的空字符串」误变成 undefined
  const next = raw === EMPTY && hasUndefinedOption.value ? undefined : raw
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <span class="bsel" :class="{ 'is-dense': dense, 'is-disabled': disabled }">
    <select
      class="bsel-input"
      :value="current"
      :disabled="disabled"
      :aria-label="ariaLabel || undefined"
      @change="onSelect"
    >
      <!--
        完全没有选项时补一条禁用提示：否则原生 select 会画成一个空白框，
        看不出是「没得选」还是「还没加载」。有选项时不插任何东西 ——
        undefined 选项由各调用点自己给标签（说法各处不同，组件不该替它定）。
      -->
      <option v-if="placeholder && !options.length" :value="EMPTY" disabled>
        {{ placeholder }}
      </option>

      <template v-if="isGrouped">
        <optgroup v-for="group in groups" :key="group.label" :label="group.label">
          <option
            v-for="option in group.items"
            :key="String(option.value)"
            :value="domValue(option.value)"
            :disabled="option.disabled"
          >
            {{ option.label }}
          </option>
        </optgroup>
      </template>
      <template v-else>
        <option
          v-for="option in items"
          :key="String(option.value)"
          :value="domValue(option.value)"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </template>
    </select>
    <SvgIcon class="bsel-chevron" name="down" :size="14" />
  </span>
</template>

<style scoped>
/*
 * 箭头用 SvgIcon（name="down"，与项目其它箭头同一套路径）而不是背景图：
 * 背景图在禁用态、不同字号下要各自补规则，而图标作为独立元素只需一条 color。
 * 为此 select 自身 appearance: none，右侧留出箭头的宽度。
 */
.bsel {
  position: relative;
  display: inline-flex;
  align-items: center;
  /*
   * 宽度必须显式给全，不能用默认的 flex-basis: auto。
   *
   * 原来的原生 select 直接是 flex 子项，靠 `.ed-row > *` 之类的规则拿到
   * `flex: 1 1 auto`，再加上自身的 width: 100% 就能撑开。
   * 现在多了一层 .bsel 容器：容器是 flex 子项（basis auto、自身内容宽度为 0），
   * 里面的 select 又是 width: 100%（依赖容器宽度）—— 互相依赖成环，**塌成 0 宽**。
   * 实测设计面板的字体下拉就是这样整个消失的（宽 0），
   * 而类型检查与静态审计都不会报。
   */
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.bsel-input {
  width: 100%;
  min-width: 0;
  appearance: none;
  padding: 6px 28px 6px 9px;
  border: 1px solid var(--ed-line-2);
  border-radius: var(--ed-radius-sm);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-xs);
  color: var(--ed-ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    background-color 0.15s;
}

/* 展开的原生选项列表由系统绘制，只有底色与文字色可控，这里对齐界面的浅色底 */
.bsel-input option {
  background: var(--ed-surface);
  color: var(--ed-ink);
}

.bsel-chevron {
  position: absolute;
  right: 9px;
  color: var(--ed-text-3);
  pointer-events: none;
  transition: color 0.15s;
}

.bsel-input:hover:not(:disabled) {
  border-color: var(--ed-line-3);
}

/* 选中态与其它表单控件一致：边框走品牌色，不加粗、不换底色 */
.bsel-input:focus-visible {
  border-color: var(--ed-brand-border);
  outline: 2px solid var(--ed-brand-tint);
  outline-offset: 1px;
}

.bsel-input:disabled {
  background: var(--ed-fill);
  color: var(--ed-text-4);
  cursor: not-allowed;
}

.bsel.is-dense .bsel-input {
  padding: 3px 24px 3px 7px;
  font-size: 12px;
}

.bsel.is-dense .bsel-chevron {
  right: 7px;
}

/*
 * 分组标题（optgroup 的 label）由系统绘制，无法用 CSS 完全控制，
 * 但统一压成小号、次级色，至少让中文分组名不至于比选项还抢眼。
 */
.bsel-input optgroup {
  color: var(--ed-text-3);
  font-size: 12px;
  font-style: normal;
}

.bsel-input optgroup option {
  color: var(--ed-ink);
  font-size: 13px;
}

/*
 * iOS 在聚焦 font-size 小于 16px 的输入框时会自动放大整个页面。
 * 这条必须写在组件内部：scoped 规则的选择器带 [data-v-*] 属性，
 * **优先级高于** editor.css 里那条同名的全局媒体查询，写在外面会被这里的 13px 压掉。
 *
 * is-dense 变体必须一起提：`.bsel.is-dense .bsel-input` 是 3 个类的选择器（0,3,0），
 * 比下面这条（0,1,0）高 —— 不补的话紧凑款在手机上仍是 12px，
 * 聚焦照样触发 iOS 缩放（实测：联系方式行 6 个下拉全部 12px）。
 */
@media (max-width: 900px) {
  .bsel-input,
  .bsel.is-dense .bsel-input {
    font-size: 16px;
  }
}
</style>
