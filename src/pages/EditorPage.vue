<script setup>
/**
 * 编辑器页面：顶栏 + 预览区 + 编辑面板。
 *
 * 宽屏两栏并排；窄屏（≤900px）同一时刻只显示一栏 —— 固定 340px 的编辑面板
 * 加预览区在手机宽度下塞不下，硬挤会让两边都不可用。切换入口沿用顶栏那个按钮，
 * 窄屏上它的含义由「显示/隐藏面板」变成「编辑/预览」。
 *
 * 登录后由 useCloudSync 接管云端恢复与推送；未登录时它保持静默。
 */
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'

import OnboardingDialog from '@/components/OnboardingDialog.vue'
import ShortcutsDialog from '@/components/ShortcutsDialog.vue'
import EditorPanel from '@/components/editor/EditorPanel.vue'
import PreviewPane from '@/components/PreviewPane.vue'
import TopBar from '@/components/TopBar.vue'
import { MOBILE_QUERY, useMediaQuery } from '@/composables/useMediaQuery'
import { useCloudSync } from '@/composables/useCloudSync'
import { useToast } from '@/composables/useToast'
import { useResumeFile } from '@/composables/useResumeFile'
import { useResumeStore } from '@/stores/resume'
import { useSelectionStore } from '@/stores/selection'

const store = useResumeStore()
const { toast } = useToast()

useCloudSync()

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

/* ---------------- 快捷键 ---------------- */

const selection = useSelectionStore()
const { exportJSON } = useResumeFile()
const shortcutsOpen = shallowRef(false)

/** 首次访问弹新手引导，完成或跳过后不再出现 */
const ONBOARDING_FLAG = 'resume-studio-onboarded-v1'
const onboardingOpen = shallowRef(false)
try {
  onboardingOpen.value = !localStorage.getItem(ONBOARDING_FLAG)
} catch {
  onboardingOpen.value = false
}

function finishOnboarding() {
  onboardingOpen.value = false
  try {
    localStorage.setItem(ONBOARDING_FLAG, String(Date.now()))
  } catch {
    /* 存不进也不影响使用，下次再引导一次而已 */
  }
}

/** 焦点在输入控件里时不劫持字符与删除键，只放行组合键 */
function isTypingTarget(event) {
  const target = event.target
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  )
}

/** 隐藏纸面选中的模块，与框选工具条的批量隐藏保持同一行为 */
function hideSelected() {
  const picked = store.sections.filter((s) => selection.has(s.id))
  if (!picked.length) return
  picked.forEach((s) => store.updateSection(s.id, { visible: false }))
  selection.clear()
  toast(`已隐藏 ${picked.length} 个模块，Ctrl+Z 可恢复`)
}

onMounted(() => {
  if (store.storageWarning) {
    toast(store.storageWarning, 4000)
  } else if (store.restored) {
    toast('已恢复上次的编辑内容')
  }

  // 全局撤销/重做快捷键。输入法组词期间不拦截，避免打断中文候选确认
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

function onKeydown(event) {
  if (event.isComposing) return

  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        store.redo()
      } else {
        store.undo()
      }
    } else if (key === 'y') {
      event.preventDefault()
      store.redo()
    } else if (key === 's') {
      // 接管浏览器「保存网页」，改为导出简历 JSON 备份
      event.preventDefault()
      exportJSON()
    }
    return
  }

  if (isTypingTarget(event)) return

  if ((event.key === 'Delete' || event.key === 'Backspace') && selection.count) {
    event.preventDefault()
    hideSelected()
  } else if (event.key === '?') {
    event.preventDefault()
    shortcutsOpen.value = true
  }
}
</script>

<template>
  <div class="editor-app">
    <TopBar :is-mobile="isMobile" :panel-visible="showEditor" @toggle-panel="togglePanel" />

    <main class="editor-main">
      <!-- 用 v-show：隐藏一栏再切回来时应保留编辑进度（展开的模块、当前页签、滚动位置） -->
      <PreviewPane v-show="showPreview" />
      <EditorPanel v-show="showEditor" />
    </main>

    <ShortcutsDialog :open="shortcutsOpen" @close="shortcutsOpen = false" />
    <OnboardingDialog v-if="onboardingOpen" @done="finishOnboarding" />
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
