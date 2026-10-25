<script setup lang="ts">
/**
 * 通用下拉框（自绘菜单版）。
 *
 * 历史与现状：v1 刻意保留原生 `<select>`（键盘、移动端、无障碍都现成），只统一外观。
 * 但弹开的**选项列表由操作系统绘制** —— 灰底、系统字号、宽度=触发器宽度，
 * 无法与站内菜单（「导入 / 导出数据」那种白底、圆角、阴影、悬停反馈）统一，
 * 长选项还会被触发器宽度挤得很难看。本轮按用户要求把列表改成自绘菜单，
 * 样式与 .export-menu 同源；触发器外观保持原样（.bsel-input 一套类名不变，
 * 外部按它写的宽度规则不受影响）。
 *
 * 原生 select 送掉的键盘与语义，这里自己补齐：
 *  - 触发器 role=combobox + aria-expanded + aria-label；
 *  - 菜单 role=listbox + aria-activedescendant，打开即聚焦菜单容器；
 *  - ↑↓ 移动活跃项（跳过禁用项）、Home/End 到头尾、Enter/Space 选中、
 *    Esc 关闭并把焦点还给触发器、Tab 直接关闭；
 *  - 点击外部、面板滚动、窗口缩放都会关闭（滚动监听排除菜单自身）。
 *
 * 定位用 fixed + Teleport 到 body：面板是 overflow 滚动容器，absolute 菜单
 * 会被裁剪；fixed 不受裁剪，但要自己算坐标 —— 宽度取「最长选项的自然宽度与
 * 触发器宽度较大者」（封顶 360px），上下空间不够时翻转到另一侧，左右贴边时
 * 收进视口。菜单打开后如果发生滚动直接关闭，不跟随重算（原生 select 同款行为）。
 */
import { computed, nextTick, onBeforeUnmount, shallowRef, useId, useTemplateRef, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'

/** 一个选项。value 允许 undefined —— 见下面「空值占位项」的说明 */
export interface SelectOption {
  value: string | number | undefined
  label: string
  disabled?: boolean
}

/** 一组选项；有 label 时在菜单里渲染成组标题 */
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
 * 「字体（可选）」）。DOM 层把它写成空字符串，change 时再还原成 undefined；
 * 标签由调用点决定，组件不替它定（各处的说法本来就不一样）。
 */
const EMPTY = ''
const hasUndefinedOption = computed(
  () => !isGrouped.value && items.value.some((o) => o.value === undefined),
)

/** DOM 层的值：undefined 与空字符串都表现为空字符串 */
const domValue = (v: string | number | undefined) => (v === undefined || v === null ? EMPTY : v)

const current = computed(() => domValue(props.modelValue))

/** 菜单用的扁平列表：分组展开，记住每项属于哪组（渲染组标题用） */
const flat = computed(() =>
  isGrouped.value
    ? groups.value.flatMap((g) => g.items.map((o) => ({ ...o, group: g.label })))
    : items.value.map((o) => ({ ...o, group: undefined as string | undefined })),
)

const currentLabel = computed(() => {
  const hit = flat.value.find((o) => domValue(o.value) === current.value)
  if (hit) return hit.label
  if (!props.options.length && props.placeholder) return props.placeholder
  return current.value === EMPTY ? '' : String(current.value)
})

function choose(option: { value: string | number | undefined; disabled?: boolean }) {
  if (option.disabled) return
  const raw = domValue(option.value)
  // 仅当该下拉确实有 undefined 选项时才还原，避免把「真的空字符串」误变成 undefined
  const next = raw === EMPTY && hasUndefinedOption.value ? undefined : raw
  emit('update:modelValue', next)
  emit('change', next)
  close(true)
}

/* ---------------- 开合与定位 ---------------- */

const triggerRef = useTemplateRef<HTMLButtonElement>('triggerRef')
const menuRef = useTemplateRef<HTMLDivElement>('menuRef')
const open = shallowRef(false)
const placed = shallowRef(false)
/** 菜单的 fixed 定位与尺寸；未定位前置空（is-placing 隐藏，先量后摆） */
const pos = shallowRef<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
/** 键盘活跃项（flat 下标）；-1 表示还没有 */
const activeIndex = shallowRef(-1)
const menuId = useId()
const activeId = computed(() =>
  activeIndex.value >= 0 ? `${menuId}-opt-${activeIndex.value}` : undefined,
)

const selectedIndex = computed(() =>
  flat.value.findIndex((o) => domValue(o.value) === current.value),
)

function openMenu(): void {
  if (props.disabled || open.value) return
  open.value = true
  placed.value = false
  activeIndex.value = selectedIndex.value
  document.addEventListener('pointerdown', onDocPointerDown, true)
  window.addEventListener('scroll', onWinScroll, true)
  window.addEventListener('resize', onWinScroll)
  void nextTick(() => {
    place()
    /*
     * 焦点必须在 place() 的渲染**落地之后**再给：place 改状态与 DOM 更新之间
     * 隔着一帧，菜单此刻还是 is-placing（visibility:hidden）—— 隐藏元素
     * focus() 会静默失败（实测：焦点留在触发器上，Escape 永远关不掉菜单，
     * 下一次点击被 toggle 理解成「关闭」）。InlineEditor 的两帧确认是同一个坑。
     */
    void nextTick(() => {
      menuRef.value?.focus({ preventScroll: true })
      scrollActiveIntoView()
    })
  })
}

function close(refocus = false): void {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  window.removeEventListener('scroll', onWinScroll, true)
  window.removeEventListener('resize', onWinScroll)
  if (refocus) triggerRef.value?.focus({ preventScroll: true })
}

function toggle(): void {
  open.value ? close() : openMenu()
}

/** 量触发器与菜单的自然尺寸，算出 fixed 坐标（先摆隐藏菜单再定位，同 InlineEditor） */
function place(): void {
  const trigger = triggerRef.value
  const menu = menuRef.value
  if (!trigger || !menu) return
  const rect = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 自然宽度按「菜单自身内容」量（is-placing 状态下 width:max-content、不限高）
  const naturalW = menu.offsetWidth
  const naturalH = menu.scrollHeight
  const maxW = Math.min(360, vw - 16)
  const width = Math.max(Math.min(rect.width, maxW), Math.min(naturalW, maxW))
  const spaceBelow = vh - 8 - (rect.bottom + 6)
  const spaceAbove = rect.top - 14
  // 下方放不下（含长列表的 288 上限）且上方更宽裕时翻转
  const flip = spaceBelow < Math.min(naturalH, 200) && spaceAbove > spaceBelow
  const maxHeight = Math.max(120, Math.min(naturalH, 288, flip ? spaceAbove : spaceBelow))
  let left = rect.left
  if (left + width > vw - 8) left = rect.right - width
  left = Math.max(8, left)
  const top = flip ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6

  pos.value = { left: Math.round(left), top: Math.round(top), width: Math.round(width), maxHeight }
  placed.value = true
}

function scrollActiveIntoView(): void {
  if (activeIndex.value < 0) return
  menuRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
}

/* ---------------- 键盘与外部关闭 ---------------- */

function moveActive(step: 1 | -1 | 'first' | 'last'): void {
  const list = flat.value
  if (!list.length) return
  const enabled = list.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  if (!enabled.length) return
  let next: number
  if (step === 'first') next = enabled[0]
  else if (step === 'last') next = enabled[enabled.length - 1]
  else {
    const at = enabled.indexOf(activeIndex.value)
    const from = at === -1 ? (step === 1 ? -1 : 0) : at
    next = enabled[(from + step + enabled.length) % enabled.length]
  }
  activeIndex.value = next
  void nextTick(scrollActiveIntoView)
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    moveActive('first')
  } else if (event.key === 'End') {
    event.preventDefault()
    moveActive('last')
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const hit = flat.value[activeIndex.value]
    if (hit) choose(hit)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  } else if (event.key === 'Tab') {
    close()
  }
}

/** 触发器上的键盘：Enter/Space/方向键打开；菜单开着时 Esc 收起并还焦点 */
function onTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return
  if (open.value && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    openMenu()
  }
}

function onDocPointerDown(event: PointerEvent): void {
  if (!open.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  /*
   * 菜单 Teleport 到 body，不在 .bsel 子树里 —— 两处都要豁免：
   * 点菜单选项时 pointerdown 先于 click，这里若把它当「外部」关掉，
   * 菜单先卸载、click 落空，选项永远点不中（E8 同族：接好了但跑不起来）。
   */
  if (menuRef.value?.contains(target)) return
  if (triggerRef.value?.parentElement?.contains(target)) return
  close()
}

/** 任何滚动（含面板内滚动，capture 才收得到）都关闭；菜单自己滚动不算 */
function onWinScroll(event: Event): void {
  if (!open.value) return
  const target = event.target
  if (target instanceof Node && menuRef.value?.contains(target)) return
  close()
}

watch(open, (isOpen) => {
  if (!isOpen) pos.value = null
})

onBeforeUnmount(() => close())

function onTriggerClick(): void {
  if (props.disabled) return
  toggle()
}
</script>

<template>
  <span class="bsel" :class="{ 'is-dense': dense, 'is-disabled': disabled, 'is-open': open }">
    <button
      ref="triggerRef"
      type="button"
      class="bsel-input bsel-trigger"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-controls="open ? menuId : undefined"
      :aria-label="ariaLabel || undefined"
      :disabled="disabled"
      @click="onTriggerClick"
      @keydown="onTriggerKeydown"
    >
      <span class="bsel-value">{{ currentLabel }}</span>
      <SvgIcon class="bsel-chevron" name="down" :size="14" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        :id="menuId"
        ref="menuRef"
        class="bsel-menu"
        :class="{ 'is-placing': !placed, 'is-dense': dense }"
        role="listbox"
        :aria-activedescendant="activeId"
        :aria-label="ariaLabel || undefined"
        tabindex="-1"
        :style="
          placed
            ? {
                left: `${pos?.left}px`,
                top: `${pos?.top}px`,
                width: `${pos?.width}px`,
                maxHeight: `${pos?.maxHeight}px`,
              }
            : undefined
        "
        @keydown="onMenuKeydown"
      >
        <template v-for="(option, i) in flat" :key="`${i}-${String(option.value)}`">
          <div
            v-if="option.group && (i === 0 || flat[i - 1].group !== option.group)"
            class="bsel-group"
          >
            {{ option.group }}
          </div>
          <button
            :id="`${menuId}-opt-${i}`"
            type="button"
            class="bsel-option"
            role="option"
            :aria-selected="domValue(option.value) === current"
            :data-value="domValue(option.value)"
            :data-active="i === activeIndex ? 'true' : undefined"
            :disabled="option.disabled"
            @click="choose(option)"
            @mouseenter="!option.disabled && (activeIndex = i)"
          >
            {{ option.label }}
          </button>
        </template>
        <div v-if="!flat.length" class="bsel-empty">{{ placeholder || '暂无可选项' }}</div>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
/*
 * 箭头用 SvgIcon（name="down"，与项目其它箭头同一套路径）而不是背景图：
 * 背景图在禁用态、不同字号下要各自补规则，而图标作为独立元素只需一条 color。
 * 触发器是 <button>（自绘菜单的开关），appearance 由浏览器重置为按钮样式，
 * 这里显式还原成与 v1 原生 select 相同的外观，外部按 .bsel-input 写的宽度规则不受影响。
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
   * 里面的触发器又是 width: 100%（依赖容器宽度）—— 互相依赖成环，**塌成 0 宽**。
   * 实测设计面板的字体下拉就是这样整个消失的（宽 0），
   * 而类型检查与静态审计都不会报。
   */
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.bsel-input {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    background-color 0.15s;
}

/* 当前值占满一行，箭头固定在右缘 */
.bsel-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.bsel-chevron {
  flex: 0 0 auto;
  margin-right: -14px;
  color: var(--ed-text-3);
  pointer-events: none;
  transition:
    transform 0.15s,
    color 0.15s;
}

.bsel.is-open .bsel-chevron {
  transform: rotate(180deg);
  color: var(--ed-text-2);
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

/*
 * 自绘菜单：与「导入 / 导出数据」菜单（.export-menu）同一套视觉语言 ——
 * 白底、细边、圆角、大阴影；选项悬停浅灰、选中品牌浅底。
 * fixed 定位（Teleport 到 body），坐标与翻转在 place() 里算。
 */
.bsel-menu {
  position: fixed;
  z-index: 110;
  min-width: 120px;
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-md);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
}

/* 尚未量完尺寸：占位但不可见（宽度按内容自然铺开，供 place() 量） */
.bsel-menu.is-placing {
  visibility: hidden;
  max-height: none !important;
  width: max-content !important;
}

.bsel-group {
  padding: 6px 10px 2px;
  color: var(--ed-text-4);
  font-size: 11px;
}

.bsel-option {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ed-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.bsel-option:hover:not(:disabled),
.bsel-option[data-active='true'] {
  background: var(--ed-fill-2);
}

.bsel-option[aria-selected='true'] {
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-weight: 600;
}

.bsel-option:disabled {
  color: var(--ed-text-4);
  cursor: not-allowed;
}

.bsel-empty {
  padding: 8px 10px;
  color: var(--ed-text-4);
  font-size: 12px;
}

/*
 * iOS 在聚焦 font-size 小于 16px 的输入控件时会自动放大整个页面。
 * 触发器是 button（聚焦不缩放页面，但 13px 在手机上太小），菜单选项同理；
 * 这两条必须写在组件内部：scoped 规则带 [data-v-*]，优先级高于外部全局媒体查询。
 * is-dense 变体要一起提 —— 它是 3 个类的选择器（0,3,0），比单类高（B4 同族）。
 */
@media (max-width: 900px) {
  .bsel .bsel-input,
  .bsel.is-dense .bsel-input {
    font-size: 16px;
  }

  .bsel-option {
    font-size: 16px;
    padding: 9px 10px;
  }
}
</style>
