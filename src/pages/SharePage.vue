<script setup>
/**
 * 简历分享只读页（/share/:id）。
 *
 * 拿到分享快照后按其主题渲染 A4 纸张：页样式与打印边距复用
 * utils/resumeStyle.js 的纯函数，与编辑器所见一致。
 * 复用 paper.css 的画布约定类名（.editor-app/.editor-topbar/.editor-stage），
 * 打印时顶栏自动隐藏，纸张原样输出。
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
import { useRoute, useRouter } from 'vue-router'

import SvgIcon from '@/components/SvgIcon.vue'
import { MM_TO_PX, PAGE } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'
import { resolveTemplate } from '@/templates'
import { applyChromeAccent } from '@/utils/helpers'
import { computePageStyle, computePrintCss } from '@/utils/resumeStyle'
import { fetchShare } from '@/utils/shareApi'

const route = useRoute()
const router = useRouter()
const store = useResumeStore()

const state = shallowRef('loading') // loading | ready | error
const errorMessage = shallowRef('')
const shared = shallowRef(null) // { resume, createdAt, expiresAt }

const templateComponent = computed(() =>
  shared.value ? resolveTemplate(shared.value.resume.template) : null,
)
const pageStyle = computed(() => (shared.value ? computePageStyle(shared.value.resume) : undefined))

/** 纸张缩放：按窗口宽度自适应，与编辑器 fit() 同规则 */
const zoom = shallowRef(1)
const stageRef = useTemplateRef('stageRef')

function fit() {
  const el = stageRef.value
  if (!el) return
  const style = getComputedStyle(el)
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  const available = el.clientWidth - padding
  zoom.value = Math.max(
    0.3,
    Math.min(1, Math.round((available / (PAGE.width * MM_TO_PX)) * 100) / 100),
  )
}

let printStyleEl = null

function applyPrintCss() {
  if (!printStyleEl) {
    printStyleEl = document.createElement('style')
    printStyleEl.id = 'share-print-page'
    document.head.appendChild(printStyleEl)
  }
  printStyleEl.textContent = shared.value ? computePrintCss(shared.value.resume) : ''
}

/** 请求序号：快速切换分享 id 时，慢返回的旧响应不得覆盖新响应 */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  state.value = 'loading'
  try {
    const data = await fetchShare(route.params.id)
    if (seq !== loadSeq) return
    shared.value = data
    state.value = 'ready'
    applyChromeAccent(data.resume.theme?.accent)
    applyPrintCss()
  } catch (error) {
    if (seq !== loadSeq) return
    state.value = 'error'
    errorMessage.value = error.message || '分享读取失败'
  }
}

watch(() => route.params.id, load, { immediate: true })

/** 纸张要等 state 变 ready 才渲染进 DOM：就绪后补算一次缩放，否则窄屏首开溢出 */
watch(state, (value) => {
  if (value === 'ready') nextTick(fit)
})

/** 主题变化时同步界面品牌色 */
watch(
  () => shared.value?.resume.theme?.accent,
  (accent) => applyChromeAccent(accent),
)

/** 把分享内容存为本机新文档，带去编辑器继续编辑 */
function openInEditor() {
  if (!shared.value) return
  store.importAsDoc(shared.value.resume)
  router.push({ name: 'editor' })
}

function printResume() {
  window.print()
}

onMounted(() => {
  window.addEventListener('resize', fit)
  fit()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', fit)
  printStyleEl?.remove()
  // 品牌色写在 :root 上是全局的：离开分享页时交还给本地简历的主题，
  // 否则「回编辑器看看」后外壳仍停留在分享简历的配色
  applyChromeAccent(store.resume.theme?.accent)
})

const expiryText = computed(() => {
  if (!shared.value) return ''
  const days = Math.max(1, Math.ceil((shared.value.expiresAt - Date.now()) / 86400000))
  return `链接有效期约 ${days} 天`
})
</script>

<template>
  <div class="editor-app">
    <header class="editor-topbar">
      <div class="sp-brand">
        <span class="sp-logo"><SvgIcon name="layout" :size="15" /></span>
        <span class="sp-name">简历工坊</span>
        <span class="sp-chip">分享预览</span>
      </div>

      <div class="spacer"></div>

      <span v-if="shared" class="sp-expiry">{{ expiryText }}</span>

      <button
        v-if="state === 'ready'"
        class="ed-btn"
        title="在打印窗口另存为 PDF：需手动勾选「背景图形」"
        @click="printResume"
      >
        <SvgIcon name="print" :size="14" />
        <span>打印 / 存 PDF</span>
      </button>
      <button v-if="state === 'ready'" class="ed-btn ed-btn-primary" @click="openInEditor">
        <SvgIcon name="download" :size="14" />
        <span>导入到我的编辑器</span>
      </button>
    </header>

    <main class="editor-stage">
      <div v-if="state === 'loading'" class="sp-note">正在加载分享内容…</div>

      <div v-else-if="state === 'error'" class="sp-note">
        <p class="sp-error">{{ errorMessage }}</p>
        <router-link class="ed-btn" :to="{ name: 'editor' }">回编辑器看看</router-link>
      </div>

      <div v-else ref="stageRef" class="stage-scroll">
        <div
          class="paper"
          :style="{ ...pageStyle, '--zoom': zoom }"
          :data-tstyle="shared.resume.theme.titleStyle"
          :data-marker="shared.resume.theme.titleMarker"
          :data-line="shared.resume.theme.titleBottom"
          :data-shape="shared.resume.basics.avatarShape"
        >
          <component :is="templateComponent" :resume="shared.resume" :selected-ids="[]" />
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 顶栏与骨架复用 paper.css 的画布约定类名（打印时 .editor-topbar/.editor-stage 会被隐藏） */
.editor-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

@supports (height: 100dvh) {
  .editor-app {
    height: 100dvh;
  }
}

.editor-topbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--ed-line-soft);
  background: var(--ed-surface);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
  flex-wrap: wrap;
}

.editor-stage {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.sp-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sp-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--ed-brand-grad-hi) 0%, var(--ed-brand-strong) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    var(--ed-brand-glow);
  color: #fff;
}

.sp-name {
  color: var(--ed-ink);
  font-size: 15px;
  font-weight: 700;
}

.sp-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 12px;
}

.spacer {
  flex: 1 1 auto;
}

.sp-expiry {
  color: var(--ed-text-4);
  font-size: 12px;
  white-space: nowrap;
}

.sp-note {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--ed-text-3);
  font-size: 13.5px;
}

.sp-error {
  margin: 0;
  color: var(--ed-danger-strong);
}

.stage-scroll {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
  padding: 26px 28px 34px;
  overflow: auto;
  background-color: #f3f4f6;
  background-image: radial-gradient(rgba(16, 24, 40, 0.075) 1px, transparent 1.6px);
  background-size: 24px 24px;
}

.paper {
  flex: 0 0 auto;
  box-shadow: var(--ed-paper-shadow);
}

@media (max-width: 900px) {
  .stage-scroll {
    padding: 12px 14px calc(16px + env(safe-area-inset-bottom, 0px));
  }

  .sp-expiry {
    display: none;
  }
}
</style>
