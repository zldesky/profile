<script setup>
/**
 * 预览区。
 * 按当前模板渲染 A4 纸张；缩放、页数估算、头像拖拽与模块框选/整组拖拽
 * 分别由 composable 承载，本组件只负责组合、注入 @page 打印边距与「压缩到一页」。
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'

import PreviewToolbar from '@/components/preview/PreviewToolbar.vue'
import SelectionToolbar from '@/components/preview/SelectionToolbar.vue'
import { useAvatarDrag } from '@/composables/useAvatarDrag'
import { usePageMetrics } from '@/composables/usePageMetrics'
import { usePaperSelection } from '@/composables/usePaperSelection'
import { usePaperZoom } from '@/composables/usePaperZoom'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { useSelectionStore } from '@/stores/selection'
import { resolveTemplate } from '@/templates'

const PRINT_STYLE_ID = 'resume-print-page'
/** 压缩到一页时的下限，与设计面板滑块范围保持一致 */
const MIN_FS = 0.8
const MIN_LH = 1.3
const MIN_GAP = 0.5

const store = useResumeStore()
const { toast } = useToast()

const scrollRef = useTemplateRef('scrollRef')
const paperRef = useTemplateRef('paperRef')
const compressing = shallowRef(false)

const { zoom, autoFit, resizeTick, fit, zoomBy, resetFit } = usePaperZoom(scrollRef)
const { pageCount, measure, refresh } = usePageMetrics(paperRef, zoom)
const {
  dragging,
  offset,
  syncLimits,
  onPaperPointerDown: onAvatarPointerDown,
} = useAvatarDrag(paperRef, zoom)
const selection = useSelectionStore()
const {
  bandRect,
  secDragging,
  toolbarAnchor,
  onPaperPointerDown: onSectionPointerDown,
  syncToolbar,
} = usePaperSelection(paperRef, scrollRef, zoom)

const templateComponent = computed(() => resolveTemplate(store.resume.template))
const paperStyle = computed(() => ({ ...store.pageStyle, '--zoom': zoom.value }))

/** 框选 overlay 的视口定位 */
const bandStyle = computed(() => {
  const rect = bandRect.value
  if (!rect) return {}
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.right - rect.left}px`,
    height: `${rect.bottom - rect.top}px`,
  }
})

/**
 * 纸面按下：头像拖拽与模块框选/整组拖拽各自判断命中目标，互不干扰。
 */
function onPaperPointerDown(event) {
  onSectionPointerDown(event)
  onAvatarPointerDown(event)
}

/** 页数、头像边界与多选工具条位置都必须在 DOM 稳定后测量 */
async function refreshLayout() {
  await refresh()
  syncLimits()
  syncToolbar()
}

// 选中集变化后模块高亮随之增减，DOM 稳定后再贴工具条
watch(
  () => selection.ids,
  () => nextTick(syncToolbar),
)

/** 批量显隐：任一选中模块可见则全部隐藏，否则全部显示 */
function batchToggleVisible() {
  const picked = store.sections.filter((s) => selection.has(s.id))
  if (!picked.length) return
  const anyVisible = picked.some((s) => s.visible)
  picked.forEach((s) => store.updateSection(s.id, { visible: !anyVisible }))
  // 隐藏后纸上已无对应元素，选中集随之清空
  if (anyVisible) selection.clear()
}

/** 批量微调左缩进 / 上方间距，步长与范围与编辑面板的滑杆一致 */
function batchAdjustLayout(field, step) {
  const range = field === 'indent' ? { min: -24, max: 48 } : { min: -12, max: 48 }
  store.sections
    .filter((s) => selection.has(s.id))
    .forEach((s) => {
      const current = Number(s.layout?.[field]) || 0
      const next = Math.min(range.max, Math.max(range.min, current + step))
      if (next !== current) store.updateSectionLayout(s.id, { [field]: next })
    })
}

/** 把 @page 边距写入 head，打印时与预览保持一致 */
function applyPrintCss() {
  let el = document.getElementById(PRINT_STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = PRINT_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = store.printCss
}

// 只依赖 document.head，不依赖模板引用，可以立即执行且不必再在 onMounted 里重复调用
watch(() => store.printCss, applyPrintCss, { immediate: true })

// fit() 与首次测量依赖已挂载的 DOM，无法用 immediate 替代
onMounted(() => {
  fit()
  refreshLayout()
})

onBeforeUnmount(() => {
  document.getElementById(PRINT_STYLE_ID)?.remove()
})

watch(() => store.resume, refreshLayout, { deep: true })
watch(zoom, refreshLayout)
watch(resizeTick, refreshLayout)

/**
 * 逐步收紧字号、行距与模块间距，直到内容落进一页为止。
 * 每轮修改后等待 DOM 更新再重新测量。
 */
async function compressToOnePage() {
  if (compressing.value) return
  compressing.value = true

  try {
    const round2 = (value) => Number(value.toFixed(2))
    let guard = 24

    while (measure() > 1 && guard-- > 0) {
      const fs = Math.max(MIN_FS, round2(store.theme.fs - 0.02))
      const lh = Math.max(MIN_LH, round2(store.theme.lh - 0.04))
      const gap = Math.max(MIN_GAP, round2(store.theme.gap - 0.04))

      if (fs === store.theme.fs && lh === store.theme.lh && gap === store.theme.gap) break

      store.setTheme({ fs, lh, gap })
      await nextTick()
    }

    if (measure() <= 1) {
      toast(
        `已压缩到一页：字号 ${Math.round(store.theme.fs * 100)}%、行距 ${store.theme.lh.toFixed(2)}`,
      )
    } else {
      toast('已压到设定的最小值仍超过一页，建议精简内容或减少模块', 3400)
    }
  } finally {
    compressing.value = false
  }
}
</script>

<template>
  <section class="editor-stage">
    <div ref="scrollRef" class="stage-scroll">
      <div
        ref="paperRef"
        class="paper"
        :class="{ 'is-avatar-dragging': dragging, 'is-sec-dragging': secDragging }"
        :style="paperStyle"
        :data-tstyle="store.theme.titleStyle"
        :data-marker="store.theme.titleMarker"
        :data-line="store.theme.titleBottom"
        :data-shape="store.basics.avatarShape"
        @pointerdown="onPaperPointerDown"
      >
        <component :is="templateComponent" :resume="store.resume" :selected-ids="selection.ids" />
      </div>
    </div>

    <div v-if="bandRect" class="sel-band no-print" :style="bandStyle"></div>

    <SelectionToolbar
      v-if="toolbarAnchor"
      :anchor="toolbarAnchor"
      :count="selection.count"
      @toggle-visible="batchToggleVisible"
      @gap="(step) => batchAdjustLayout('extraGap', step)"
      @indent="(step) => batchAdjustLayout('indent', step)"
      @clear="selection.clear()"
    />

    <PreviewToolbar
      :zoom="zoom"
      :auto-fit="autoFit"
      :page-count="pageCount"
      :compressing="compressing"
      :dragging="dragging"
      :offset="offset"
      @zoom-in="zoomBy(0.1)"
      @zoom-out="zoomBy(-0.1)"
      @fit="resetFit"
      @compress="compressToOnePage"
    />
  </section>
</template>

<style scoped>
.editor-stage {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* 画布：浅灰底 + 极淡点阵，营造设计工具的工作台质感；打印时整块被隐藏 */
.stage-scroll {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
  padding: 26px 28px 64px;
  overflow: auto;
  background-color: #f3f4f6;
  background-image: radial-gradient(rgba(16, 24, 40, 0.075) 1px, transparent 1.6px);
  background-size: 24px 24px;
  /* 滚到底后不要继续带动外层（移动端会触发下拉刷新/橡皮筋） */
  overscroll-behavior: contain;
}

.paper {
  flex: 0 0 auto;
  box-shadow: var(--ed-paper-shadow);
}

/* 框选矩形：视口定位的 overlay，不参与打印（no-print）也不拦截指针 */
.sel-band {
  position: fixed;
  z-index: 50;
  border: 1px solid var(--ed-brand-strong);
  border-radius: 3px;
  background: var(--ed-brand-ring);
  pointer-events: none;
}

@media (max-width: 900px) {
  /* 窄屏这一栏独占宽度，把留白收紧换成纸张空间。
     usePaperZoom 的 fit() 直接读实际内边距，改这里不需要同步改常量。 */
  .stage-scroll {
    padding: 12px 14px 52px;
  }

  .paper {
    box-shadow: 0 2px 14px rgba(20, 30, 50, 0.16);
  }
}
</style>
