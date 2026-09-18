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
    <nav class="panel-tabs">
      <button :class="{ 'is-active': tab === 'content' }" @click="tab = 'content'">
        <SvgIcon name="text" :size="14" />
        <span>内容</span>
      </button>
      <button :class="{ 'is-active': tab === 'design' }" @click="tab = 'design'">
        <SvgIcon name="palette" :size="14" />
        <span>设计</span>
      </button>
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
  border-left: 1px solid #e3e6ec;
  background: #fff;
}

.panel-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid #e3e6ec;
}

.panel-tabs button {
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 0;
  border: 1px solid #d8dce4;
  border-radius: 8px;
  background: #fff;
  color: #5b6472;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: 0.15s;
}

.panel-tabs button:hover {
  background: #f5f7fa;
}

.panel-tabs button.is-active {
  border-color: #2b579a;
  background: #eaf0fa;
  color: #24487f;
  font-weight: 600;
}

.panel-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 14px 40px;
  overflow-y: auto;
}
</style>
