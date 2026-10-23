<script setup lang="ts">
/**
 * 表达助手：一条要点的两个视角。
 *
 *   本地建议  —— 规则引擎（utils/expression.ts）当场给出的判断，不联网、不需要登录。
 *                每条都说明「为什么这么判」，并提供可以逐个点开的替换候选。
 *   措辞改写  —— 愿意的话接你自己的模型服务做一次改写（客户端 utils/aiClient.ts）。
 *                默认不在第一屏，需要点时才会出现。
 *
 * 为什么这样组织，而不是做成一个「AI 润色」按钮：
 *  1. 判断权在人手里。规则给的是**可以反驳的理由**，模型给的是一段结果 ——
 *     两者的分量不同，不该放在同一个按钮后面。
 *  2. 打不开网络时第一屏仍然有用。离线可用不是加分项，是底线：
 *     简历这件事不该因为没配 Key 就完全没法用。
 *  3. 名字要诚实。它做的是「检查表达 + 可选改写」，不是「AI」。
 *
 * 应用任何改动都必须用户点一次才生效；本组件从不直接写 store。
 */
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import AISettingsDialog from '@/components/AISettingsDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { useToast } from '@/composables/useToast'
import { analyzeBullet } from '@/utils/expression'
import type { EntryKind, Finding, FindingSpan } from '@/utils/expression'
import type { RuleReplacement } from '@/data/writingRules'
import { aiChat, buildPolishMessages, stripMarkdown } from '@/utils/aiClient'
import { loadAISettings } from '@/utils/aiKeyStore'

const props = withDefaults(
  defineProps<{
    open?: boolean
    /** 段落走 summary：整段文字没有「动词开头」这类要求 */
    kind?: 'bullet' | 'summary'
    title?: string
    text?: string
    /** 这条要点属于哪类经历，决定要不要套动作句式的规则 */
    entryKind?: EntryKind
    /** 同段其它要点，用于重复检测 */
    siblings?: string[]
  }>(),
  {
    open: false,
    kind: 'bullet',
    title: '表达助手',
    text: '',
    entryKind: 'work',
    siblings: () => [],
  },
)

const emit = defineEmits<{ close: []; apply: [text: string] }>()

const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

const TAB_LOCAL = 'local'
const TAB_REWRITE = 'rewrite'
const tab = shallowRef<typeof TAB_LOCAL | typeof TAB_REWRITE>(TAB_LOCAL)

const source = shallowRef('')
const result = shallowRef('')
const busy = shallowRef(false)
const error = shallowRef('')
const settingsOpen = shallowRef(false)
const configured = shallowRef(false)

/** 本地建议：每次打开按当前原文算一次；在弹窗里直接编辑原文后重算 */
const findings = computed<Finding[]>(() => {
  if (props.kind === 'summary') return []
  return analyzeBullet(source.value, { entryKind: props.entryKind, siblings: props.siblings })
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    source.value = props.text
    result.value = ''
    error.value = ''
    // 每次都回到「本地建议」：这是不需要任何前提就能用的那半边
    tab.value = TAB_LOCAL
    configured.value = Boolean(loadAISettings())
  },
)

/**
 * 把一处替换应用到原文。
 *
 * 不用 String.replace(str, ...) 而按 span 精确切：同一句里可能出现两次「负责」，
 * 用户点第二条候选时不能把第一条也改掉。
 *
 * 位置来自 `spanFor(replacement)`：该候选词**自己**在原文里的位置，
 * 而不是固定的 spans[0]。原先一律取 spans[0]，于是在「负责…参与…」这种句子里
 * 点「参与 → 承担」会把开头的「负责」改成「承担」，用户看到的是「点了没反应」。
 */
function applyReplacement(replacement: RuleReplacement): void {
  const span = spanFor(replacement)
  if (!span) return
  const text = source.value
  source.value = `${text.slice(0, span.start)}${replacement.to}${text.slice(span.end)}`
}

/** 某个替换候选在原文里的位置；找不到时退回命中列表的第一处 */
function spanFor(replacement: RuleReplacement): FindingSpan | null {
  const pos = source.value.indexOf(replacement.from)
  if (pos >= 0) return { start: pos, end: pos + replacement.from.length }
  return null
}

/** 选中整条要点并应用（用于「这条就这样」） */
function applyAsIs(): void {
  emit('apply', source.value.trim())
  emit('close')
}

async function rewrite(): Promise<void> {
  if (busy.value) return
  const settings = loadAISettings()
  if (!settings) {
    settingsOpen.value = true
    return
  }
  const text = source.value.trim()
  if (!text) {
    toast('先填写内容再改写')
    return
  }

  busy.value = true
  error.value = ''
  try {
    const content = await aiChat({
      settings,
      messages: buildPolishMessages(props.kind, text),
      // 改写沿用较低温度：简历措辞不需要「创意」，需要稳定
      temperature: 0.4,
    })
    result.value = stripMarkdown(content)
  } catch (requestError) {
    const err = requestError as { code?: string; message?: string }
    error.value =
      err.code === 'AUTH_EXPIRED' ? '这一步需要先登录' : err.message || '改写没有成功，请稍后再试'
  } finally {
    busy.value = false
  }
}

function applyResult(): void {
  const text = result.value.trim()
  if (!text) return
  emit('apply', text)
  emit('close')
}

const LEVEL_LABEL: Record<Finding['level'], string> = {
  error: '硬伤',
  warn: '值得改',
  tip: '可以更好',
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ea-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="ea-card"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <div class="ea-head">
          <h3 class="ea-title">{{ title }}</h3>
          <button class="ea-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <!-- 原文：两个页签共用。允许在这里直接改，改完建议会立刻跟着变 -->
        <label class="ea-field">
          <span>原文</span>
          <textarea v-model="source" class="ed-textarea" rows="3"></textarea>
        </label>

        <div class="ea-tabs" role="tablist" aria-label="表达助手的两种视角">
          <button
            role="tab"
            class="ea-tab"
            :class="{ 'is-active': tab === TAB_LOCAL }"
            :aria-selected="tab === TAB_LOCAL"
            @click="tab = TAB_LOCAL"
          >
            本地建议
          </button>
          <button
            role="tab"
            class="ea-tab"
            :class="{ 'is-active': tab === TAB_REWRITE }"
            :aria-selected="tab === TAB_REWRITE"
            @click="tab = TAB_REWRITE"
          >
            措辞改写
          </button>
        </div>

        <!-- ---------- 本地建议 ---------- -->
        <div v-if="tab === TAB_LOCAL" class="ea-body">
          <p v-if="kind === 'summary'" class="ea-empty">
            整段文字不套用「动词开头」那套规则。要看逐条诊断，请到经历里的每条要点上点开表达助手。
          </p>
          <p v-else-if="!source.trim()" class="ea-empty">
            先写一句话，这里会逐条告诉你哪里还能更好。
          </p>
          <p v-else-if="!findings.length" class="ea-ok">
            这条没有发现明显问题：有具体动作，也有能核对的数字。
          </p>

          <ul v-else class="ea-list">
            <li v-for="(finding, fi) in findings" :key="finding.ruleId" class="ea-item">
              <div class="ea-item-head">
                <span class="ea-level" :class="`is-${finding.level}`">
                  {{ LEVEL_LABEL[finding.level] }}
                </span>
                <span class="ea-item-title">{{ finding.title }}</span>
              </div>
              <p class="ea-item-detail">{{ finding.detail }}</p>

              <!-- 命中的原文片段：让人知道「说的是哪一处」 -->
              <p v-if="finding.spans.length" class="ea-spans">
                命中：<mark v-for="(span, si) in finding.spans" :key="si">{{
                  source.slice(span.start, span.end)
                }}</mark>
              </p>

              <div v-if="finding.replacements.length" class="ea-fixes">
                <button
                  v-for="(rep, ri) in finding.replacements"
                  :key="`${fi}-${ri}`"
                  class="ea-fix"
                  :title="rep.note || ''"
                  @click="applyReplacement(rep)"
                >
                  <span class="ea-fix-from">{{ rep.from }}</span>
                  <span class="ea-fix-arrow" aria-hidden="true">→</span>
                  <span class="ea-fix-to">{{ rep.to || '删掉' }}</span>
                  <span v-if="rep.note" class="ea-fix-note">{{ rep.note }}</span>
                </button>
              </div>
            </li>
          </ul>

          <div class="ea-actions">
            <button class="ed-btn ed-btn-primary" :disabled="!source.trim()" @click="applyAsIs">
              <SvgIcon name="check" :size="14" />
              <span>用这段文字</span>
            </button>
            <span class="ea-spacer"></span>
            <span class="ea-hint-inline">不需要联网</span>
          </div>
        </div>

        <!-- ---------- 措辞改写 ---------- -->
        <div v-else class="ea-body">
          <p class="ea-caveat">
            改写会把你这段话发给你自己配置的模型服务。它可能补充你没写过的表达 ——
            <strong>应用前请逐句核对事实</strong>。
          </p>

          <p v-if="!configured" class="ea-setup">
            还没有配置模型服务。填入你自己的 API Key 即可使用，配置只保存在本机。
            <button class="ea-setup-btn" @click="settingsOpen = true">去设置</button>
          </p>

          <label v-if="result || busy || error" class="ea-field">
            <span>改写结果（可以直接改）</span>
            <textarea v-model="result" class="ed-textarea" rows="3"></textarea>
          </label>
          <p v-if="error" class="ea-error" role="alert">{{ error }}</p>

          <div class="ea-actions">
            <button
              class="ed-btn ed-btn-primary"
              :disabled="busy || !source.trim()"
              @click="rewrite"
            >
              <span>{{ busy ? '改写中…' : result ? '重新改写' : '改写这段话' }}</span>
            </button>
            <span class="ea-spacer"></span>
            <button class="ed-btn" :disabled="!result.trim()" @click="applyResult">
              <SvgIcon name="check" :size="14" />
              <span>应用改写结果</span>
            </button>
          </div>
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
.ea-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ed-overlay);
}

.ea-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 460px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.ea-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ea-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.ea-close {
  display: inline-flex;
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

.ea-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.ea-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.ea-field > span {
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.ea-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  padding: 3px;
  border-radius: var(--ed-radius-seg-outer);
  background: var(--ed-fill);
}

.ea-tab {
  flex: 1 1 0;
  min-height: 28px;
  border: none;
  border-radius: var(--ed-radius-seg-inner);
  background: transparent;
  color: var(--ed-text-2);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: 0.15s;
}

.ea-tab:hover {
  color: var(--ed-ink);
  background: var(--ed-fill-2);
}

.ea-tab.is-active {
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-xs);
  color: var(--ed-ink);
  font-weight: 600;
}

/* 选中态被 :hover 盖住会看不出鼠标在哪 —— 这是本项目查出多次的模式 */
.ea-tab.is-active:hover {
  background: var(--ed-surface);
  filter: brightness(0.97);
}

.ea-body {
  display: block;
}

.ea-empty,
.ea-ok {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.6;
}

.ea-empty {
  color: var(--ed-text-3);
}

.ea-ok {
  color: var(--ed-text-2);
}

.ea-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.ea-item {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ed-line);
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
}

.ea-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ea-level {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--ed-radius-xs);
  font-size: 11px;
  font-weight: 600;
}

.ea-level.is-warn {
  background: var(--ed-warn-tint);
  color: var(--ed-warn);
}

.ea-level.is-tip,
.ea-level.is-error {
  background: var(--ed-fill);
  color: var(--ed-text-2);
}

.ea-item-title {
  color: var(--ed-ink);
  font-size: 12.5px;
  font-weight: 600;
}

.ea-item-detail {
  margin: 6px 0 0;
  color: var(--ed-text-2);
  font-size: 12px;
  line-height: 1.65;
}

.ea-spans {
  margin: 6px 0 0;
  color: var(--ed-text-3);
  font-size: 12px;
}

.ea-spans mark {
  margin: 0 2px;
  padding: 0 3px;
  border-radius: var(--ed-radius-xs);
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
}

.ea-fixes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ea-fix {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid var(--ed-line-2);
  border-radius: var(--ed-radius-sm);
  background: var(--ed-surface);
  color: var(--ed-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: 0.15s;
}

.ea-fix:hover {
  border-color: var(--ed-brand-border);
  background: var(--ed-fill);
  color: var(--ed-ink);
}

.ea-fix-from {
  color: var(--ed-text-3);
  text-decoration: line-through;
}

.ea-fix-arrow {
  color: var(--ed-text-4);
}

.ea-fix-to {
  font-weight: 600;
}

.ea-fix-note {
  color: var(--ed-text-3);
  font-weight: 400;
}

.ea-caveat {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
  color: var(--ed-text-2);
  font-size: 12px;
  line-height: 1.65;
}

.ea-setup {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px dashed var(--ed-line-2);
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.6;
}

.ea-setup-btn {
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

.ea-error {
  margin: 0 0 12px;
  color: var(--ed-danger-strong);
  font-size: 12.5px;
}

.ea-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ea-spacer {
  flex: 1 1 auto;
}

.ea-hint-inline {
  color: var(--ed-text-3);
  font-size: 11.5px;
}
</style>
