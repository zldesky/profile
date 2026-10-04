<script setup>
/**
 * JD 匹配弹窗：粘贴目标岗位 JD → AI 比对简历 → 已覆盖/缺失关键词与修改建议。
 * 走与 AI 润色相同的 BYOK 通道（本机服务转发，Key 即用即弃）；
 * 未配置 AI 服务时内嵌提示并可直接打开设置弹窗。结果只做参考，改动仍由用户手动完成。
 */
import { shallowRef, useTemplateRef, watch } from 'vue'

import AISettingsDialog from '@/components/AISettingsDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
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
const result = shallowRef(null)
const busy = shallowRef(false)
const error = shallowRef('')
const settingsOpen = shallowRef(false)
/** AI 服务是否已配置；打开弹窗与保存设置后各检查一次 */
const configured = shallowRef(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    result.value = null
    error.value = ''
    configured.value = Boolean(loadAISettings())
  },
)

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
      ),
      temperature: 0.3,
    })
    result.value = parseJdMatchResult(content)
  } catch (requestError) {
    if (requestError.code === 'AUTH_EXPIRED') {
      error.value = 'AI 功能需要先登录'
    } else {
      error.value = requestError.message || 'JD 匹配失败，请稍后再试'
    }
  } finally {
    busy.value = false
  }
}

/** 把结果拼成纯文本报告，方便贴给招聘顾问或存档 */
async function copyReport() {
  if (!result.value) return
  const { matched, missing, suggestions } = result.value
  const lines = ['JD 匹配报告', '']
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
        aria-label="JD 匹配"
        tabindex="-1"
      >
        <div class="jd-head">
          <h3 class="jd-title">
            <SvgIcon name="sparkles" :size="15" />
            <span>JD 匹配</span>
          </h3>
          <button class="jd-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <label class="jd-field">
          <span>岗位 JD（岗位职责与任职要求，粘贴进来）</span>
          <textarea
            v-model="jd"
            class="ed-textarea"
            rows="6"
            placeholder="例如：负责 XX 业务前端开发，要求熟悉 Vue3、TypeScript，有大型项目性能优化经验…"
          ></textarea>
        </label>

        <p v-if="!configured" class="jd-setup">
          还没有配置 AI 服务。填入你自己的 API Key 即可使用，配置只保存在本机。
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
  background: rgba(16, 24, 40, 0.42);
}

.jd-card {
  width: 100%;
  max-width: 440px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.jd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.jd-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.jd-close {
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

.jd-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
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

.jd-setup {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px dashed var(--ed-line-2);
  border-radius: 9px;
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
  gap: 5px;
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

.jd-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.jd-spacer {
  flex: 1 1 auto;
}
</style>
