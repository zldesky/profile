<script setup lang="ts">
/**
 * 统一文案格式：先看 diff，再决定要不要改。
 *
 * 为什么必须「先预览」：这一步会批量改动用户亲手写的文字。
 * 一个「一键美化」按钮如果在用户没看清的情况下改掉了 20 处内容，
 * 那比不提供这个功能糟得多 —— 简历上的每个字都是他自己写的。
 *
 * 所以这里：
 *  1. 打开时先扫描全篇，列出「哪一段的哪一处会变成什么」；
 *  2. 每处都能单独勾选，默认全选但不隐藏；
 *  3. 应用走 store，Ctrl+Z 可整体撤销；
 *  4. 没有可改的地方时如实说「没有需要统一的写法」，而不是假装做了什么。
 *
 * 开关（中英空格 / 多余空格 / 标点全角）也放在这里：
 * 标点全角**默认关**，因为技术简历里 `React, Vue` 写半角更自然。
 */
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { normalizeZh, summarizeChanges } from '@/utils/textNormalize'
import type { NormalizeOptions } from '@/utils/textNormalize'
import type { Section } from '@/types/resume'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useResumeStore()
const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
const isOpen = computed(() => props.open)
useDialogA11y(isOpen, cardRef, () => emit('close'))

/** 三个开关；标点全角默认关（见文件头） */
const options = shallowRef<NormalizeOptions>({
  cjkLatinSpace: true,
  collapseSpaces: true,
  fullWidthPunctuation: false,
})

/** 待改项：一条要点的「原文 → 新文」 */
interface Proposal {
  /** 稳定的勾选键 */
  key: string
  /** 出现在哪个模块 / 哪一段，便于定位 */
  where: string
  before: string
  after: string
  /**
   * 把规范化后的文本写回数据。
   *
   * 不接参数：要写回的内容就是 `after`，由闭包直接取。
   * 早先写成 `(text: string) => void`，eslint 的 no-unused-vars 会把类型签名里的
   * 参数名当成未使用变量报错（改用 call signature 也一样报）——
   * 干脆取消这个参数，调用点也就不用重复传一遍。
   */
  apply: () => void
}

const proposals = shallowRef<Proposal[]>([])
/** 被取消勾选的 key */
const skipped = shallowRef<Set<string>>(new Set())

/** 收集全篇可规范化的要点与段落 */
function collect(): Proposal[] {
  const out: Proposal[] = []
  /*
   * 用 `store.sections as Section[]` 再逐类型分支：Section 是可辨识联合，
   * 直接读 `.items` / `.fields` / `.content` 会报「该属性不存在于某某分支」。
   * 依次 if/else if 已经保证进到某个分支时类型是对的，但 for...of 的变量
   * 若是联合类型，TS 不会跨分支收窄，所以这里在循环体内按 type 再判一次。
   */
  const sections = (store.sections ?? []) as Section[]
  for (const section of sections) {
    if (section.type === 'entries') {
      section.items.forEach((entry, entryIndex) => {
        entry.bullets.forEach((bullet, bulletIndex) => {
          const result = normalizeZh(bullet.text, options.value)
          if (!result.text || result.text === bullet.text) return
          out.push({
            key: `b-${bullet.id}`,
            where: `${section.title} · 第 ${entryIndex + 1} 段要点 ${bulletIndex + 1}`,
            before: bullet.text,
            after: result.text,
            apply: () => store.updateBullet(section.id, entry.id, bullet.id, result.text),
          })
        })
      })
    } else if (section.type === 'text') {
      const result = normalizeZh(section.content, options.value)
      /*
       * 这里必须用 `continue` 而不是 `return`。
       *
       * `return`（无值）会让 TS 把 `collect` 的返回类型推成
       * `Proposal[] | undefined`，于是 `proposals.value = collect()` 报
       * 「undefined 不能赋给 Proposal[]」—— 错误报在赋值处，真因在这个 return。
       * 这就是 conventions.md 说的「错在 A、报在 B」。
       */
      if (!result.text || result.text === section.content) continue
      out.push({
        key: `t-${section.id}`,
        where: `${section.title} · 整段`,
        before: section.content,
        after: result.text,
        apply: () => store.updateSection(section.id, { content: result.text }),
      })
    } else if (section.type === 'skills') {
      section.fields.forEach((field) => {
        const result = normalizeZh(field.value, options.value)
        if (!result.text || result.text === field.value) return
        out.push({
          key: `sf-${field.id}`,
          where: `${section.title} · ${field.label || '描述'}`,
          before: field.value,
          after: result.text,
          apply: () => store.updateSkillField(section.id, field.id, { value: result.text }),
        })
      })
    } else if (section.type === 'grid') {
      section.items.forEach((item) => {
        const result = normalizeZh(item.value, options.value)
        if (!result.text || result.text === item.value) return
        out.push({
          key: `g-${item.id}`,
          where: `${section.title} · ${item.label || '条目'}`,
          before: item.value,
          after: result.text,
          apply: () => store.updateGridItem(section.id, item.id, { value: result.text }),
        })
      })
    }
  }
  return out
}

function rescan(): void {
  proposals.value = collect()
  skipped.value = new Set()
}

watch(
  () => [props.open, options.value] as const,
  (open) => {
    if (open) rescan()
  },
  { deep: true },
)

const activeProposals = computed(() =>
  proposals.value.filter((proposal) => !skipped.value.has(proposal.key)),
)

function toggle(key: string): void {
  const next = new Set(skipped.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  skipped.value = next
}

function applyAll(): void {
  const list = activeProposals.value
  if (!list.length) return
  list.forEach((proposal) => proposal.apply())
  toast(`已统一 ${list.length} 处写法，Ctrl+Z 可撤销`)
  emit('close')
}

/** 预览里的差异片段（高亮变化处） */
function diffHint(proposal: Proposal): { before: string; after: string } {
  const changes = summarizeChanges(normalizeZh(proposal.before, options.value), 1)
  const first = changes[0]
  return first
    ? { before: first.before, after: first.after }
    : { before: proposal.before.slice(0, 24), after: proposal.after.slice(0, 24) }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="tn-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="tn-card"
        role="dialog"
        aria-modal="true"
        aria-label="统一文案格式"
        tabindex="-1"
      >
        <div class="tn-head">
          <h3 class="tn-title">
            <SvgIcon name="text" :size="15" />
            <span>统一文案格式</span>
          </h3>
          <button class="tn-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <div class="tn-opts">
          <label class="ed-toggle">
            <input
              class="ed-check"
              type="checkbox"
              :checked="options.cjkLatinSpace"
              @change="
                options = {
                  ...options,
                  cjkLatinSpace: ($event.target as HTMLInputElement).checked,
                }
              "
            />
            <span>中英文之间补空格</span>
          </label>
          <label class="ed-toggle">
            <input
              class="ed-check"
              type="checkbox"
              :checked="options.collapseSpaces"
              @change="
                options = {
                  ...options,
                  collapseSpaces: ($event.target as HTMLInputElement).checked,
                }
              "
            />
            <span>折叠多余空格</span>
          </label>
          <label class="ed-toggle">
            <input
              class="ed-check"
              type="checkbox"
              :checked="options.fullWidthPunctuation"
              @change="
                options = {
                  ...options,
                  fullWidthPunctuation: ($event.target as HTMLInputElement).checked,
                }
              "
            />
            <span>半角逗号句号转全角（技术简历建议关闭）</span>
          </label>
        </div>

        <p class="tn-lede">下面每一处都可以单独取消。代码、版本号、URL、日期、百分比不会被改动。</p>

        <ul v-if="proposals.length" class="tn-list">
          <li v-for="proposal in proposals" :key="proposal.key" class="tn-item">
            <label class="tn-check">
              <input
                class="ed-check"
                type="checkbox"
                :checked="!skipped.has(proposal.key)"
                @change="toggle(proposal.key)"
              />
            </label>
            <div class="tn-body" :class="{ 'is-skipped': skipped.has(proposal.key) }">
              <p class="tn-where">{{ proposal.where }}</p>
              <p class="tn-diff">
                <span class="tn-from">{{ diffHint(proposal).before }}</span>
                <span class="tn-arrow" aria-hidden="true">→</span>
                <span class="tn-to">{{ diffHint(proposal).after }}</span>
              </p>
            </div>
          </li>
        </ul>
        <p v-else class="ed-empty">这段文字里没有需要统一的写法。</p>

        <div class="tn-actions">
          <button
            class="ed-btn ed-btn-primary"
            :disabled="!activeProposals.length"
            @click="applyAll"
          >
            <SvgIcon name="check" :size="14" />
            <span>应用 {{ activeProposals.length }} 处</span>
          </button>
          <span class="tn-spacer"></span>
          <button class="ed-btn" @click="emit('close')">不改了</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tn-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ed-overlay);
}

.tn-card {
  display: flex;
  flex-direction: column;
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

.tn-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.tn-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.tn-close {
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

.tn-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.tn-opts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
}

.tn-lede {
  margin: 0 0 10px;
  color: var(--ed-text-3);
  font-size: 12px;
  line-height: 1.6;
}

.tn-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.tn-item {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ed-line-soft);
}

.tn-item:last-child {
  border-bottom: 0;
}

.tn-check {
  flex: 0 0 auto;
  padding-top: 2px;
}

.tn-body {
  min-width: 0;
}

/* 取消勾选的项整体变淡，一眼能看出「这条不改」 */
.tn-body.is-skipped {
  opacity: 0.45;
}

.tn-where {
  margin: 0 0 2px;
  color: var(--ed-text-3);
  font-size: 11.5px;
}

.tn-diff {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
}

.tn-from {
  color: var(--ed-text-3);
  text-decoration: line-through;
}

.tn-arrow {
  color: var(--ed-text-4);
}

.tn-to {
  color: var(--ed-ink);
  font-weight: 600;
}

.tn-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tn-spacer {
  flex: 1 1 auto;
}
</style>
