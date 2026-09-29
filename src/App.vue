<script setup>
/**
 * 应用外壳：顶栏 + 预览区 + 编辑面板。
 *
 * 宽屏两栏并排；窄屏（≤900px）同一时刻只显示一栏 —— 固定 340px 的编辑面板
 * 加预览区在手机宽度下塞不下，硬挤会让两边都不可用。切换入口沿用顶栏那个按钮，
 * 窄屏上它的含义由「显示/隐藏面板」变成「编辑/预览」。
 */
import { computed, onMounted, shallowRef } from 'vue'

import EditorPanel from '@/components/editor/EditorPanel.vue'
import PreviewPane from '@/components/PreviewPane.vue'
import TopBar from '@/components/TopBar.vue'
import { MOBILE_QUERY, useMediaQuery } from '@/composables/useMediaQuery'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()
const { message, visible, toast } = useToast()

const isMobile = useMediaQuery(MOBILE_QUERY)

/** 窄屏当前显示哪一栏；默认进编辑，改完再切过去看效果 */
const mobileView = shallowRef('edit')
/** 宽屏下编辑面板是否显示（此时预览恒显示） */
const panelVisible = shallowRef(true)

/** 两栏各自是否可见：宽屏预览恒显示，窄屏按 mobileView 二选一 */
const showPreview = computed(() => !isMobile.value || mobileView.value === 'preview')
const showEditor = computed(() =>
  isMobile.value ? mobileView.value === 'edit' : panelVisible.value,
)

function togglePanel() {
  if (isMobile.value) {
    mobileView.value = mobileView.value === 'edit' ? 'preview' : 'edit'
    return
  }
  panelVisible.value = !panelVisible.value
}

onMounted(() => {
  if (store.storageWarning) {
    toast(store.storageWarning, 4000)
  } else if (store.restored) {
    toast('已恢复上次的编辑内容')
  }
})
</script>

<template>
  <div class="editor-app">
    <TopBar :is-mobile="isMobile" :panel-visible="showEditor" @toggle-panel="togglePanel" />

    <main class="editor-main">
      <!-- 用 v-show：隐藏一栏再切回来时应保留编辑进度（展开的模块、当前页签、滚动位置） -->
      <PreviewPane v-show="showPreview" />
      <EditorPanel v-show="showEditor" />
    </main>

    <div class="editor-toast" :class="{ 'is-visible': visible }">{{ message }}</div>
  </div>
</template>

<style scoped>
.editor-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/*
 * 移动端浏览器地址栏会随滚动收起/展开，100vh 按「地址栏收起后」计算，
 * 于是底部总被裁掉一截。dvh 跟随实际可视区变化，老浏览器保留上面的 100vh 回落。
 */
@supports (height: 100dvh) {
  .editor-app {
    height: 100dvh;
  }
}

.editor-main {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}
</style>
