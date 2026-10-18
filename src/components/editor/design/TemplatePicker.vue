<script setup lang="ts">
/**
 * 模板与风格选择（SKU 式组合约束）。
 * 缩略图是纯 CSS 画的示意图，不依赖任何图片资源；
 * 同时沿用当前主色，选模板时能一并看到配色效果。
 * 风格与兼容矩阵来自管理后台的运行时配置（useStyleConfig），
 * 未配置时回退内置默认；双向不兼容的组合置灰禁用。
 * 仍需要特殊组合时可在下方「色彩」「标题」分区手动细调。
 */
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { TEMPLATES } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'
import { useStyleConfig } from '@/composables/useStyleConfig'
import type { StylePreset, Theme } from '@/types/resume'
import type { TemplateMeta } from '@/data/presets'

const store = useResumeStore()
const styleConfig = useStyleConfig()

const thumbStyle = computed(() => ({ '--accent': store.theme.accent }))
const stylePresets = styleConfig.presets

/** 当前主题完整命中某风格预设时视为「已选风格」，作为双向约束的基准 */
const activeStyle = computed(
  () => stylePresets.value.find((preset) => isStyleActive(preset)) || null,
)

/** 模板与当前风格不兼容 → 置灰禁用 */
function isTemplateLocked(tpl: TemplateMeta) {
  const whitelist = styleConfig.stylesForTemplate(tpl.id)
  return Boolean(activeStyle.value && whitelist && !whitelist.includes(activeStyle.value.key))
}

/** 风格与当前模板不兼容 → 置灰禁用 */
function isStyleLocked(preset: StylePreset) {
  const whitelist = styleConfig.stylesForTemplate(store.resume.template)
  return Boolean(whitelist && !whitelist.includes(preset.key))
}

function selectTemplate(id: string) {
  store.resume.template = id
}

/** 套用风格预设：主题色、标题样式、标记与底边线整体切换 */
function applyStyle(preset: StylePreset) {
  store.setTheme(preset.patch)
}

/** 当前主题与预设的每个键都一致才算命中，用于高亮 */
function isStyleActive(preset: StylePreset) {
  /*
   * patch 的键是 Theme 的子集（Partial<Pick<Theme, ...>>），但 Object.entries 会把
   * 键退化回 string，于是 store.theme[key] 报「不能用 string 索引 Theme」。
   * 断言成 keyof Theme 而不是把 store.theme 放宽成 Record —— 后者会让整个主题失去类型。
   */
  return Object.entries(preset.patch).every(
    ([key, value]) => store.theme[key as keyof Theme] === value,
  )
}

/** 置灰项的悬浮说明 */
function lockedTitle(kind: 'tpl' | 'style', name: string) {
  return `「${name}」与当前${kind === 'tpl' ? '风格' : '模板'}不搭，已禁用；可在「色彩 / 标题」里手动细调出类似效果`
}
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title">
      <span>风格</span>
      <span class="ed-count">一键换气质</span>
    </div>

    <div class="style-row">
      <button
        v-for="preset in stylePresets"
        :key="preset.key"
        class="style-chip"
        :class="{ 'is-active': isStyleActive(preset), 'is-locked': isStyleLocked(preset) }"
        :disabled="isStyleLocked(preset)"
        :title="
          isStyleLocked(preset) ? lockedTitle('style', preset.name) : `套用「${preset.name}」风格`
        "
        @click="applyStyle(preset)"
      >
        <i class="style-swatch" :style="{ background: preset.swatch }"></i>
        <span>{{ preset.name }}</span>
      </button>
    </div>

    <div class="ed-group-title">
      <span>模板</span>
      <span class="ed-count">共 {{ TEMPLATES.length }} 套</span>
    </div>

    <div class="tpl-scroll">
      <div class="tpl-grid">
        <button
          v-for="tpl in TEMPLATES"
          :key="tpl.id"
          class="tpl-card"
          :class="{
            'is-active': store.resume.template === tpl.id,
            'is-locked': isTemplateLocked(tpl),
          }"
          :disabled="isTemplateLocked(tpl)"
          :title="isTemplateLocked(tpl) ? lockedTitle('tpl', tpl.name) : `切换到「${tpl.name}」`"
          @click="selectTemplate(tpl.id)"
        >
          <div class="thumb" :class="`thumb--${tpl.id}`" :style="thumbStyle">
            <div class="thumb-rail"></div>
            <div class="thumb-body">
              <div class="thumb-head"><i class="name"></i><i class="ava"></i></div>
              <div class="thumb-lines"><i class="w90"></i><i class="w65"></i></div>
              <div class="thumb-cols">
                <div class="thumb-col">
                  <i class="bt"></i><i class="ln"></i><i class="ln w65"></i>
                </div>
                <div class="thumb-col">
                  <i class="bt"></i><i class="ln"></i><i class="ln w90"></i><i class="ln w65"></i>
                </div>
              </div>
            </div>
          </div>
          <div class="tpl-meta">
            <strong>{{ tpl.name }}</strong>
            <span>{{ tpl.desc }}</span>
          </div>
          <SvgIcon
            v-if="store.resume.template === tpl.id"
            class="tpl-check"
            name="check"
            :size="14"
          />
        </button>
      </div>
    </div>

    <p class="ed-hint">
      风格管配色与标题装饰，模板管排版结构；不搭的组合已置灰，想微调可在「色彩」「标题」里手动改。
    </p>
  </div>
</template>

<style scoped>
/* 风格预设：横向滚动的胶囊条，色板圆点 + 名称 */
.style-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}

.style-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 6px;
  border: 1px solid var(--ed-fill-3);
  border-radius: 999px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  color: #475467;
  cursor: pointer;
  transition: 0.15s;
}

.style-chip:hover {
  border-color: var(--ed-line-3);
  color: var(--ed-ink);
}

.style-chip.is-active {
  border-color: var(--ed-brand);
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-weight: 600;
}

/* SKU 约束：与当前模板/风格不搭的组合置灰禁用 */
.style-chip:disabled,
.tpl-card:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: grayscale(0.85);
}

.style-chip:disabled:hover {
  border-color: var(--ed-fill-3);
  color: #475467;
}

.tpl-card:disabled:hover {
  border-color: var(--ed-fill-3);
  box-shadow: none;
}

.style-swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(16, 24, 40, 0.12);
}

.tpl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/*
 * 模板数量多时列表在固定高度内滚动，面板其余设置（配色、字体、标题）
 * 不会被推到很深的位置。约两张卡片高，第三张露出一截提示可滚动。
 */
.tpl-scroll {
  max-height: 320px;
  padding-right: 3px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--ed-line-3) transparent;
}

.tpl-scroll::-webkit-scrollbar {
  width: 6px;
}

.tpl-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.tpl-scroll::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--ed-line-3);
}

.tpl-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ed-line-3);
}

.tpl-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--ed-fill-3);
  border-radius: var(--ed-radius-md);
  background: #fff;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.15s;
}

.tpl-card:hover {
  border-color: var(--ed-line-3);
  box-shadow: 0 2px 10px rgba(20, 30, 50, 0.07);
}

.tpl-card.is-active {
  border-color: var(--ed-brand);
  box-shadow: 0 0 0 3px var(--ed-brand-ring);
}

.tpl-check {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--ed-brand-strong);
}

.tpl-meta strong {
  display: block;
  color: var(--ed-ink);
  font-size: 12.5px;
}

.tpl-meta span {
  display: block;
  margin-top: 2px;
  color: var(--ed-text-4);
  font-size: 11px;
  line-height: 1.45;
}

/* ---------------- 模板缩略示意图 ---------------- */

.thumb {
  display: flex;
  height: 72px;
  overflow: hidden;
  border: 1px solid var(--ed-fill-3);
  border-radius: var(--ed-radius-sm);
  background: #fff;
}

.thumb-rail {
  display: none;
  flex: 0 0 32%;
  background: var(--accent);
}

.thumb-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px;
}

.thumb-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--ed-fill-3);
}

.thumb-head .name {
  width: 34%;
  height: 5px;
  border-radius: 2px;
  background: var(--ed-line-3);
}

.thumb-head .ava {
  width: 9px;
  height: 9px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.75;
}

.thumb-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thumb-lines i {
  height: 3px;
  border-radius: 2px;
  background: var(--ed-fill-3);
}

.thumb-lines .w90 {
  width: 90%;
}

.thumb-lines .w65 {
  width: 65%;
}

.thumb-cols {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
}

.thumb-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thumb-col .bt {
  width: 44%;
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
  opacity: 0.35;
}

.thumb-col .ln {
  height: 3px;
  border-radius: 2px;
  background: var(--ed-fill-3);
}

/* 左侧色栏 */
.thumb--sidebar .thumb-rail {
  display: block;
}

/* 双栏紧凑 */
.thumb--twocol .thumb-cols {
  flex-direction: row;
  gap: 6px;
}

.thumb--twocol .thumb-col:first-child {
  flex: 0 0 38%;
  padding-right: 5px;
  border-right: 1px solid var(--ed-fill-3);
}

/* 时间轴 */
.thumb--timeline .thumb-body {
  position: relative;
  padding-left: 14px;
}

.thumb--timeline .thumb-body::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 6px;
  left: 8px;
  width: 1px;
  background: var(--accent);
  opacity: 0.35;
}

.thumb--timeline .thumb-head {
  border-bottom-color: var(--accent);
}

/* 极简留白 */
.thumb--minimal .thumb-head .ava {
  display: none;
}

.thumb--minimal .thumb-col .bt {
  height: 3px;
  background: var(--ed-line-3);
  opacity: 1;
}

/* 通栏色带：页头通染主色并顶到缩略图边缘 */
.thumb--banner .thumb-head {
  margin: -6px -6px 2px;
  padding: 6px;
  background: var(--accent);
  border-bottom: 0;
}

.thumb--banner .thumb-head .name {
  background: rgba(255, 255, 255, 0.85);
}

.thumb--banner .thumb-head .ava {
  background: rgba(255, 255, 255, 0.9);
  opacity: 1;
}

/* 居中正式：页头居中、双细线收束 */
.thumb--business .thumb-head {
  justify-content: center;
  border-bottom: 3px double var(--accent);
}

.thumb--business .thumb-head .name {
  width: 46%;
}

.thumb--business .thumb-head .ava {
  display: none;
}

/* 卡片分区：每个模块包一层浅色卡片 */
.thumb--cards .thumb-col {
  padding: 3px 4px;
  border: 1px solid var(--ed-fill-3);
  border-radius: 3px;
  background: var(--ed-fill-2);
}

/* 右侧色栏：色栏翻到右边 */
.thumb--rightbar {
  flex-direction: row-reverse;
}

.thumb--rightbar .thumb-rail {
  display: block;
}

/* 标题左列：每个模块行变成「左侧标签块 + 右侧内容线」 */
.thumb--labelcol .thumb-col {
  flex-direction: row;
  align-items: flex-start;
  gap: 4px;
}

.thumb--labelcol .thumb-col .bt {
  flex: 0 0 32%;
  width: auto;
  height: 5px;
}

.thumb--labelcol .thumb-col .ln {
  flex: 1 1 auto;
}

/* 双栏流式：两栏等宽自动流动，中间以细分隔线分界 */
.thumb--flowcols .thumb-cols {
  position: relative;
  flex-direction: row;
  gap: 8px;
}

.thumb--flowcols .thumb-col {
  flex: 1 1 0;
}

.thumb--flowcols .thumb-cols::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(50% - 0.5px);
  width: 1px;
  background: var(--ed-fill-3);
}

/* 自由定制：通栏色带页头 + 可调比例的双栏 */
.thumb--custom .thumb-head {
  margin: -6px -6px 2px;
  padding: 6px;
  background: var(--accent);
  border-bottom: 0;
}

.thumb--custom .thumb-head .name {
  background: rgba(255, 255, 255, 0.85);
}

.thumb--custom .thumb-head .ava {
  background: rgba(255, 255, 255, 0.9);
  opacity: 1;
}

.thumb--custom .thumb-cols {
  flex-direction: row;
  gap: 6px;
}

.thumb--custom .thumb-col:first-child {
  flex: 0 0 34%;
  padding-right: 5px;
  border-right: 1px solid var(--ed-fill-3);
}
</style>
