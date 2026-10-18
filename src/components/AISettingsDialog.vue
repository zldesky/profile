<script setup lang="ts">
/**
 * AI 服务设置弹窗：用户自带 API Key（BYOK）。
 *
 * 三个交互上的要点：
 *  1. **边填边存草稿**：弹窗可能被 Esc、点遮罩或外层弹窗关掉而卸载，
 *     组件卸载后 setup 里的 ref 就没了。因此每次输入都写一份 sessionStorage 草稿，
 *     下次打开原样回填 —— 填了一半的 Key 不会因为误关而消失。
 *  2. **模型可从下拉直接选**：各服务商的常用模型列在预设里，省去手打模型名；
 *     仍保留手填，因为各家模型上新很快，写死必然过期。
 *  3. **Esc 只关最上层**：useDialogA11y 需要能追踪的开关（computed），
 *     传 getter 会导致本弹窗从未登记进 Esc 栈，一次 Esc 连外层弹窗一起关掉。
 */
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import BaseSelect from '@/components/BaseSelect.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { useToast } from '@/composables/useToast'
import { aiChat } from '@/utils/aiClient'
import {
  AI_PRESETS,
  clearAIDraft,
  clearAISettings,
  loadAIDraft,
  loadAISettings,
  presetById,
  saveAIDraft,
  saveAISettings,
} from '@/utils/aiKeyStore'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'saved'])

const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
/** 必须是能追踪的 Ref：传 getter 的话 useDialogA11y 的 watch 只求值一次，弹窗不会进 Esc 栈 */
const isOpen = computed(() => props.open)
useDialogA11y(isOpen, cardRef, () => emit('close'))

const presetId = shallowRef('deepseek')
const baseUrl = shallowRef('')
const model = shallowRef('')
const apiKey = shallowRef('')
const remember = shallowRef(true)
const showKey = shallowRef(false)
const testing = shallowRef(false)
const keyReady = shallowRef(false)
/** 是否手填模型名（选「自定义模型」时）。为 false 时模型用下拉选择 */
const customModel = shallowRef(false)
/** 当前表单内容是否来自未保存的草稿，界面据此提示 */
const fromDraft = shallowRef(false)

const preset = computed(() => presetById(presetId.value))
/** 当前服务商可选的内置模型；「自定义」预设没有候选，直接手填 */
const modelOptions = computed(() => preset.value.models || [])

/*
 * 两处下拉的选项形状映射：
 * - AI_PRESETS 用 { id, label }，BaseSelect 要 { value, label }；
 * - modelOptions 是字符串数组，值即标签。
 * 都在调用点映射，不动数据源本身。
 */
const presetOptions = computed(() =>
  AI_PRESETS.map((item) => ({ value: item.id, label: item.label })),
)
const modelSelectOptions = computed(() =>
  modelOptions.value.map((name) => ({ value: name, label: name })),
)
const isCustomPreset = computed(() => presetId.value === 'custom')

/**
 * 回填优先级：草稿 > 已保存配置 > 预设默认值。
 * 草稿在前是因为它的含义就是「上次没填完的东西」。
 */
function fillForm() {
  const saved = loadAISettings()
  const draft = loadAIDraft()

  if (draft) {
    presetId.value = presetById(draft.presetId).id
    baseUrl.value = draft.baseUrl ?? ''
    model.value = draft.model ?? ''
    apiKey.value = draft.apiKey ?? ''
    remember.value = draft.remember !== false
    fromDraft.value = true
  } else {
    presetId.value = saved
      ? AI_PRESETS.find((p) => p.baseUrl === saved.baseUrl)?.id || 'custom'
      : AI_PRESETS[0].id
    const source = saved || AI_PRESETS[0]
    baseUrl.value = source.baseUrl || ''
    model.value = source.model || ''
    apiKey.value = saved?.apiKey || ''
    remember.value = saved ? saved.remember : true
    fromDraft.value = false
  }

  keyReady.value = Boolean(saved?.apiKey)
  // 模型不在候选里（例如手填过）时切到手填，否则下拉会显示成空
  customModel.value = !(presetById(presetId.value).models || []).includes(model.value)
  showKey.value = false
}

watch(
  () => props.open,
  (open) => {
    if (open) fillForm()
  },
)

/** 统一入口：模板各输入框的 @input 都走它，省去为 5 个字段各写一个 watch */
function persistDraft() {
  saveAIDraft({
    presetId: presetId.value,
    baseUrl: baseUrl.value,
    model: model.value,
    apiKey: apiKey.value,
    remember: remember.value,
  })
  fromDraft.value = true
}

/** 换服务商：填入该家默认地址与模型 */
function applyPreset() {
  const picked = presetById(presetId.value)
  if (picked.baseUrl) {
    baseUrl.value = picked.baseUrl
    model.value = picked.model
  }
  // 自定义预设没有候选模型，直接进入手填
  customModel.value = !picked.models?.length
  persistDraft()
}

/**
 * 在「下拉选模型」与「手填模型名」之间切换。
 * 抽成函数而不是写在模板里：模板的行内处理器必须保持单条语句，
 * 多语句被 Prettier 折行后 Vue 编译器会直接解析失败（npm run build 会炸）。
 */
function toggleCustomModel() {
  customModel.value = !customModel.value
  persistDraft()
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
    // 已正式保存，草稿的使命结束
    clearAIDraft()
    fromDraft.value = false
    keyReady.value = true
    toast(`连接成功，配置已保存${remember.value ? '' : '（仅本次会话有效）'}`)
    emit('saved')
  } catch (error) {
    // catch 的参数是 unknown：先收窄再取字段
    const err = error as { code?: string; message?: string }
    if (err.code === 'AUTH_EXPIRED') {
      toast('AI 功能需要先登录')
      return
    }
    toast(err.message || '连接失败，请检查地址、Key 与模型名')
  } finally {
    testing.value = false
  }
}

function forget() {
  clearAISettings()
  apiKey.value = ''
  keyReady.value = false
  fromDraft.value = false
  toast('已清除本机保存的 Key')
}

/** 关掉前把当前输入存成草稿：无论怎么关（Esc / 遮罩 / 关闭按钮）都不丢 */
function close() {
  persistDraft()
  emit('close')
}

/** 打开后把光标落到第一个空字段，省一次点击 */
watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  const card = cardRef.value
  if (!card) return
  const empty = [...card.querySelectorAll('input')].find((el) => !el.value)
  if (empty) empty.focus()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ai-mask" @click.self="close">
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
          <button class="ai-close" title="关闭" aria-label="关闭" @click="close">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <label class="ai-field">
          <span>服务商</span>
          <BaseSelect v-model="presetId" :options="presetOptions" @change="applyPreset" />
        </label>

        <label class="ai-field">
          <span>服务地址（OpenAI 兼容）</span>
          <input
            v-model="baseUrl"
            class="ed-input"
            type="url"
            placeholder="https://api.deepseek.com"
            spellcheck="false"
            @input="persistDraft"
          />
        </label>

        <label class="ai-field">
          <span>模型</span>
          <span class="ai-model-row">
            <BaseSelect
              v-if="!customModel && modelOptions.length"
              v-model="model"
              :options="modelSelectOptions"
              @change="persistDraft"
            />
            <input
              v-else
              v-model="model"
              class="ed-input"
              placeholder="deepseek-chat"
              spellcheck="false"
              @input="persistDraft"
            />
            <button
              v-if="modelOptions.length"
              class="ed-icon-btn"
              type="button"
              :title="customModel ? '从列表选择' : '手动输入模型名'"
              :aria-label="customModel ? '从列表选择模型' : '手动输入模型名'"
              @click="toggleCustomModel"
            >
              <SvgIcon :name="customModel ? 'layout' : 'text'" :size="14" />
            </button>
          </span>
        </label>

        <label class="ai-field">
          <span>API Key</span>
          <span class="ai-key-row">
            <input
              v-model="apiKey"
              class="ed-input"
              :type="showKey ? 'text' : 'password'"
              :placeholder="isCustomPreset ? 'sk-…' : '粘贴该服务商的 API Key'"
              autocomplete="off"
              spellcheck="false"
              @input="persistDraft"
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
          <input v-model="remember" type="checkbox" class="ed-check" @change="persistDraft" />
          <span>记住密钥（保存到本机浏览器，下次免输入）</span>
        </label>

        <p v-if="fromDraft && !keyReady" class="ai-draft-hint">
          <SvgIcon name="clock" :size="13" />
          <span>已恢复上次未保存的内容，点「保存并测试」后才会生效。</span>
        </p>

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
  background: var(--ed-overlay);
}

.ai-card {
  width: 100%;
  max-width: 400px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
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
  border-radius: var(--ed-radius-sm);
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

.ai-key-row,
.ai-model-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-key-row .ed-input,
.ai-model-row .ed-input,
.ai-model-row .bsel {
  flex: 1 1 auto;
  min-width: 0;
}

/* 草稿提示：琥珀色，与「软校验警告」同一语气 */
.ai-draft-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 10px;
  padding: 7px 9px;
  border-radius: var(--ed-radius-sm);
  background: var(--ed-warn-tint);
  color: var(--ed-warn);
  font-size: 12px;
  line-height: 1.55;
}

.ai-draft-hint :deep(.svg-icon) {
  flex: 0 0 auto;
  margin-top: 2px;
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
