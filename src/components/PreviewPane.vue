<script setup>
/**
 * 预览区。
 * 按当前模板渲染 A4 纸张；缩放、页数估算与头像拖拽分别由 composable 承载，
 * 本组件只负责组合、注入 @page 打印边距与「压缩到一页」。
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
import { useAvatarDrag } from '@/composables/useAvatarDrag'
import { usePageMetrics } from '@/composables/usePageMetrics'
import { usePaperZoom } from '@/composables/usePaperZoom'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
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
const { dragging, offset, syncLimits, onPaperPointerDown } = useAvatarDrag(paperRef, zoom)

const templateComponent = computed(() => resolveTemplate(store.resume.template))
const paperStyle = computed(() => ({ ...store.pageStyle, '--zoom': zoom.value }))

/** 页数与头像边界都必须在 DOM 稳定后测量 */
async function refreshLayout() {
  await refresh()
  syncLimits()
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
        :class="{ 'is-avatar-dragging': dragging }"
        :style="paperStyle"
        :data-tstyle="store.theme.titleStyle"
        :data-marker="store.theme.titleMarker"
        :data-line="store.theme.titleBottom"
        :data-shape="store.basics.avatarShape"
        @pointerdown="onPaperPointerDown"
      >
        <component :is="templateComponent" :resume="store.resume" />
      </div>
    </div>

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
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.stage-scroll {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
  padding: 26px 28px 34px;
  overflow: auto;
}

.paper {
  flex: 0 0 auto;
  box-shadow: 0 3px 22px rgba(20, 30, 50, 0.14);
}
</style>
