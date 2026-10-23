<script setup lang="ts">
/**
 * 设计页签。
 * 只做组合：模板、配色、排版、标题四个分区各自独立成组件，
 * 用单一根容器包裹以便父级用 v-show 切换。
 */
import ColorSection from '@/components/editor/design/ColorSection.vue'
import CustomLayoutPanel from '@/components/editor/design/CustomLayoutPanel.vue'
import ImageTemplatePanel from '@/components/editor/design/ImageTemplatePanel.vue'
import TemplatePicker from '@/components/editor/design/TemplatePicker.vue'
import TitleSection from '@/components/editor/design/TitleSection.vue'
import TypographySection from '@/components/editor/design/TypographySection.vue'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()
</script>

<template>
  <div class="panel-design">
    <TemplatePicker />
    <CustomLayoutPanel />
    <ImageTemplatePanel />
    <ColorSection />
    <TypographySection />
    <TitleSection />

    <div class="ed-group">
      <button class="ed-btn ed-btn-block" @click="store.resetTheme()">恢复默认主题</button>
    </div>
  </div>
</template>

<style scoped>
/*
 * 设计面板的分区在外时跳过渲染。
 *
 * 实测背景（tools/probe-scroll.mjs 的设计页签段）：这一栏只有 2216px，
 * 比内容栏（6649px）短得多，滚动却更卡 —— p95 24.7ms、最差一帧 61ms。
 * 原因是密度而不是长度：TemplatePicker 的 12 张缩略图、配色色块、
 * 大量带 box-shadow 的控件都挤在这两千像素里。
 *
 * 对照实验（同一页面，只改这一条）：
 *   基线           p95 24.7ms  max 60.9ms
 *   + 本属性       p95  7.3ms  max  8.9ms
 * 而且 scrollHeight 前后都是 2216px，**零漂移** —— `auto` 会记住分区渲染过
 * 一次之后的真实高度，所以估算值取得准不准只影响首次，不会让滚动条跳动。
 *
 * 首次滚到某分区时有一次性的渲染成本（实测最重一区约 35ms）。
 * 试过用 requestIdleCallback 预热把它提前掉，但**没有收益**：
 * 设计页签初始是 v-show 隐藏的，此时 offsetTop 全为 0，预热滚不动任何分区；
 * 而等它显示时用户往往已经在滚动，预热反而和用户抢主线程。
 * 这个一次性成本与内容页签的卡片一致，故不再特殊处理。
 *
 * 用 `> .ed-group` 直接子选择器：只包住本面板的分区，
 * 不去影响内容页签里同名类（那里已由 .ed-card 自己处理）。
 */
.panel-design > .ed-group {
  content-visibility: auto;
  contain-intrinsic-size: auto 300px;
}
</style>
