<script setup>
/**
 * 登录 / 注册页（独立路由版）。
 * 表单本体抽在 AuthPanel（编辑器内的弹窗交互见 AuthDialog）；
 * 这里只保留品牌区与返回入口。会话恢复后误入登录页（比如点收藏夹）
 * 时直接送回编辑器。
 */
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import AuthPanel from '@/components/AuthPanel.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const auth = useAuth()

watch(
  auth.status,
  (value) => {
    if (value === 'authed') router.replace({ name: 'editor' })
  },
  { immediate: true },
)
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-brand">
        <span class="auth-logo"><SvgIcon name="layout" :size="18" /></span>
        <span>简历工坊</span>
      </div>

      <AuthPanel @authed="router.replace({ name: 'editor' })" />

      <router-link class="auth-back" :to="{ name: 'editor' }">
        <SvgIcon name="up" :size="13" />
        <span>返回编辑器</span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  /* 顶部一抹品牌色晕光 + 向下过渡的浅灰，比纯色背景更有产品落地页的完成度 */
  background:
    radial-gradient(900px 420px at 50% -120px, var(--ed-brand-ring), transparent 70%),
    linear-gradient(180deg, #f7f8fa 0%, #eef1f4 100%);
}

.auth-card {
  width: 100%;
  max-width: 380px;
  padding: 28px 26px 22px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
}

.auth-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 22px;
  color: var(--ed-ink);
  font-size: 17px;
  font-weight: 700;
}

.auth-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--ed-brand-grad-hi) 0%, var(--ed-brand-strong) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    var(--ed-brand-glow);
  color: #fff;
}

.auth-back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 14px;
  color: var(--ed-text-4);
  font-size: 12.5px;
  text-decoration: none;
}

.auth-back:hover {
  color: var(--ed-brand-strong);
}
</style>
