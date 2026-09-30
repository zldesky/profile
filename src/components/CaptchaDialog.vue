<script setup>
/**
 * 滑块验证码弹窗。
 * 注册提交时由 AuthPanel 拉起：拖动通过即回传令牌并自动继续注册，
 * 表单里不再常驻验证码。独立 Teleport 弹层，层级高于登录弹窗，
 * 在独立登录页与账号弹窗里都能正常浮起。
 */
import { ref, watch } from 'vue'

import SliderCaptcha from '@/components/SliderCaptcha.vue'
import SvgIcon from '@/components/SvgIcon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['verified', 'cancel'])

const token = ref('')
/** 每次打开都换 key 重挂滑块：拿一张新的挑战图 */
const openCount = ref(0)

watch(
  () => props.open,
  (open) => {
    if (open) {
      token.value = ''
      openCount.value += 1
    }
  },
)

watch(token, (value) => {
  if (value) emit('verified', value)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cd-mask" @click.self="emit('cancel')">
      <div class="cd-card" role="dialog" aria-modal="true" aria-label="安全验证">
        <div class="cd-head">
          <h3 class="cd-title">安全验证</h3>
          <button class="cd-close" title="关闭" aria-label="关闭" @click="emit('cancel')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <p class="cd-desc">拖动滑块将拼图对准缺口，完成验证后自动继续注册</p>

        <SliderCaptcha :key="openCount" v-model="token" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 高于 AuthDialog 的 z-index:80，账号弹窗之上还能浮起 */
.cd-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.34);
}

.cd-card {
  width: 100%;
  max-width: 348px;
  padding: 16px 18px 18px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
}

.cd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.cd-title {
  margin: 0;
  color: #1f2329;
  font-size: 14.5px;
  font-weight: 600;
}

.cd-close {
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

.cd-close:hover {
  background: #f2f4f7;
  color: #2b579a;
}

.cd-desc {
  margin: 0 0 12px;
  color: #8b93a1;
  font-size: 12px;
  line-height: 1.6;
}
</style>
