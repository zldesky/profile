<script setup>
/**
 * 登录 / 注册弹窗。
 * 编辑器内点「登录 / 注册」或未登录一键导出时弹出，不打断当前编辑。
 * 弹窗交互由服务端配置 AUTH_POPUP 控制（经 useAuthDialog 读 /api/health），
 * 关闭时调用方回退为跳转独立登录页 /login。
 */
import { ref, watch } from 'vue'

import AuthPanel from '@/components/AuthPanel.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useAuthDialog } from '@/composables/useAuthDialog'

const { visible, initialMode, close, notifyAuthed } = useAuthDialog()

/** 每次打开都换 key 重挂表单：拿到新的滑块挑战，输入与错误提示一并清空 */
const openCount = ref(0)

watch(visible, (open) => {
  if (open) openCount.value += 1
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="ad-mask" @click.self="close()">
      <div class="ad-card" role="dialog" aria-modal="true" aria-label="登录或注册">
        <div class="ad-head">
          <h3 class="ad-title">账号</h3>
          <button class="ad-close" title="关闭" aria-label="关闭" @click="close()">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <AuthPanel
          :key="openCount"
          :initial-mode="initialMode"
          @authed="(user) => notifyAuthed(user)"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ad-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.34);
}

.ad-card {
  width: 100%;
  max-width: 380px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
}

.ad-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ad-title {
  margin: 0;
  color: #1f2329;
  font-size: 14.5px;
  font-weight: 600;
}

.ad-close {
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

.ad-close:hover {
  background: #f2f4f7;
  color: #2b579a;
}
</style>
