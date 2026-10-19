<script setup lang="ts">
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
import { usePanelResize } from '@/composables/usePanelResize'
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

/*
 * 右侧面板宽度可拖。宽度写进 --panel-w，由 EditorPanel 的 flex-basis 读走 ——
 * 用 CSS 变量而不是给 EditorPanel 传 prop：宽度是布局值，
 * 传 prop 会让组件多一个与自身职责无关的入参，而变量天然穿透 scoped 样式。
 */
const panel = usePanelResize()

/** 手柄上的方向键：左/右调宽度，Home 复位。拖拽对键盘用户不可达，这是等价入口 */
function onResizerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') panel.nudge(panel.KEYBOARD_STEP)
  else if (event.key === 'ArrowRight') panel.nudge(-panel.KEYBOARD_STEP)
  else if (event.key === 'Home') panel.resetWidth()
  else return
  event.preventDefault()
}

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
function isTypingTarget(event: KeyboardEvent) {
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

function onKeydown(event: KeyboardEvent) {
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

    <main
      class="editor-main"
      :class="{ 'is-resizing': panel.resizing.value }"
      :style="{ '--panel-w': panel.width.value + 'px' }"
    >
      <!-- 用 v-show：隐藏一栏再切回来时应保留编辑进度（展开的模块、当前页签、滚动位置） -->
      <PreviewPane v-show="showPreview" />

      <!--
        分隔手柄。只在两栏都在时才出现 —— 面板隐藏时没有可调的东西。
        role="separator" 是 ARIA 对分隔条的规定角色，配合 aria-valuenow 让
        读屏能念出「可调整的分隔条，当前 340」；键盘用方向键调、Home 复位。
      -->
      <div
        v-if="showEditor && showPreview"
        class="panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整编辑面板宽度"
        :aria-valuenow="panel.width.value"
        :aria-valuemin="panel.MIN_WIDTH"
        :aria-valuemax="panel.maxWidth()"
        tabindex="0"
        title="拖动调整宽度，方向键微调，双击恢复默认"
        @pointerdown="panel.startResize"
        @dblclick="panel.resetWidth"
        @keydown="onResizerKeydown"
      >
        <span class="panel-resizer-grip" aria-hidden="true" />
      </div>

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
  /* 窄屏时栏内的固有宽度（如那排模块操作按钮）不该把页面撑出横向滚动 */
  min-width: 0;
  overflow-x: clip;
}

/*
 * 面板宽度分隔条。
 *
 * 只有 7px 宽，但不是无障碍问题：它只在 >900px（两栏并排）时出现，
 * 那个尺寸下输入是鼠标/触控板；窄屏面板本来就是整宽、没有并排关系。
 * 静态审计的 24px 点击目标规则针对的是触屏，因此它的选择器里不含 separator
 * （见 tools/audit-ui.mjs 的说明）—— 这是有意的，不是漏掉。
 *
 * 但焦点与悬停反馈**必须**有：交互态审计会把 [role="separator"] 一起走。
 * 反馈做在手柄自身（改自己的背景色/描边），因为审计量的是元素自己的计算样式，
 * 只改内部那条细线它看不到。
 */
.panel-resizer {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 7px;
  /* 触屏上不让这个手势被当成滚动（虽然此处不会显示，写上是为将来复用） */
  touch-action: none;
  background: transparent;
  cursor: col-resize;
  transition: background-color 0.15s;
}

/* 中间那条细线：平时几乎看不见，悬停/聚焦时才明显 */
.panel-resizer-grip {
  width: 1px;
  height: 100%;
  background: var(--ed-line-soft);
  transition:
    width 0.15s,
    background-color 0.15s;
}

.panel-resizer:hover {
  background: var(--ed-brand-tint);
}

.panel-resizer:hover .panel-resizer-grip {
  width: 2px;
  background: var(--ed-brand-border);
}

.panel-resizer:focus-visible {
  outline: 2px solid var(--ed-brand);
  outline-offset: -2px;
}

.panel-resizer:active .panel-resizer-grip {
  background: var(--ed-brand);
}

/* 拖拽中：光标保持为分隔样式，且不选中文字（否则会把纸张与面板里的文本一起选中） */
.editor-main.is-resizing,
.editor-main.is-resizing * {
  cursor: col-resize;
  user-select: none;
}
</style>
