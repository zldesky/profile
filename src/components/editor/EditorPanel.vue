<script setup lang="ts">
/**
 * 右侧编辑面板外壳，负责「内容 / 设计」两个页签的切换。
 */
import { shallowRef, watch } from 'vue'

import ContentPanel from '@/components/editor/ContentPanel.vue'
import DesignPanel from '@/components/editor/DesignPanel.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { usePaperJump } from '@/composables/usePaperJump'

const tab = shallowRef('content')

/*
 * 点纸面模块时自动切到「内容」页签：目标卡片在那一栏里，
 * 不切的话用户会觉得「点了没反应」。
 * 响应的是 requestSeq 而非 targetId —— 连点同一模块时 id 不变。
 */
const { requestSeq } = usePaperJump()
watch(requestSeq, () => {
  tab.value = 'content'
})

/*
 * 关于「预热设计面板」的尝试与结论（**已放弃，不要重试**）。
 *
 * 设计面板各分区带 content-visibility: auto，首次滚到某区要现渲染。
 * 试过切到设计页签后在空闲时把分区逐个滚一遍再复原，想把这笔开销提前掉。
 * A/B 实测（同一构建，两个独立页面，各滚 120 帧）：
 *   预热 2.5s 后首次滚动：p95 8.9ms，max 64ms，尖峰 3 次
 *   不做预热、切过去直接滚：p95 7.5ms，max 8.7ms，尖峰 0 次
 * **预热反而更差** —— 它自己滚动容器，与随后的用户滚动抢占，
 * 还会让 content-visibility 在同一帧里反复计算可见性。
 *
 * 结论：一次性渲染成本（约 50ms、只在首次）远小于「干扰用户滚动」的代价。
 * 保持现状即可。这个注释是为了避免下一个人（或 AI）重新"优化"一遍。
 */
</script>

<template>
  <aside class="editor-panel">
    <nav class="panel-tabs-wrap">
      <div class="panel-tabs">
        <button :class="{ 'is-active': tab === 'content' }" @click="tab = 'content'">
          <SvgIcon name="text" :size="14" />
          <span>内容</span>
        </button>
        <button :class="{ 'is-active': tab === 'design' }" @click="tab = 'design'">
          <SvgIcon name="palette" :size="14" />
          <span>设计</span>
        </button>
      </div>
    </nav>

    <!-- 两个页签用 v-show：切换时保留模块展开状态与面板滚动位置 -->
    <div class="panel-body">
      <ContentPanel v-show="tab === 'content'" />
      <DesignPanel v-show="tab === 'design'" />
    </div>
  </aside>
</template>

<style scoped>
.editor-panel {
  display: flex;
  /*
   * 宽度由 usePanelResize 写进 --panel-w（默认 340 与原值一致）。
   * 用变量而不是 prop：宽度是布局值，没必要让这个组件多一个与自身职责无关的入参。
   * 窄屏那条媒体查询里的 flex: 1 1 auto 会覆盖它，所以手机上不受影响。
   */
  flex: 0 0 var(--panel-w, 340px);
  flex-direction: column;
  min-height: 0;
  /*
   * min-width: 0 不能省，否则拖窄会**拖不动**。
   *
   * flex 项默认 min-width: auto，即「不得小于内容的固有宽度」；
   * 面板里那排模块操作按钮合计约 224px 再加内边距，把固有宽度顶到约 321px。
   * 结果就是：宽度变量已经变成 280，面板却停在 321 —— 最后 41px 像是「拖不动」。
   * 实测过：--panel-w=280px 而面板 getBoundingClientRect().width = 321px。
   *
   * 允许压缩后由内部换行/滚动消化。窄屏那条媒体查询里本来就有这一条，
   * 桌面这边一直缺，只是以前宽度写死 340 看不出来。
   */
  min-width: 0;
  border-left: 1px solid var(--ed-line-soft);
  background: var(--ed-surface);
}

/* 页签外层负责留白与吸附，内层才是分段控制器的浅灰轨道 */
.panel-tabs-wrap {
  flex: 0 0 auto;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--ed-line-soft);
}

.panel-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-seg-outer);
  background: var(--ed-fill);
}

.panel-tabs button {
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 0;
  border: none;
  border-radius: var(--ed-radius-seg-inner);
  background: transparent;
  color: var(--ed-text-2);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: 0.15s;
}

.panel-tabs button:hover {
  color: var(--ed-ink);
}

/* 选中页签 = 白色浮起滑块，与浅灰轨道形成层次 */
.panel-tabs button.is-active {
  background: var(--ed-surface);
  box-shadow:
    0 1px 2px rgba(16, 24, 40, 0.12),
    0 0 1px rgba(16, 24, 40, 0.1);
  color: var(--ed-brand-deep);
  font-weight: 600;
}

/*
 * 选中的页签也要有悬停反馈。
 *
 * 上面 `button:hover` 只改文字色（--ed-text-2 → --ed-ink），而选中页签的文字
 * 已经是 --ed-brand-deep，于是「鼠标停在当前选中的页签上」没有任何变化 ——
 * 未选中的页签反而有。实测确认（:hover 匹配、计算样式不变）。
 *
 * 这里改底色而不是文字色：文字已经是最深一档，再深没有空间。
 * 用轨道色 --ed-fill 作悬停底，读起来像滑块被按住；并且它比白色更暗，
 * 不会像「把白底压灰」那样显得脏。
 */
.panel-tabs button.is-active:hover {
  background: var(--ed-fill);
}

.panel-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 14px 40px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

@media (max-width: 900px) {
  /* 窄屏这一栏独占整个宽度：预览此时已被 v-show 隐藏，不存在并排关系 */
  .editor-panel {
    flex: 1 1 auto;
    border-left: 0;
    /*
     * min-width: 0 不能省。flex 项默认 min-width: auto，即「不得小于内容的固有宽度」；
     * 面板里那排模块操作按钮合计约 224px 再加间距，会把整栏撑到 332px ——
     * 在 320px 的设备上就是横向溢出（实测：editor-panel 332 > 父级 320）。
     * 允许压缩后由内部换行/滚动消化，而不是把页面撑破。
     */
    min-width: 0;
    overflow-x: hidden;
  }

  .panel-tabs-wrap {
    /* 页签常驻可见，长面板滚动时仍能换页签 */
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--ed-surface);
  }

  .panel-body {
    /* 底部余量叠加 iPhone 手势条安全区，最后一项不被边缘手势遮住 */
    padding: 0 12px calc(48px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
