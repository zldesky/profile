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

    <p class="ed-hint">切换模板只改变排版结构，已填写的内容会自动套用到新模板。</p>
  </div>
</template>

<style scoped>
.tpl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
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
</style>
