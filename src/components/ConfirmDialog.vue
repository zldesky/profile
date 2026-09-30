<script setup>
/**
 * 通用确认弹窗：标题 + 说明 + 取消/确认双按钮。
 * 供退出登录这类需要一次确认的操作使用；Teleport 到 body，
 * 视觉与交互对齐 PasswordDialog / AuthDialog（遮罩点击即取消）。
 */
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  /** 危险操作时确认按钮显示为红色 */
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cf-mask" @click.self="emit('cancel')">
      <div class="cf-card" role="dialog" aria-modal="true" :aria-label="title">
        <h3 class="cf-title">{{ title }}</h3>
        <p v-if="description" class="cf-desc">{{ description }}</p>

        <div class="cf-actions">
          <button class="ed-btn" :disabled="busy" @click="emit('cancel')">
            {{ cancelText }}
          </button>
          <button
            class="ed-btn cf-confirm"
            :class="{ 'is-danger': danger }"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cf-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.34);
}

.cf-card {
  width: 100%;
  max-width: 340px;
  padding: 18px 18px 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
}

.cf-title {
  margin: 0 0 8px;
  color: #1f2329;
  font-size: 14.5px;
  font-weight: 600;
}

.cf-desc {
  margin: 0 0 14px;
  color: #5b6472;
  font-size: 12.5px;
  line-height: 1.65;
}

.cf-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 危险操作的确认键：红底白字，与普通主按钮区分 */
.cf-confirm.is-danger {
  border-color: #c0392b;
  background: #c0392b;
  color: #fff;
}

.cf-confirm.is-danger:hover:not(:disabled) {
  background: #a93226;
  border-color: #a93226;
}
</style>
