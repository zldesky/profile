<script setup>
/**
 * 右侧编辑面板外壳，负责「内容 / 设计」两个页签的切换。
 */
import { shallowRef } from 'vue'

import ContentPanel from '@/components/editor/ContentPanel.vue'
import DesignPanel from '@/components/editor/DesignPanel.vue'
import SvgIcon from '@/components/SvgIcon.vue'

const tab = shallowRef('content')
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
  flex: 0 0 340px;
  flex-direction: column;
  min-height: 0;
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
  border-radius: 9px;
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
  border-radius: 7px;
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
  }

  .panel-tabs-wrap {
    /* 页签常驻可见，长面板滚动时仍能换页签 */
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--ed-surface);
  }

  .panel-body {
    padding: 0 12px 48px;
  }
}
</style>
