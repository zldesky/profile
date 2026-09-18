<script setup>
/**
 * 渲染服务访问口令输入弹窗。
 * 口令只用于向本机渲染服务证明身份，不写入简历数据，也不随导出文件带出。
 */
import { nextTick, ref, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  error: { type: String, default: '' },
  /** 校验进行中，禁用交互避免重复提交 */
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['submit', 'cancel'])

const value = ref('')
const visible = ref(false)
const inputRef = ref(null)

// 每次打开重置输入框并聚焦：上一次输入的多半是错的，留着反而干扰
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    value.value = ''
    visible.value = false
    await nextTick()
    inputRef.value?.focus()
  },
)

function submit() {
  if (props.busy) return
  emit('submit', value.value.trim())
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pw-mask" @click.self="emit('cancel')">
      <div class="pw-card" role="dialog" aria-modal="true" aria-label="渲染服务访问口令">
        <h3 class="pw-title">
          <SvgIcon name="lock" :size="15" />
          <span>渲染服务需要口令</span>
        </h3>

        <p class="pw-desc">
          服务端启用了 PDF_ACCESS_PASSWORD。口令只发送给本机渲染服务，不会写入简历数据，也不会随导出文件带出。
        </p>

        <div class="pw-field">
          <input
            ref="inputRef"
            v-model="value"
            class="ed-input"
            :type="visible ? 'text' : 'password'"
            placeholder="请输入访问口令"
            autocomplete="off"
            spellcheck="false"
            :disabled="busy"
            @keyup.enter="submit"
          />
          <button
            class="pw-eye"
            type="button"
            :title="visible ? '隐藏口令' : '显示口令'"
            :disabled="busy"
            @click="visible = !visible"
          >
            <SvgIcon :name="visible ? 'eyeOff' : 'eye'" :size="14" />
          </button>
        </div>

        <p v-if="error" class="pw-tip is-error">{{ error }}</p>
        <p v-else class="pw-tip">
          口令保存在本次会话中，刷新页面无需重新输入，关闭标签页后自动失效。
        </p>

        <div class="pw-actions">
          <button class="ed-btn" :disabled="busy" @click="emit('cancel')">取消</button>
          <button
            class="ed-btn ed-btn-primary"
            :disabled="!value.trim() || busy"
            @click="submit"
          >
            {{ busy ? '验证中…' : '确定并导出' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pw-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.34);
}

.pw-card {
  width: 100%;
  max-width: 390px;
  padding: 18px 18px 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
}

.pw-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 8px;
  color: #1f2329;
  font-size: 14.5px;
  font-weight: 600;
}

.pw-desc {
  margin: 0 0 12px;
  color: #5b6472;
  font-size: 12.5px;
  line-height: 1.65;
}

.pw-field {
  position: relative;
  display: flex;
  align-items: center;
}

/* 输入框占满卡片宽度，并给右侧的眼睛按钮留出位置 */
.pw-field .ed-input {
  width: 100%;
  box-sizing: border-box;
  padding-right: 36px;
}

.pw-eye {
  position: absolute;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8b93a1;
  cursor: pointer;
}

.pw-eye:hover:not(:disabled) {
  background: #f2f4f7;
  color: #2b579a;
}

.pw-tip {
  margin: 8px 0 0;
  color: #8b93a1;
  font-size: 12px;
  line-height: 1.6;
}

.pw-tip.is-error {
  color: #c0392b;
}

.pw-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
