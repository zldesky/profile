<script setup>
/**
 * 模板选择。
 * 缩略图是纯 CSS 画的示意图，不依赖任何图片资源；
 * 同时沿用当前主色，选模板时能一并看到配色效果。
 */
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { TEMPLATES } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

const thumbStyle = computed(() => ({ '--accent': store.theme.accent }))

function selectTemplate(id) {
  store.resume.template = id
}
</script>

<template>
  <div class="ed-group">
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
          :class="{ 'is-active': store.resume.template === tpl.id }"
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

    <p class="ed-hint">切换模板只改变排版结构，已填写的内容会自动套用到新模板。</p>
  </div>
</template>

<style scoped>
.tpl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
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
  scrollbar-color: #d3d9e3 transparent;
}

.tpl-scroll::-webkit-scrollbar {
  width: 6px;
}

.tpl-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.tpl-scroll::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: #d3d9e3;
}

.tpl-scroll::-webkit-scrollbar-thumb:hover {
  background: #b9c3d4;
}

.tpl-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px;
  border: 1px solid #e3e6ec;
  border-radius: 10px;
  background: #fff;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.15s;
}

.tpl-card:hover {
  border-color: #b9c3d4;
  box-shadow: 0 2px 10px rgba(20, 30, 50, 0.07);
}

.tpl-card.is-active {
  border-color: #2b579a;
  box-shadow: 0 0 0 2px rgba(43, 87, 154, 0.16);
}

.tpl-check {
  position: absolute;
  top: 6px;
  right: 6px;
  color: #2b579a;
}

.tpl-meta strong {
  display: block;
  color: #1f2329;
  font-size: 12.5px;
}

.tpl-meta span {
  display: block;
  margin-top: 2px;
  color: #8b93a1;
  font-size: 11px;
  line-height: 1.45;
}

/* ---------------- 模板缩略示意图 ---------------- */

.thumb {
  display: flex;
  height: 72px;
  overflow: hidden;
  border: 1px solid #eceff4;
  border-radius: 6px;
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
  border-bottom: 1px solid #eceff4;
}

.thumb-head .name {
  width: 34%;
  height: 5px;
  border-radius: 2px;
  background: #c8ced8;
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
  gap: 3px;
}

.thumb-lines i {
  height: 3px;
  border-radius: 2px;
  background: #e6e9ef;
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
  gap: 3px;
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
  background: #e6e9ef;
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
  border-right: 1px solid #eceff4;
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
  background: #c8ced8;
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
  border: 1px solid #e3e8f0;
  border-radius: 3px;
  background: #f6f8fb;
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
  background: #eceff4;
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
  border-right: 1px solid #eceff4;
}
</style>
