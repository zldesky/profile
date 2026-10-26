<script setup lang="ts">
/**
 * 岗位对照弹窗：粘贴目标岗位 JD → 与简历逐条比对 → 已覆盖/缺失关键词与修改建议。
 * 走与「表达助手」同一条通道（本机服务转发，Key 即用即弃）；
 * 未配置模型服务时内嵌提示并可直接打开设置弹窗。结果只做参考，改动仍由用户手动完成。
 *
 * 布局上刻意分成三段：**头部固定 / 中间滚动 / 底部动作固定**。
 * 原先整张卡片 `overflow-y: auto`，报告一长就出现一条贯穿全高的滚动条，
 * 滚下去之后标题和「重新分析」按钮都不见了 —— 既不好看，也不方便接着操作。
 * 现在只有中间的 .jd-body 滚动，且滚动条做细（与右侧面板同一套写法）。
 */
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import AISettingsDialog from '@/components/AISettingsDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import {
  aiChat,
  buildJdMatchMessages,
  parseJdMatchResult,
  summarizeResumeForAI,
} from '@/utils/aiClient'
import { loadAISettings } from '@/utils/aiKeyStore'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const store = useResumeStore()
const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

const jd = shallowRef('')
/**
 * 匹配结果。`parseJdMatchResult` 仍在 JS 里（utils/aiClient.js），
 * shallowRef(null) 会被推成 Ref<null>，下面读 .matched 就报 never。
 * 就近声明所需形状，比为了一个返回值去转整个 AI 客户端更划算。
 */
interface JdMatchResult {
  matched: { kw: string; note: string }[]
  missing: { kw: string; note: string }[]
  suggestions: string[]
}

const result = shallowRef<JdMatchResult | null>(null)
const busy = shallowRef(false)
const error = shallowRef('')
const settingsOpen = shallowRef(false)
/** 模型服务是否已配置；打开弹窗与保存设置后各检查一次 */
const configured = shallowRef(false)

/**
 * 出结果后把 JD 输入框收成一行摘要。
 *
 * 理由：报告本身就够长，再让一个 6 行的输入框占着顶部，用户每次看结果都得先滚过它。
 * 收起后给一行「已粘贴 N 字 · 修改」，需要改就点一下展开 —— 信息没丢，位置省下来了。
 */
const editingJd = shallowRef(false)
const jdCollapsed = computed(() => Boolean(result.value) && !editingJd.value)
const jdLength = computed(() => jd.value.trim().length)

/** 报告概览：一句话讲清「命中多少、缺多少」，比直接铺三块列表更好扫 */
const summary = computed(() => {
  const data = result.value
  if (!data) return ''
  const parts: string[] = []
  if (data.matched.length) parts.push(`已覆盖 ${data.matched.length} 项`)
  if (data.missing.length) parts.push(`缺失 ${data.missing.length} 项`)
  if (data.suggestions.length) parts.push(`${data.suggestions.length} 条建议`)
  return parts.join(' · ')
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    result.value = null
    error.value = ''
    editingJd.value = false
    configured.value = Boolean(loadAISettings())
  },
)

function expandJd() {
  editingJd.value = true
}

async function match() {
  if (busy.value) return
  const settings = loadAISettings()
  if (!settings) {
    settingsOpen.value = true
    return
  }
  const text = jd.value.trim()
  if (text.length < 15) {
    toast('JD 内容太短，粘贴完整的岗位职责与任职要求效果更好')
    return
  }

  busy.value = true
  error.value = ''
  try {
    const content = await aiChat({
      settings,
      messages: buildJdMatchMessages(
        summarizeResumeForAI(store.resume),
        text,
        store.basics.jobTitle,
      ) as { role: 'system' | 'user' | 'assistant'; content: string }[],
      temperature: 0.3,
    })
    result.value = parseJdMatchResult(content)
    // 出结果后自动收起输入框，让报告直接露出来
    editingJd.value = false
  } catch (requestError) {
    const err = requestError as { code?: string; message?: string }
    if (err.code === 'AUTH_EXPIRED') {
      error.value = '这一步需要先登录'
    } else {
      error.value = err.message || '对照失败，请稍后再试'
    }
  } finally {
    busy.value = false
  }
}

/** 把结果拼成纯文本报告，方便贴给招聘顾问或存档 */
async function copyReport() {
  if (!result.value) return
  const { matched, missing, suggestions } = result.value
  const lines = ['岗位对照报告', '']
  if (matched.length) {
    lines.push('已覆盖的关键词：')
    matched.forEach((item) => lines.push(`- ${item.kw}${item.note ? `（${item.note}）` : ''}`))
    lines.push('')
  }
  if (missing.length) {
    lines.push('缺失的关键词：')
    missing.forEach((item) => lines.push(`- ${item.kw}${item.note ? `（${item.note}）` : ''}`))
    lines.push('')
  }
  if (suggestions.length) {
    lines.push('修改建议：')
    suggestions.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    toast('报告已复制到剪贴板')
  } catch {
    toast('复制失败，请手动选择文本复制')
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="jd-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="jd-card"
        role="dialog"
        aria-modal="true"
        aria-label="岗位对照"
        tabindex="-1"
      >
        <!-- 头部固定：滚动报告时标题与关闭按钮始终在位 -->
        <div class="jd-head">
          <h3 class="jd-title">
            <SvgIcon name="sparkles" :size="15" />
            <span>岗位对照</span>
            <span v-if="summary" class="jd-summary">{{ summary }}</span>
          </h3>
          <button class="jd-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <!-- 中间是唯一的滚动区 -->
        <div class="jd-body">
          <label v-if="!jdCollapsed" class="jd-field">
            <span>岗位 JD（岗位职责与任职要求，粘贴进来）</span>
            <textarea
              v-model="jd"
              class="ed-textarea"
              rows="6"
              placeholder="例如：负责 XX 业务前端开发，要求熟悉 Vue3、TypeScript，有大型项目性能优化经验…"
            ></textarea>
          </label>

          <p v-else class="jd-jd-collapsed">
            <SvgIcon name="text" :size="13" />
            <span>已粘贴 {{ jdLength }} 字</span>
            <button class="jd-link-btn" @click="expandJd">修改</button>
          </p>

          <p v-if="!configured" class="jd-setup">
            还没有配置模型服务。填入你自己的 API Key 即可使用，配置只保存在本机。
            <button class="jd-setup-btn" @click="settingsOpen = true">去设置</button>
          </p>

          <template v-if="result">
            <div v-if="result.matched.length" class="jd-block">
              <p class="jd-block-title">
                <SvgIcon name="check" :size="13" />
                简历已覆盖（{{ result.matched.length }}）
              </p>
              <div class="jd-chips">
                <span
                  v-for="item in result.matched"
                  :key="item.kw"
                  class="jd-chip is-ok"
                  :title="item.note"
                >
                  {{ item.kw }}
                </span>
              </div>
            </div>

            <div v-if="result.missing.length" class="jd-block">
              <p class="jd-block-title is-miss">
                <SvgIcon name="close" :size="13" />
                JD 要求但简历缺失（{{ result.missing.length }}）
              </p>
              <ul class="jd-missing">
                <li v-for="item in result.missing" :key="item.kw">
                  <span class="jd-chip is-miss-chip">{{ item.kw }}</span>
                  <span v-if="item.note" class="jd-miss-note">{{ item.note }}</span>
                </li>
              </ul>
            </div>

            <div v-if="result.suggestions.length" class="jd-block">
              <p class="jd-block-title">
                <SvgIcon name="text" :size="13" />
                修改建议
              </p>
              <ol class="jd-suggestions">
                <li v-for="(item, index) in result.suggestions" :key="index">{{ item }}</li>
              </ol>
            </div>
          </template>

          <p v-if="error" class="jd-error" role="alert">{{ error }}</p>
        </div>

        <!-- 底部动作固定：滚到报告底部也不用再找按钮 -->
        <div class="jd-actions">
          <button class="ed-btn ed-btn-primary" :disabled="busy || !jd.trim()" @click="match">
            <SvgIcon name="sparkles" :size="14" />
            <span>{{ busy ? '分析中…' : result ? '重新分析' : '开始匹配' }}</span>
          </button>
          <span class="jd-spacer"></span>
          <button class="ed-btn" :disabled="!result" @click="copyReport">
            <SvgIcon name="copy" :size="14" />
            <span>复制报告</span>
          </button>
        </div>

        <AISettingsDialog
          :open="settingsOpen"
          @close="settingsOpen = false"
          @saved="configured = true"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.jd-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ed-overlay);
}

/*
 * 三段式纵向布局：头部与底部不参与滚动，只有 .jd-body 滚。
 * 卡片自身 overflow: hidden，滚动条只出现在中间区域内部 ——
 * 这是「弹窗里有条贯穿全高滚动条」的正解。
 */
.jd-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 520px;
  max-height: calc(100vh - 40px);
  overflow: hidden;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.jd-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.jd-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

/* 概览胶囊：一句话交代「命中/缺失/建议」各多少，比铺三块列表更好扫 */
.jd-summary {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: var(--ed-radius-pill);
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 11.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.jd-close {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--ed-radius-sm);
  background: transparent;
  color: var(--ed-text-4);
  cursor: pointer;
}

.jd-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.jd-body {
  flex: 1 1 auto;
  min-height: 0;
  /* 右侧留一点余量给滚动条，避免它压住内容右缘 */
  padding-right: 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 细滚动条：与 .panel-body / .stage-scroll 同一套写法（见 editor.css） */
  scrollbar-width: thin;
  scrollbar-color: var(--ed-line-3) transparent;
}

.jd-body::-webkit-scrollbar {
  width: 8px;
}

.jd-body::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--ed-line-3);
  background-clip: padding-box;
}

.jd-body::-webkit-scrollbar-thumb:hover {
  background: var(--ed-text-5);
  background-clip: padding-box;
}

.jd-body::-webkit-scrollbar-track {
  background: transparent;
}

.jd-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.jd-field > span {
  color: var(--ed-text-2);
  font-size: 12.5px;
}

/* 收起后的 JD 摘要：一行，带一个「修改」入口 */
.jd-jd-collapsed {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
  padding: 6px 10px;
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
  color: var(--ed-text-3);
  font-size: 12px;
}

.jd-jd-collapsed :deep(.svg-icon) {
  flex: 0 0 auto;
}

.jd-link-btn {
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--ed-brand-strong);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

.jd-setup {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px dashed var(--ed-line-2);
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.6;
}

.jd-setup-btn {
  margin-left: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ed-brand-strong);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

.jd-block {
  margin-bottom: 12px;
}

.jd-block-title {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 6px;
  color: var(--ed-ink);
  font-size: 12.5px;
  font-weight: 600;
}

.jd-block-title.is-miss {
  color: var(--ed-danger-strong);
}

.jd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jd-chip {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
}

.jd-chip.is-ok {
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
}

.jd-missing {
  margin: 0;
  padding: 0;
  list-style: none;
}

.jd-missing li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
}

.jd-chip.is-miss-chip {
  flex: 0 0 auto;
  background: var(--ed-danger-tint);
  color: var(--ed-danger-strong);
}

.jd-miss-note {
  color: var(--ed-text-2);
  font-size: 12px;
  line-height: 1.5;
}

.jd-suggestions {
  margin: 0;
  padding-left: 18px;
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.jd-error {
  margin: 0 0 12px;
  color: var(--ed-danger-strong);
  font-size: 12.5px;
}

/* 底部动作区：与滚动区分开，滚到哪儿都够得着 */
.jd-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--ed-line-soft);
}

.jd-spacer {
  flex: 1 1 auto;
}
</style>
