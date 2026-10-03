<script setup>
/**
 * 简历分享弹窗：把当前简历创建为公开只读链接。
 * 创建要求登录（防滥用）；链接任何人可查看与打印，到期自动失效，
 * 创建者可在弹窗里撤销。入口在 TopBar。
 */
import { shallowRef, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { createShare, deleteShare } from '@/utils/shareApi'

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

const busy = shallowRef(false)
/** 当前弹窗会话里生成的分享 id（撤销用） */
const shareId = shallowRef('')
const link = shallowRef('')
const expiryText = shallowRef('')

async function generate() {
  if (busy.value) return
  busy.value = true
  try {
    const { id, expiresAt } = await createShare(store.resume)
    shareId.value = id
    link.value = `${location.origin}/share/${id}`
    const days = Math.max(1, Math.ceil((expiresAt - Date.now()) / 86400000))
    expiryText.value = `有效期约 ${days} 天，到期自动失效`
    toast('分享链接已生成')
  } catch (error) {
    if (error.code === 'AUTH_EXPIRED') {
      toast('登录已过期，请重新登录后再分享')
    } else {
      toast(error.message || '分享创建失败')
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
    expiryText.value = ''
    toast('分享已撤销，链接立即失效')
  } catch (error) {
    toast(error.message || '撤销失败')
  } finally {
    busy.value = false
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
          <button class="ed-btn ed-btn-primary ed-btn-block" :disabled="busy" @click="generate">
            <SvgIcon name="link" :size="14" />
            <span>{{ busy ? '生成中…' : '生成分享链接' }}</span>
          </button>
        </template>

        <template v-else>
          <label class="sh-field">
            <span>分享链接</span>
            <input class="ed-input" :value="link" readonly @focus="$event.target.select()" />
          </label>
          <p class="ed-hint">{{ expiryText }}。链接公开可见，请确认简历里没有不想公开的信息。</p>
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
  background: rgba(16, 24, 40, 0.42);
}

.sh-card {
  width: 100%;
  max-width: 380px;
  padding: 18px 20px 16px;
  border-radius: 16px;
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
  border-radius: 6px;
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
</style>
