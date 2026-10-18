<script setup lang="ts">
/**
 * AI 补充导入：给一份已有简历文件（PDF / 文本）加上提示词，指定填到哪个位置。
 *
 * 与「PDF 简历导入」的分工：那条路走规则解析、整份重建、离线可用；
 * 这条走 AI、只填指定模块、可以带提示词。入口并列，不互相替代。
 *
 * 交互上刻意做成「先看再决定」：AI 的结果先在下面列出来，用户确认后才写回。
 * 简历被 AI 悄悄改掉是比「多一步确认」严重得多的问题。
 */
import { computed, shallowRef, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import AISettingsDialog from '@/components/AISettingsDialog.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { useToast } from '@/composables/useToast'
import {
  buildFillMessages,
  clipSource,
  normalizeFillResult,
  parseJsonReply,
  sourceTextFromFile,
} from '@/utils/aiFill'
import { aiChat } from '@/utils/aiClient'
import { loadAISettings } from '@/utils/aiKeyStore'
import { useResumeStore } from '@/stores/resume'
import type { Basics, Section } from '@/types/resume'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; applied: [] }>()

const store = useResumeStore()
const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
const isOpen = computed(() => props.open)
useDialogA11y(isOpen, cardRef, () => emit('close'))

const settingsOpen = shallowRef(false)
const file = shallowRef<File | null>(null)
const fileText = shallowRef('')
const reading = shallowRef(false)
const running = shallowRef(false)
const instruction = shallowRef('')
/** 目标：'basics' 或某个模块 id */
const targetId = shallowRef('basics')
/** AI 返回并归一化后的结果，供确认 */
const preview = shallowRef<Record<string, unknown> | null>(null)

const configured = computed(() => Boolean(loadAISettings()))

/** 可填的目标：基础信息 + 全部可见模块 */
const targets = computed(() => [
  { id: 'basics', label: '基础信息（姓名 / 职位 / 联系方式）' },
  ...store.sections
    .filter((s: Section) => s.visible)
    .map((s: Section) => ({ id: s.id, label: `模块：${s.title}` })),
])

const targetSection = computed(() =>
  targetId.value === 'basics'
    ? null
    : (store.sections.find((s: Section) => s.id === targetId.value) ?? null),
)

/** 结果里每项的可读描述，用于确认区 */
const previewRows = computed(() => {
  const data = preview.value
  if (!data) return [] as { label: string; value: string }[]
  const rows: { label: string; value: string }[] = []
  const push = (label: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) rows.push({ label, value: value.trim() })
  }
  push('姓名', data.name)
  push('求职职位', data.jobTitle)
  push('正文', data.content)

  for (const key of ['fields', 'items'] as const) {
    const list = Array.isArray(data[key]) ? (data[key] as Record<string, unknown>[]) : []
    for (const item of list) {
      if (typeof item.label === 'string' || typeof item.value === 'string') {
        rows.push({ label: String(item.label ?? '—'), value: String(item.value ?? '') })
      } else if (typeof item.name === 'string') {
        rows.push({
          label: String(item.name),
          value: item.level !== undefined ? `${item.level}%` : '',
        })
      } else {
        // 经历条目：时间 / 机构 / 职位 + 要点
        const head = [item.time, item.org, item.role].filter(Boolean).join(' · ')
        const bullets = Array.isArray(item.bullets)
          ? (item.bullets as { text?: string }[]).map((b) => String(b.text ?? '')).filter(Boolean)
          : []
        if (head) rows.push({ label: '经历', value: head })
        for (const b of bullets) rows.push({ label: '要点', value: b })
      }
    }
  }
  return rows
})

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  if (!picked) return

  reading.value = true
  preview.value = null
  try {
    const text = await sourceTextFromFile(picked)
    file.value = picked
    fileText.value = text
    toast(`已读取 ${picked.name}，约 ${text.length} 字`)
  } catch (error) {
    file.value = null
    fileText.value = ''
    toast(error instanceof Error ? error.message : '文件读取失败', 3600)
  } finally {
    reading.value = false
  }
}

async function run() {
  if (running.value) return
  if (!fileText.value) {
    toast('请先选择一份 PDF 或文本简历')
    return
  }
  if (!configured.value) {
    settingsOpen.value = true
    return
  }

  running.value = true
  preview.value = null
  try {
    const section = targetSection.value
    const reply = await aiChat({
      settings: loadAISettings()!,
      messages: buildFillMessages(
        clipSource(fileText.value),
        section
          ? {
              kind: 'section',
              sectionId: section.id,
              sectionType: section.type,
              sectionTitle: section.title,
            }
          : { kind: 'basics' },
        instruction.value,
        store.basics.jobTitle,
      ),
      temperature: 0,
    })
    const normalized = normalizeFillResult(
      parseJsonReply(reply),
      section
        ? { kind: 'section', sectionId: section.id, sectionType: section.type }
        : { kind: 'basics' },
    )
    if (!Object.keys(normalized).length) {
      toast('没有从文件里提取到与该位置相关的内容，可以换个说法或换一份文件', 4000)
      return
    }
    preview.value = normalized
  } catch (error) {
    const err = error as { code?: string; message?: string }
    toast(err.code === 'AUTH_EXPIRED' ? 'AI 功能需要先登录' : err.message || 'AI 调用失败', 4000)
  } finally {
    running.value = false
  }
}

/** 确认写回。基础信息走 setBasics，模块走 updateSection，都经由 store 以保证撤销可用。 */
function apply() {
  const data = preview.value
  if (!data) return
  try {
    if (targetId.value === 'basics') {
      // 归一化阶段已按 Basics 的形状收敛（name / jobTitle / fields）
      store.setBasics(data as unknown as Partial<Basics>)
    } else {
      // updateSection 是 Object.assign 语义：items 这类数组会整体替换
      store.updateSection(targetId.value, data)
    }
    toast('已填入，可用 Ctrl+Z 撤销')
    emit('applied')
    close()
  } catch (error) {
    toast(error instanceof Error ? error.message : '写入失败', 3600)
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="af-mask" @click.self="close">
      <div
        ref="cardRef"
        class="af-card"
        role="dialog"
        aria-modal="true"
        aria-label="AI 补充导入"
        tabindex="-1"
      >
        <div class="af-head">
          <h3 class="af-title">AI 补充导入</h3>
          <button class="af-close" title="关闭" aria-label="关闭" @click="close">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <p class="af-hint">
          选一份已有的简历文件，指定要填到哪个位置，可再补充一句要求。 AI
          只负责搬运与整理，<strong>不会编造</strong>原文里没有的内容；结果会先给你过目。
        </p>

        <ol class="af-steps">
          <!-- 1 文件 -->
          <li class="af-step">
            <span class="af-step-no">1</span>
            <div class="af-step-body">
              <label class="af-file">
                <input
                  class="af-file-input"
                  type="file"
                  accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                  @change="onPick"
                />
                <span class="ed-btn af-file-btn">
                  <SvgIcon name="upload" :size="14" />
                  <span>{{
                    reading ? '读取中…' : file ? '换一份文件' : '选择 PDF / 文本简历'
                  }}</span>
                </span>
              </label>
              <p v-if="file" class="af-file-name">
                {{ file.name }} · 已读取约 {{ fileText.length }} 字
              </p>
            </div>
          </li>

          <!-- 2 位置 -->
          <li class="af-step">
            <span class="af-step-no">2</span>
            <div class="af-step-body">
              <label class="af-field">
                <span>填到哪个位置</span>
                <select v-model="targetId" class="ed-select" @change="preview = null">
                  <option v-for="t in targets" :key="t.id" :value="t.id">{{ t.label }}</option>
                </select>
              </label>
            </div>
          </li>

          <!-- 3 提示词 -->
          <li class="af-step">
            <span class="af-step-no">3</span>
            <div class="af-step-body">
              <label class="af-field">
                <span>补充要求（可留空）</span>
                <textarea
                  v-model="instruction"
                  class="ed-input af-textarea"
                  rows="2"
                  placeholder="例：只取最近两段实习经历，按时间倒序"
                ></textarea>
              </label>
            </div>
          </li>
        </ol>

        <div class="af-actions">
          <span v-if="!configured" class="af-warn">尚未配置 AI 服务，点右侧按钮先设置</span>
          <span class="af-spacer"></span>
          <button v-if="!configured" class="ed-btn" @click="settingsOpen = true">AI 设置</button>
          <button class="ed-btn ed-btn-primary" :disabled="running || !fileText" @click="run">
            <SvgIcon :name="running ? 'refresh' : 'sparkles'" :size="14" />
            <span>{{ running ? '提取中…' : '让 AI 提取' }}</span>
          </button>
        </div>

        <!-- 确认区：先看再决定 -->
        <div v-if="preview" class="af-preview">
          <div class="af-preview-head">
            <span>将写入以下内容</span>
            <span class="af-preview-count">{{ previewRows.length }} 项</span>
          </div>
          <ul v-if="previewRows.length" class="af-preview-list">
            <li v-for="(row, i) in previewRows" :key="i">
              <span class="af-preview-label">{{ row.label }}</span>
              <span class="af-preview-value">{{ row.value }}</span>
            </li>
          </ul>
          <div class="af-preview-actions">
            <button class="ed-btn" @click="preview = null">放弃</button>
            <button class="ed-btn ed-btn-primary" @click="apply">填入</button>
          </div>
        </div>
      </div>
    </div>

    <AISettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
  </Teleport>
</template>

<style scoped>
.af-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ed-overlay);
}

.af-card {
  width: 100%;
  max-width: 520px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.af-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.af-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 15px;
  font-weight: 600;
}

.af-close {
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

.af-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.af-hint {
  margin: 0 0 14px;
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.af-hint strong {
  color: var(--ed-ink);
  font-weight: 600;
}

/* 三步：编号 + 内容，比堆一排表单更像有顺序的流程 */
.af-steps {
  margin: 0 0 4px;
  padding: 0;
  list-style: none;
}

.af-step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.af-step-no {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  border: 1px solid var(--ed-line-2);
  border-radius: 50%;
  color: var(--ed-text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.af-step-body {
  flex: 1 1 auto;
  min-width: 0;
}

.af-file-input {
  display: none;
}

.af-file-btn {
  cursor: pointer;
}

.af-file-name {
  margin: 7px 0 0;
  color: var(--ed-text-3);
  font-size: 12px;
  word-break: break-all;
}

.af-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.af-field > span:first-child {
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.af-textarea {
  min-height: 52px;
  line-height: 1.6;
  resize: vertical;
}

.af-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.af-warn {
  color: var(--ed-warn);
  font-size: 12px;
}

.af-spacer {
  flex: 1 1 auto;
}

/* 确认区：与上方流程用一条线分开，视觉上明确「这是结果」 */
.af-preview {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--ed-line-soft);
}

.af-preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--ed-ink);
  font-size: 13px;
  font-weight: 600;
}

.af-preview-count {
  color: var(--ed-text-3);
  font-size: 12px;
  font-weight: 400;
}

.af-preview-list {
  max-height: 220px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.af-preview-list li {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--ed-line-soft);
  font-size: 12.5px;
}

.af-preview-list li:last-child {
  border-bottom: 0;
}

.af-preview-label {
  flex: 0 0 72px;
  color: var(--ed-text-3);
}

.af-preview-value {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ed-text);
  word-break: break-word;
}

.af-preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
