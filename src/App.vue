<script setup>
/**
 * 应用外壳：顶栏 + 预览区 + 编辑面板。
 */
import { onMounted, shallowRef } from 'vue'

import EditorPanel from '@/components/editor/EditorPanel.vue'
import PreviewPane from '@/components/PreviewPane.vue'
import TopBar from '@/components/TopBar.vue'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()
const { message, visible, toast } = useToast()

const panelVisible = shallowRef(true)

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
    <TopBar :panel-visible="panelVisible" @toggle-panel="panelVisible = !panelVisible" />

    <main class="editor-main">
      <PreviewPane />
      <!-- 用 v-show：隐藏面板再打开时应保留编辑进度（展开的模块、当前页签） -->
      <EditorPanel v-show="panelVisible" />
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

.editor-main {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}
</style>
