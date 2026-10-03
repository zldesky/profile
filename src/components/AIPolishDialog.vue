<script setup>
/**
 * AI 润色弹窗：原文（可先改）→ 调用 AI 改写 → 结果（可再手改）→ 应用回简历。
 * 未配置 AI 服务时内嵌提示并可直接打开设置弹窗；所有改写都是用户确认后才落库。
 */
import { shallowRef, useTemplateRef, watch } from 'vue'

import AISettingsDialog from '@/components/AISettingsDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useToast } from '@/composables/useToast'
import { aiChat, buildPolishMessages, stripMarkdown } from '@/utils/aiClient'
import { loadAISettings } from '@/utils/aiKeyStore'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** 'bullet' 单条要点 | 'summary' 段落 */
  kind: { type: String, default: 'bullet' },
  title: { type: String, default: 'AI 润色' },
  text: { type: String, default: '' },
})

const emit = defineEmits(['close', 'apply'])

const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

const source = shallowRef('')
const result = shallowRef('')
const busy = shallowRef(false)
const error = shallowRef('')
const settingsOpen = shallowRef(false)
/** AI 服务是否已配置；打开弹窗与保存设置后各检查一次 */
const configured = shallowRef(false)

// 每次打开重置工作区：原文带入当前内容，结果清空
watch(
  () => props.open,
  (open) => {
    if (!open) return
    source.value = props.text
    result.value = ''
    error.value = ''
    configured.value = Boolean(loadAISettings())
  },
)

async function polish() {
  if (busy.value) return
  const settings = loadAISettings()
  if (!settings) {
    settingsOpen.value = true
    return
  }
  const text = source.value.trim()
  if (!text) {
    toast('先填写内容再润色')
    return
  }

  busy.value = true
  error.value = ''
  try {
    const content = await aiChat({
      settings,
      messages: buildPolishMessages(props.kind, text),
    })
    result.value = stripMarkdown(content)
  } catch (requestError) {
    if (requestError.code === 'AUTH_EXPIRED') {
      error.value = 'AI 功能需要先登录'
    } else {
      error.value = requestError.message || '润色失败，请稍后再试'
    }
  } finally {
    busy.value = false
  }
}

function apply() {
  const text = result.value.trim()
  if (!text) return
  emit('apply', text)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pl-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="pl-card"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <div class="pl-head">
          <h3 class="pl-title">
            <SvgIcon name="sparkles" :size="15" />
            <span>{{ title }}</span>
          </h3>
          <button class="pl-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <label class="pl-field">
          <span>原文（可先手动调整再润色）</span>
          <textarea v-model="source" class="ed-textarea" rows="3"></textarea>
        </label>

        <p v-if="!configured" class="pl-setup">
          还没有配置 AI 服务。填入你自己的 API Key 即可使用，配置只保存在本机。
          <button class="pl-setup-btn" @click="settingsOpen = true">去设置</button>
        </p>

        <template v-if="result || busy || error">
          <label class="pl-field">
            <span>润色结果（可直接修改后应用）</span>
            <textarea
              v-model="result"
              class="ed-textarea"
              rows="3"
              placeholder="润色结果会出现在这里"
            ></textarea>
          </label>
          <p v-if="error" class="pl-error" role="alert">{{ error }}</p>
        </template>

        <div class="pl-actions">
          <button class="ed-btn ed-btn-primary" :disabled="busy || !source.trim()" @click="polish">
            <SvgIcon name="sparkles" :size="14" />
            <span>{{ busy ? '润色中…' : result ? '重新润色' : '开始润色' }}</span>
          </button>
          <span class="pl-spacer"></span>
          <button class="ed-btn" :disabled="!result.trim()" @click="apply">
            <SvgIcon name="check" :size="14" />
            <span>应用到简历</span>
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
.pl-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 24, 40, 0.42);
}

.pl-card {
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.pl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.pl-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.pl-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ed-text-4);
  cursor: pointer;
}

.pl-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.pl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.pl-field > span {
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.pl-setup {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px dashed var(--ed-line-2);
  border-radius: 9px;
  background: var(--ed-fill-2);
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.6;
}

.pl-setup-btn {
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

.pl-error {
  margin: 0 0 12px;
  color: var(--ed-danger-strong);
  font-size: 12.5px;
}

.pl-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pl-spacer {
  flex: 1 1 auto;
}
</style>
