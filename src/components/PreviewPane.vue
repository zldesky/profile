<script setup lang="ts">
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

import InlineEditor from '@/components/paper/InlineEditor.vue'
import PreviewToolbar from '@/components/preview/PreviewToolbar.vue'
import SelectionToolbar from '@/components/preview/SelectionToolbar.vue'
import FieldNudgeHint from '@/components/preview/FieldNudgeHint.vue'
import { useAvatarDrag } from '@/composables/useAvatarDrag'
import { useFieldDrag } from '@/composables/useFieldDrag'
import { reorderSectionsByPreview, useDragPreview } from '@/composables/useDragPreview'
import { FIELD_LABELS, resolveEditTarget } from '@/composables/useInlineEdit'
import type { EditTarget } from '@/composables/useInlineEdit'
import { usePageMetrics } from '@/composables/usePageMetrics'
import { usePaperSelection } from '@/composables/usePaperSelection'
import { usePaperJump } from '@/composables/usePaperJump'
import { usePaperZoom } from '@/composables/usePaperZoom'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { useSelectionStore } from '@/stores/selection'
import { useFieldSelectionStore } from '@/stores/fieldSelection'
import { getFieldLayout } from '@/utils/fieldLayout'
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
/** 就地编辑浮层；按下纸面别处时要先让它把草稿写回 */
const inlineEditorRef = useTemplateRef<{ commitNow: () => void }>('inlineEditorRef')
const compressing = shallowRef(false)

const { zoom, autoFit, resizeTick, fit, zoomBy, resetFit } = usePaperZoom(scrollRef)
const { pageCount, measure, refresh, debugBlocks } = usePageMetrics(paperRef, zoom)

/*
 * 开发态把页数估算的中间过程挂到 window，供验证脚本核对。
 *
 * 为什么需要：编辑器显示的页数是一个**估算**，而导出 PDF 的分页由浏览器决定。
 * 两者不一致时（用户会说「编辑器说 2 页、导出是 3 页」），最难判断的是
 * 「公式错了」还是「块几何取错了」——只看到最终页数无法区分。
 * tools/verify-page-count-agreement.mjs 会读这个东西，把它们并排打出来。
 * 只在开发态挂载，生产构建里不存在。
 */
if (import.meta.env.DEV) {
  // 本仓库没有全局 .d.ts，按现有风格就地断言一次，而不是新开一个声明文件
  const dbg = window as unknown as { __pageMetrics?: unknown }
  dbg.__pageMetrics = { measure, refresh, debugBlocks }
}
const {
  dragging,
  offset,
  syncLimits,
  onPaperPointerDown: onAvatarPointerDown,
} = useAvatarDrag(paperRef, zoom)
const selection = useSelectionStore()
const fieldSelection = useFieldSelectionStore()
const {
  bandRect,
  dropLine,
  secDragging,
  toolbarAnchor,
  onPaperPointerDown: onSectionPointerDown,
  syncToolbar,
} = usePaperSelection(paperRef, scrollRef, zoom)
const { focusSection } = usePaperJump()
const { onFieldPointerDown } = useFieldDrag(paperRef, zoom)

/**
 * 就地编辑：维护「正在编辑哪个字段 + 锚点元素」。
 *
 * 锚点用 shallowRef 而非 ref —— 存的是 DOM 元素，被 Vue 代理一层既没必要，
 * 也会让 getBoundingClientRect 之类的调用绕远路。
 */
const editTarget = shallowRef<EditTarget | null>(null)
const editAnchor = shallowRef<HTMLElement | null>(null)

/**
 * 从被点的元素解析出可编辑字段。命中返回 true（调用方据此不再跳转）。
 *
 * 向上找最近的带 data-field 的祖先：点到的是文字节点所在的 span，
 * 但它可能是 <span data-field> 里的 <img>，所以要向上收敛。
 */
function openInlineEdit(node: EventTarget | null) {
  if (!(node instanceof Element)) return false
  /*
   * 用 closest<HTMLElement>：纸面上带 data-field 的必然是 HTML 元素
   * （span / h1 / img 等），而 Element 上没有 dataset，后面每处都得再收窄一次。
   * 一次标注到位，也如实说明了「这个属性只挂在 HTML 元素上」。
   */
  const el = node.closest<HTMLElement>('[data-field]')
  if (!el) return false

  const sectionEl = el.closest<HTMLElement>('[data-sec-id]')
  const entryEl = el.closest<HTMLElement>('[data-item-id]')
  const target = resolveEditTarget(store.resume, {
    sectionId: sectionEl?.dataset.secId || '',
    field: el.dataset.field || '',
    // SectionBody 把条目/要点/meta 的 id 挂在最近的 data-item-id 上
    itemId: el.dataset.itemId || entryEl?.dataset.itemId || '',
    // 条目本身的 id 挂在 .r-entry 上，要点与 meta 需要它定位父条目
    entryId: el.closest<HTMLElement>('.r-entry')?.dataset.itemId || '',
  })
  if (!target) return false

  editTarget.value = target
  editAnchor.value = el
  // 选中该模块，右侧面板同步高亮，便于改完对照
  if (sectionEl?.dataset.secId) selection.replace([sectionEl.dataset.secId])
  return true
}

function closeInlineEdit() {
  editTarget.value = null
  editAnchor.value = null
  refreshLayout()
}

/**
 * 单击字段：把它设为「当前调整对象」（高亮 + 浮条），并为随后的拖拽做好准备。
 *
 * 拖拽本身在 pointerdown 阶段由 useFieldDrag 接管（见 onPaperPointerDown）——
 * 这里负责「单击且没拖」时字段仍保持选中，以及拦下这次点击、不让它跳右侧面板。
 * 就地编辑改由**双击**触发（见 onPaperDblClick）：单击要留给选中/拖动。
 *
 * 命中返回 true，调用方据此不再把这次点击当成「选中模块 / 跳右侧面板」。
 */
function selectFieldForNudge(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false
  const el = node.closest<HTMLElement>('[data-field-key]')
  if (!el) return false
  const key = el.dataset.fieldKey || ''
  const field = el.dataset.field || ''
  const sectionEl = el.closest<HTMLElement>('[data-sec-id]')
  const sectionId = sectionEl?.dataset.secId || ''
  if (!key || !field || !sectionId) return false

  fieldSelection.select({
    sectionId,
    fieldKey: key,
    field,
    label: FIELD_LABELS[field] || '字段',
  })
  // 同时选中所属模块：右侧面板高亮，改完能对照，也和模块选中保持一致的视觉语言
  selection.replace([sectionId])
  return true
}

/**
 * 被选中字段的高亮框（视口坐标）。null 表示没有字段被选中。
 *
 * 用 DOM 实测矩形，而不是把元素本身描个边 —— 字段分散在 12 套模板里，
 * 有些是行内 span、有些是 li / p，统一加外框还要逐模板写样式。这里用一个
 * 覆盖层（fixed 定位）盖在字段上方，与模板无关，也不影响排版与打印。
 */
const fieldBox = shallowRef<{ left: number; top: number; width: number; height: number } | null>(
  null,
)

function syncFieldBox() {
  if (!fieldSelection.active) {
    fieldBox.value = null
    return
  }
  const paper = paperRef.value
  if (!paper) {
    fieldBox.value = null
    return
  }
  const el = paper.querySelector<HTMLElement>(
    `[data-sec-id="${CSS.escape(fieldSelection.sectionId)}"] [data-field-key="${CSS.escape(fieldSelection.fieldKey)}"]`,
  )
  if (!el) {
    fieldBox.value = null
    return
  }
  const rect = el.getBoundingClientRect()
  fieldBox.value = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

const fieldBoxStyle = computed(() => {
  const box = fieldBox.value
  if (!box) return {}
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
})

/** 被选中字段当前的间距值，浮条里展示 W/A/S/D 调到了多少 */
const activeFieldLayout = computed(() => {
  if (!fieldSelection.active) return null
  const section = store.sections.find((s) => s.id === fieldSelection.sectionId)
  if (!section) return null
  return getFieldLayout(section, fieldSelection.fieldKey)
})

/**
 * 字段浮条的锚点：水平居中于字段、默认贴在字段**上方**；
 * 顶部空间不够时翻到字段下方，避免被顶栏 / 视口边缘裁掉。
 */
const fieldHintAnchor = computed<{ left: number; top: number } | null>(() => {
  const box = fieldBox.value
  if (!box) return null
  const centerX = Math.min(Math.max(box.left + box.width / 2, 120), window.innerWidth - 120)
  let top = box.top - 40
  if (top < 8) top = box.top + box.height + 8
  return { left: centerX, top }
})

/**
 * 纸面模块的操作提示。
 *
 * 光标是 grab（拖动排序仍是纸面上的主要直接操作），但这会让「点文字就能改」
 * 变得不可见，因此挂个 title 把几个操作都讲清楚。
 * 统一在纸张渲染后由本组件挂到各模板的模块上：12 个模板各写一遍必然会走样，
 * 而且这个提示属于预览区的交互，不属于模板自身的结构。
 *
 * 代价是光标停在纸张空白处也会显示该提示。相比逐模板改造的维护成本，这个取舍更划算；
 * 若以后觉得碍事，改成在 12 个模板里各写一次即可。
 */
const SECTION_TIP = '按住字段可拖动微调位置 · 双击文字编辑 · 按住模块空白处可排序'

/**
 * 把提示挂到纸上每个模块。模板切换后 DOM 是新的，所以要重新挂。
 * 只设 title、不动 DOM 结构，因此不会影响排版与打印（title 也不打印）。
 *
 * **只在确实需要时写**：refreshLayout() 在启动与每次改动后都会跑，
 * 无条件赋值会让每个模块都产生一次「属性变更 → 样式重算」的失效记录
 * （实测启动期间 Layout 占了 743 ms，是主要的阻塞来源）。
 * title 已经是目标值就直接跳过，把常规路径上的写操作降到 0。
 */
function applySectionTips() {
  const paper = paperRef.value
  if (!paper) return
  for (const el of paper.querySelectorAll<HTMLElement>('.r-sec[data-sec-id]')) {
    if (el.title !== SECTION_TIP) el.title = SECTION_TIP
  }
}

const templateComponent = computed(() => resolveTemplate(store.resume.template))
const paperStyle = computed(() => ({ ...store.pageStyle, '--zoom': zoom.value }))

/*
 * 拖拽模块时按「草稿顺序」渲染纸面。
 *
 * 拖动中只写 useDragPreview 里的纯内存顺序（不碰 store，见该文件开头的说明），
 * 松手才由 SectionList 落盘。这里把 resume 包一层：顺序用草稿的，其余字段不动。
 * 不在拖动中时 previewOrder 为 null，直接返回原对象，模板拿到的是同一个引用，
 * 不会产生多余的深层更新。
 */
const { previewOrder } = useDragPreview()
const previewResume = computed(() => {
  const order = previewOrder.value
  if (!order) return store.resume
  return {
    ...store.resume,
    sections: reorderSectionsByPreview(store.resume.sections, order),
  }
})

/** 落点指示线的视口定位 */
const dropLineStyle = computed(() => {
  const line = dropLine.value
  if (!line) return {}
  return {
    top: `${line.top}px`,
    left: `${line.left}px`,
    width: `${line.width}px`,
  }
})

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
 *
 * 另外要在**按下这一刻**先收尾上一次就地编辑。
 * 原因：`pressSection` 会 `event.preventDefault()`（阻止原生文字选择），
 * 这同时也**阻止了焦点转移** —— input 因此不会失焦，`blur` 事件永远不触发，
 * 「点别处即保存」就会静默失效（实测 blur 计数为 0、浮层仍开着、改动丢失）。
 * 所以这里不依赖 blur，按到纸面的瞬间主动提交。
 */
function onPaperPointerDown(event: PointerEvent) {
  if (editTarget.value) {
    // 先让浮层把草稿写回（它自己会 emit close），再继续后续的按下逻辑
    inlineEditorRef.value?.commitNow()
    closeInlineEdit()
  }
  /*
   * 先给「字段拖拽」一次接管机会：按在字段上要拖的是**这个字段**，
   * 不能落进下面的模块整组拖拽（否则整个模块被拖走）。被接管就直接返回。
   */
  if (onFieldPointerDown(event)) return
  onSectionPointerDown(event)
  onAvatarPointerDown(event)
}

/**
 * 纸面单击：把「点哪个模块 / 哪个字段就在哪儿操作」接起来。
 *
 * 单击分三种结果：
 *  - 点到**有 data-field-key 的字段**（正文、条目字段、要点…）→ 选中该字段，
 *    可按住直接拖动微调间距（拖动在 pointerdown 阶段由 useFieldDrag 接管，
 *    这里负责单击不拖时保持选中，见 selectFieldForNudge）；
 *  - 点到模块的其它地方 → 只选中该模块，并跳到右侧对应的编辑卡片；
 *  - 点到空白 / 页头 → 清空字段微调对象。
 * 按住 Ctrl/Cmd 时**直接返回，不跳也不动选中集** —— usePaperSelection 的
 * pressSection 已经在 pointerdown 里做了加选/去选；这里若再 toggle 一次，
 * 两次切换互相抵消，多选会彻底失效（此前踩过）。
 *
 * 就地编辑改由**双击**触发（见 onPaperDblClick）：单击要留给字段微调，
 * 否则 WASD 会在文本框里打字。三处守卫仍缺一不可：
 *  1. secDragging —— 框选或整组拖拽结束时也会派发 click，此时不该跳转；
 *  2. event.detail > 1 —— 双击的第二次点击不重复处理；
 *  3. 命中 .r-sec[data-sec-id] —— 点到页头、空白或头像时忽略模块跳转。
 */
function onPaperClick(event: MouseEvent) {
  if (secDragging.value) return
  if (event.detail > 1) return
  if (event.ctrlKey || event.metaKey) return

  // 字段微调优先：点在字段上就选中它，不绕去右侧面板、也不弹编辑框
  if (selectFieldForNudge(event.target)) return

  const target = event.target
  if (!(target instanceof Element)) return
  const hit = target.closest<HTMLElement>('.r-sec[data-sec-id]')
  if (!hit) {
    // 点在空白 / 页头：结束字段微调，避免 WASD 继续改一个看不见选中的旧字段
    fieldSelection.clear()
    return
  }
  const id = hit.dataset.secId
  if (!id) return

  selection.replace([id])
  focusSection(id)
}

/**
 * 纸面双击：在字段上就地改文字。
 *
 * 单击已被字段微调占用，双击作为「我要改这段文字」的显式手势。
 * 仍走 openInlineEdit（它自己会做字段解析并选中模块）。
 */
function onPaperDblClick(event: MouseEvent) {
  if (secDragging.value) return
  openInlineEdit(event.target)
}

/** 页数、头像边界与多选工具条位置都必须在 DOM 稳定后测量 */
async function refreshLayout() {
  await refresh()
  applySectionTips()
  syncLimits()
  syncToolbar()
  syncFieldBox()
}

/**
 * 把 refreshLayout 合并成「每帧最多一次」。
 *
 * 起因是启动性能实测：编辑器骨架要 3.4–3.8s 才出现，trace 显示 Layout 占 743ms，
 * 而 JS 执行几乎可忽略。根因是 refreshLayout 会被挂载、深度 watch、缩放、resize
 * 多处触发，而它内部有 4 组「读布局」操作（量纸高 / 挂 title / 量头像边界 / 量工具条）。
 * 每一组读之前若刚发生过 DOM 变更，浏览器就得把整棵深 DOM 重排一遍 ——
 * 短时间内触发 5 次就是 5 轮重排。
 *
 * 用 requestAnimationFrame 做闸门：一帧内多次请求只跑一次，
 * 且必然等 DOM 稳定后执行（rAF 在渲染前，此时布局本来就是干净的）。
 * 页数与工具条位置本来就只在稳定后才有意义，因此这不改变语义，只去掉重复。
 */
let layoutFrame = 0

function scheduleLayout() {
  if (layoutFrame) return
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0
    void refreshLayout()
  })
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

/**
 * 批量微调四个方向的间距，步长与范围与编辑面板的滑杆一致。
 *
 * 上下（extraGap / extraGapBottom）的范围是 -12~48，左右（indent / indentRight）
 * 是 -24~48 —— 与 SectionLayoutPanel 的 SPACING_FIELDS 和 server/sanitize.ts
 * 的 LAYOUT_RANGE 三处必须一致，否则会出现「面板里能拖到 48、工具条却卡在 40」
 * 这类看起来像 bug 的不一致（服务端越界会静默钳制，不会报错）。
 */
const LAYOUT_RANGES = {
  extraGap: { min: -12, max: 48 },
  extraGapBottom: { min: -12, max: 48 },
  indent: { min: -24, max: 48 },
  indentRight: { min: -24, max: 48 },
} as const

type LayoutAxis = keyof typeof LAYOUT_RANGES

function batchAdjustLayout(field: LayoutAxis, step: number) {
  const range = LAYOUT_RANGES[field]
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
  scheduleLayout()
  scrollRef.value?.addEventListener('scroll', syncFieldBox, { passive: true })
})

onBeforeUnmount(() => {
  if (layoutFrame) cancelAnimationFrame(layoutFrame)
  layoutFrame = 0
  scrollRef.value?.removeEventListener('scroll', syncFieldBox)
  document.getElementById(PRINT_STYLE_ID)?.remove()
})

watch(() => store.resume, scheduleLayout, { deep: true })
watch(zoom, () => {
  scheduleLayout()
  syncFieldBox()
})
watch(resizeTick, () => {
  scheduleLayout()
  syncFieldBox()
})

// 字段微调对象变化后立刻贴高亮框；字段间距被 WASD 改动时也要重测（元素可能变宽/位移）
watch(
  () => [fieldSelection.sectionId, fieldSelection.fieldKey],
  () => nextTick(syncFieldBox),
)
watch(
  () => store.resume,
  () => nextTick(syncFieldBox),
  { deep: true },
)

/**
 * 逐步收紧字号、行距与模块间距，直到内容落进一页为止。
 * 每轮修改后等待 DOM 更新再重新测量。
 */
async function compressToOnePage() {
  if (compressing.value) return
  compressing.value = true

  try {
    const round2 = (value: number) => Number(value.toFixed(2))
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
        :data-sec-tip="SECTION_TIP"
        @pointerdown="onPaperPointerDown"
        @click="onPaperClick"
        @dblclick="onPaperDblClick"
      >
        <component :is="templateComponent" :resume="previewResume" :selected-ids="selection.ids" />
      </div>
    </div>

    <!-- 选中字段的高亮框：盖在字段上，提示「现在调的是这个字段」 -->
    <div v-if="fieldBox" class="field-box no-print" :style="fieldBoxStyle"></div>

    <FieldNudgeHint
      v-if="fieldHintAnchor && activeFieldLayout"
      :anchor="fieldHintAnchor"
      :label="fieldSelection.label"
      :layout="activeFieldLayout"
    />

    <InlineEditor
      ref="inlineEditorRef"
      :target="editTarget"
      :anchor="editAnchor"
      :boundary="paperRef"
      @close="closeInlineEdit"
    />

    <div v-if="bandRect" class="sel-band no-print" :style="bandStyle"></div>
    <!--
    落点指示线：拖动时告诉用户「松手会插到这里」。
    没有它的话，「拖了没换位」与「拖了但没拖够」在视觉上是同一件事，
    用户就会觉得拖不动。
  -->
    <div v-if="dropLine" class="drop-line no-print" :style="dropLineStyle"></div>

    <SelectionToolbar
      v-if="toolbarAnchor"
      :anchor="toolbarAnchor"
      :count="selection.count"
      @toggle-visible="batchToggleVisible"
      @adjust="batchAdjustLayout"
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

/* 画布：灰阶渐变 + 品牌晕光 + 极淡点阵（--ed-canvas 随主题色联动），设计工具工作台质感 */
.stage-scroll {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
  padding: 26px 28px 64px;
  overflow: auto;
  background: var(--ed-canvas);
  /* 滚到底后不要继续带动外层（移动端会触发下拉刷新/橡皮筋） */
  overscroll-behavior: contain;
}

.paper {
  flex: 0 0 auto;
  box-shadow: var(--ed-paper-shadow);
}

/*
 * 可拖动微调的字段：给 grab 光标，暗示「能抓住拖」。
 * 拖动中切成 grabbing 并提到上层，避免被相邻文字盖住。
 * 用 :deep 穿透到模板内部元素 —— 字段散落在 12 套模板里，逐个加类不现实。
 */
.paper :deep([data-field-key]) {
  cursor: grab;
}

.paper :deep([data-field-key].is-field-dragging) {
  position: relative;
  z-index: 5;
  cursor: grabbing;
}

/* 框选矩形：视口定位的 overlay，不参与打印（no-print）也不拦截指针 */
/*
   * 落点指示线：2px 实线 + 两端圆点，压在纸面上方。
   * 用主题色，与框选的虚线区分开（一个是「已选中」，一个是「将要插入」）。
   */
.drop-line {
  position: fixed;
  z-index: 30;
  height: 2px;
  border-radius: 1px;
  background: var(--ed-brand, #111);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
  pointer-events: none;
  transform: translateY(-1px);
}

.drop-line::before,
.drop-line::after {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ed-brand, #111);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
  transform: translateY(-50%);
  content: '';
}

.drop-line::before {
  left: -3px;
}

.drop-line::after {
  right: -3px;
}

.sel-band {
  position: fixed;
  z-index: 50;
  border: 1px solid var(--ed-brand-strong);
  border-radius: 3px;
  background: var(--ed-brand-ring);
  pointer-events: none;
}

/* 字段微调高亮框：只描边、不拦截指针（下面的文字仍可双击编辑） */
.field-box {
  position: fixed;
  z-index: 55;
  border: 1.5px solid var(--ed-brand-strong, #111);
  border-radius: 4px;
  box-shadow: 0 0 0 2px var(--ed-brand-ring, rgba(0, 0, 0, 0.08));
  pointer-events: none;
}

@media (max-width: 900px) {
  /* 窄屏这一栏独占宽度，把留白收紧换成纸张空间。
     usePaperZoom 的 fit() 直接读实际内边距，改这里不需要同步改常量。
     底部给悬浮工具条留位置，并叠加 iPhone 手势条的安全区。 */
  .stage-scroll {
    padding: 12px 14px calc(52px + env(safe-area-inset-bottom, 0px));
  }

  .paper {
    box-shadow: var(--ed-shadow-float);
  }
}
</style>
