<script setup>
/**
 * AI 服务设置弹窗：用户自带 API Key（BYOK）。
 * 预设覆盖 DeepSeek / 智谱 / Kimi，也支持任意 OpenAI 兼容端点。
 * Key 的存储位置与风险在界面上明示，见 utils/aiKeyStore.js 的安全模型。
 */
import { shallowRef, useTemplateRef, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useToast } from '@/composables/useToast'
import { aiChat } from '@/utils/aiClient'
import { AI_PRESETS, clearAISettings, loadAISettings, saveAISettings } from '@/utils/aiKeyStore'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'saved'])

const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

const presetId = shallowRef('deepseek')
const baseUrl = shallowRef('')
const model = shallowRef('')
const apiKey = shallowRef('')
const remember = shallowRef(true)
const showKey = shallowRef(false)
const testing = shallowRef(false)
const keyReady = shallowRef(false)

// 每次打开都回填当前配置，避免上一次的半截输入被误保存
watch(
  () => props.open,
  (open) => {
    if (!open) return
    const saved = loadAISettings()
    baseUrl.value = saved?.baseUrl || AI_PRESETS[0].baseUrl
    model.value = saved?.model || AI_PRESETS[0].model
    apiKey.value = saved?.apiKey || ''
    remember.value = saved ? saved.remember : true
    keyReady.value = Boolean(saved?.apiKey)
    presetId.value = AI_PRESETS.find((p) => p.baseUrl === baseUrl.value)?.id || 'custom'
    showKey.value = false
  },
)

function applyPreset() {
  const preset = AI_PRESETS.find((p) => p.id === presetId.value)
  if (preset && preset.baseUrl) {
    baseUrl.value = preset.baseUrl
    model.value = preset.model
  }
}

async function saveAndTest() {
  if (testing.value) return
  if (!baseUrl.value.trim() || !model.value.trim() || !apiKey.value.trim()) {
    toast('服务地址、模型与 API Key 都要填写')
    return
  }

  testing.value = true
  try {
    await aiChat({
      settings: {
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        apiKey: apiKey.value.trim(),
      },
      messages: [{ role: 'user', content: '回复「OK」两个字，不要其它内容。' }],
      temperature: 0,
    })
    saveAISettings({
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      apiKey: apiKey.value.trim(),
      remember: remember.value,
    })
    keyReady.value = true
    toast(`连接成功，配置已保存${remember.value ? '' : '（仅本次会话有效）'}`)
    emit('saved')
  } catch (error) {
    if (error.code === 'AUTH_EXPIRED') {
      toast('AI 功能需要先登录')
      return
    }
    toast(error.message || '连接失败，请检查地址、Key 与模型名')
  } finally {
    testing.value = false
  }
}

function forget() {
  clearAISettings()
  apiKey.value = ''
  keyReady.value = false
  toast('已清除本机保存的 Key')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ai-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="ai-card"
        role="dialog"
        aria-modal="true"
        aria-label="AI 服务设置"
        tabindex="-1"
      >
        <div class="ai-head">
          <h3 class="ai-title">AI 服务设置</h3>
          <button class="ai-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <label class="ai-field">
          <span>服务商</span>
          <select v-model="presetId" class="ed-select" @change="applyPreset">
            <option v-for="preset in AI_PRESETS" :key="preset.id" :value="preset.id">
              {{ preset.label }}
            </option>
          </select>
        </label>

        <label class="ai-field">
          <span>服务地址（OpenAI 兼容）</span>
          <input
            v-model="baseUrl"
            class="ed-input"
            type="url"
            placeholder="https://api.deepseek.com"
            spellcheck="false"
          />
        </label>

        <label class="ai-field">
          <span>模型</span>
          <input v-model="model" class="ed-input" placeholder="deepseek-chat" spellcheck="false" />
        </label>

        <label class="ai-field">
          <span>API Key</span>
          <span class="ai-key-row">
            <input
              v-model="apiKey"
              class="ed-input"
              :type="showKey ? 'text' : 'password'"
              placeholder="sk-…"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              class="ed-icon-btn"
              type="button"
              :title="showKey ? '隐藏' : '显示'"
              :aria-label="showKey ? '隐藏 Key' : '显示 Key'"
              @click="showKey = !showKey"
            >
              <SvgIcon :name="showKey ? 'eyeOff' : 'eye'" :size="14" />
            </button>
          </span>
        </label>

        <label class="ed-toggle">
          <input v-model="remember" type="checkbox" class="ed-check" />
          <span>记住密钥（保存到本机浏览器，下次免输入）</span>
        </label>

        <p class="ed-hint">
          Key 只保存在你自己的浏览器里（{{ remember ? 'localStorage' : '仅当前会话' }}），
          请求经由你部署的本机服务转发，服务端不保存、不记录 Key。
          任何本地存储都可能被本机恶意软件读取，建议使用低额度的专用 Key。
        </p>

        <div class="ai-actions">
          <button v-if="keyReady" class="ed-btn" @click="forget">清除已存的 Key</button>
          <span class="ai-spacer"></span>
          <button class="ed-btn ed-btn-primary" :disabled="testing" @click="saveAndTest">
            <SvgIcon :name="testing ? 'refresh' : 'check'" :size="14" />
            <span>{{ testing ? '测试中…' : '保存并测试' }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-mask {
  position: fixed;
  inset: 0;
  z-index: 92;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 24, 40, 0.42);
}

.ai-card {
  width: 100%;
  max-width: 400px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ai-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.ai-close {
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

.ai-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.ai-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.ai-field > span:first-child {
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.ai-key-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-key-row .ed-input {
  flex: 1 1 auto;
}

.ai-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.ai-spacer {
  flex: 1 1 auto;
}
</style>
