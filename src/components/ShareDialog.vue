<script setup lang="ts">
/**
 * 简历分享弹窗：把当前简历创建为公开只读链接。
 * 创建要求登录（防滥用）；链接任何人可查看与打印，到期自动失效，
 * 创建者可在弹窗里撤销。弹窗同时列出「我的分享」：历史分享一目了然，
 * 可打开链接或撤销（撤销合集里的分享会同步从官网移除）。入口在 TopBar。
 */
import { shallowRef, useTemplateRef, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useAuth } from '@/composables/useAuth'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { useToast } from '@/composables/useToast'
import type { MyShareItem } from '@/utils/shareApi'
import { useResumeStore } from '@/stores/resume'
import { formatTime } from '@/utils/helpers'
import { createShare, deleteShare, fetchMyShares } from '@/utils/shareApi'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const store = useResumeStore()
const { toast } = useToast()
const auth = useAuth()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

const busy = shallowRef(false)
/** 当前弹窗会话里生成的分享 id（撤销用） */
const shareId = shallowRef('')
const link = shallowRef('')
const expiryText = shallowRef('')
/** 是否同时展示到官网简历合集（生成时随请求带上） */
const listInCollection = shallowRef(false)
/**
 * 是否在分享里保留联系方式。
 * **默认关闭**：分享链接是公开只读的，服务端会自动屏蔽手机号 / 邮箱 / 身份证号等
 * （见 server/redact.ts）。这个开关是留给「这份就是要发给某位招聘方」的显式出口，
 * 所以文案里要把后果说清楚，而不是一个轻飘飘的复选框。
 */
const revealContacts = shallowRef(false)
/** 服务端告知的屏蔽结果，用于生成后如实告诉用户屏蔽了什么 */
const redacted = shallowRef<{ labels: string[]; inText: number }>({ labels: [], inText: 0 })

/** 我的历史分享（弹窗打开时拉取） */
const myShares = shallowRef<MyShareItem[]>([])
const loadingShares = shallowRef(false)

async function loadMyShares() {
  if (auth.status.value !== 'authed') return
  loadingShares.value = true
  try {
    myShares.value = await fetchMyShares()
  } catch {
    myShares.value = []
  } finally {
    loadingShares.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) loadMyShares()
  },
)

async function generate() {
  if (busy.value) return
  busy.value = true
  try {
    const {
      id,
      expiresAt,
      redacted: result,
    } = await createShare(store.resume, {
      listInCollection: listInCollection.value,
      revealContacts: revealContacts.value,
    })
    redacted.value = result
    shareId.value = id
    link.value = `${location.origin}/share/${id}`
    const days = Math.max(1, Math.ceil((expiresAt - Date.now()) / 86400000))
    expiryText.value = `有效期约 ${days} 天，到期自动失效`
    /*
     * 提示里带上屏蔽结果。
     * 屏蔽是自动的，但不能是**悄悄**发生的 —— 用户有权知道自己分享出去的东西
     * 被改动过，否则他会以为链接里就是简历原文。
     */
    const parts = [listInCollection.value ? '分享链接已生成，并已展示到简历合集' : '分享链接已生成']
    if (result.labels.length)
      parts.push(`已自动屏蔽 ${result.labels.length} 项：${result.labels.join('、')}`)
    if (result.inText) parts.push(`正文中另有 ${result.inText} 处联系方式`)
    toast(parts.join('；'))
  } catch (error) {
    const err = error as { code?: string; message?: string }
    if (err.code === 'AUTH_EXPIRED') {
      toast('登录已过期，请重新登录后再分享')
    } else {
      toast(err.message || '分享创建失败')
    }
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(link.value)
    toast('链接已复制')
  } catch {
    // 剪贴板权限被拒时退回手动选择
    toast('复制失败，请手动选中链接复制')
  }
}

async function revoke() {
  if (busy.value || !shareId.value) return
  busy.value = true
  try {
    await deleteShare(shareId.value)
    shareId.value = ''
    link.value = ''
    redacted.value = { labels: [], inText: 0 }
    expiryText.value = ''
    toast('分享已撤销，链接立即失效')
    await loadMyShares()
  } catch (error) {
    toast(error instanceof Error ? error.message : '撤销失败')
  } finally {
    busy.value = false
  }
}

/** 打开某条历史分享的只读页 */
function openShareLink(item: MyShareItem) {
  window.open(`/share/${item.id}`, '_blank', 'noopener')
}

/** 撤销历史分享；若它在合集里会同步从官网移除 */
async function revokeShareItem(item: MyShareItem) {
  try {
    await deleteShare(item.id)
    toast(item.listed ? '分享已撤销，并已从简历合集移除' : '分享已撤销，链接立即失效')
    await loadMyShares()
  } catch (error) {
    toast(error instanceof Error ? error.message : '撤销失败')
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sh-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="sh-card"
        role="dialog"
        aria-modal="true"
        aria-label="分享简历"
        tabindex="-1"
      >
        <div class="sh-head">
          <h3 class="sh-title">分享简历</h3>
          <button class="sh-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <template v-if="!link">
          <p class="sh-desc">
            生成一条公开只读链接：对方无需登录即可查看和打印，但看不到编辑器、
            不能修改内容。当前简历的最新内容以生成时刻为准。
          </p>

          <!--
            自动屏蔽的说明放在勾选项之前：用户先知道「默认是安全的」，
            再看到那个需要主动打开的例外。
          -->
          <p class="sh-privacy">
            <SvgIcon name="shield" :size="14" />
            <span>
              公开链接会自动屏蔽<strong>手机号、邮箱、身份证号、年龄、性别、住址</strong>等个人信息；
              写在要点与段落里的联系方式也会一并隐藏。别人看到的是
              <code>138****0000</code> 这样的形式。
            </span>
          </p>

          <label class="sh-check">
            <input v-model="listInCollection" type="checkbox" class="ed-check" />
            <span>同时展示到官网「简历合集」，让更多人看到这份简历</span>
          </label>
          <label class="sh-check sh-check-warn">
            <input v-model="revealContacts" type="checkbox" class="ed-check" />
            <span>
              在分享里<strong>保留真实的联系方式</strong>（默认屏蔽）
              <em>仅在把链接私下发给特定招聘方时使用；勾选后任何拿到链接的人都能看到</em>
            </span>
          </label>
          <button class="ed-btn ed-btn-primary ed-btn-block" :disabled="busy" @click="generate">
            <SvgIcon name="link" :size="14" />
            <span>{{ busy ? '生成中…' : '生成分享链接' }}</span>
          </button>
        </template>

        <template v-else>
          <label class="sh-field">
            <span>分享链接</span>
            <input
              class="ed-input"
              :value="link"
              readonly
              @focus="($event.target as HTMLInputElement).select()"
            />
          </label>
          <p class="ed-hint">
            {{ expiryText }}{{ listInCollection ? '，已展示到简历合集' : '' }}。
          </p>
          <!--
            生成后如实回执：屏蔽是自动的，但不该是**悄悄**发生的。
            用户有权知道分享出去的内容被改动过，否则会以为链接里就是简历原文。
          -->
          <p v-if="redacted.labels.length || redacted.inText" class="sh-privacy">
            <SvgIcon name="shield" :size="14" />
            <span>
              已自动屏蔽<strong>{{ redacted.labels.join('、') }}</strong
              ><template v-if="redacted.inText"
                >，正文中另有 {{ redacted.inText }} 处联系方式</template
              >。分享页上对应位置显示为 <code>**</code> 或 <code>138****0000</code>。
            </span>
          </p>
          <p v-else-if="revealContacts" class="sh-privacy sh-privacy-warn">
            <SvgIcon name="shield" :size="14" />
            <span>
              这条分享<strong>包含了真实联系方式</strong>：任何拿到链接的人都能看到，
              请只发给你信任的对象。
            </span>
          </p>
          <div class="sh-actions">
            <button class="ed-btn ed-btn-primary" @click="copyLink">
              <SvgIcon name="copy" :size="14" />
              <span>复制链接</span>
            </button>
            <button class="ed-btn" :disabled="busy" @click="revoke">
              <SvgIcon name="trash" :size="14" />
              <span>撤销分享</span>
            </button>
          </div>
        </template>

        <!-- 我的分享：历史分享一目了然，可打开或撤销 -->
        <template v-if="auth.status.value === 'authed'">
          <div class="sh-divider"></div>
          <div class="sh-mine-head">
            <span>我的分享</span>
            <span v-if="myShares.length" class="sh-mine-count">{{ myShares.length }} 条</span>
          </div>
          <p v-if="loadingShares" class="ed-hint">加载中…</p>
          <p v-else-if="!myShares.length" class="ed-hint">
            还没有历史分享；生成链接后会显示在这里。
          </p>
          <div v-else class="sh-mine-list">
            <div v-for="item in myShares" :key="item.id" class="sh-mine-row">
              <div class="sh-mine-meta">
                <strong>{{ item.name || '未署名简历' }}</strong>
                <span>
                  {{ formatTime(item.createdAt) }}
                  <i v-if="item.listed" class="sh-mine-badge">合集</i>
                </span>
              </div>
              <div class="sh-mine-actions">
                <button
                  class="ed-btn is-compact"
                  :title="`打开分享页（${formatTime(item.createdAt)}）`"
                  @click="openShareLink(item)"
                >
                  <SvgIcon name="eye" :size="14" />
                </button>
                <button
                  class="ed-btn is-compact"
                  title="撤销这份分享"
                  @click="revokeShareItem(item)"
                >
                  <SvgIcon name="trash" :size="14" />
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sh-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ed-overlay);
}

.sh-card {
  width: 100%;
  max-width: 380px;
  /* 横屏矮屏（如手机横过来）内容不超出一屏，超出可滚 */
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.sh-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.sh-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.sh-close {
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

.sh-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.sh-desc {
  margin: 0 0 14px;
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.sh-privacy {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--ed-line);
  border-radius: 8px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.6;
}

.sh-privacy strong {
  color: var(--ed-text);
}

.sh-privacy code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--ed-surface, #fff);
  color: var(--ed-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

/*
 * 保留联系方式是「提高风险」的选择，要和默认那条明显区分开。
 *
 * 注意不能只写 `border-color`：`.sh-check` 本身没有边框，
 * 光设 border-color 是**看不见的**（我第一版就是这么写的，截图一看两个复选框一模一样）。
 * 所以这里给整块底色与边框，并把复选框本身也染成警示色。
 */
.sh-check-warn {
  padding: 8px 10px;
  border: 1px solid var(--ed-danger);
  border-radius: 8px;
  background: var(--ed-danger-tint);
}

.sh-check-warn input.ed-check {
  accent-color: var(--ed-danger);
}

.sh-check-warn strong {
  color: var(--ed-danger-strong);
}

/* 生成后「这条含真实联系方式」的提示：同理，要和默认的屏蔽提示区分开 */
.sh-privacy-warn {
  border-color: var(--ed-danger);
  background: var(--ed-danger-tint);
  color: var(--ed-danger-strong);
}

.sh-privacy-warn strong {
  color: var(--ed-danger-strong);
}

.sh-check-warn em {
  display: block;
  margin-top: 2px;
  color: var(--ed-text-3);
  font-size: 12px;
  font-style: normal;
}

.sh-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.6;
  cursor: pointer;
}

.sh-check .ed-check {
  flex: 0 0 auto;
  margin-top: 2px;
}

.sh-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
}

.sh-field > span {
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.sh-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* 我的分享列表 */
.sh-divider {
  height: 1px;
  margin: 16px 0 12px;
  background: var(--ed-line-soft);
}

.sh-mine-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--ed-ink);
  font-size: 13px;
  font-weight: 600;
}

.sh-mine-count {
  color: var(--ed-text-4);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.sh-mine-list {
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.sh-mine-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--ed-fill);
}

.sh-mine-row:last-child {
  border-bottom: 0;
}

.sh-mine-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sh-mine-meta strong {
  color: var(--ed-ink);
  font-size: 12.5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sh-mine-meta span {
  color: var(--ed-text-4);
  font-size: 11.5px;
}

.sh-mine-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-size: 10.5px;
  font-style: normal;
}

.sh-mine-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
</style>
