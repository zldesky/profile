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
        <SvgIcon name="layout" :size="20" />
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
  background: #f3f5f8;
}

.auth-card {
  width: 100%;
  max-width: 380px;
  padding: 26px 24px 20px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.1);
}

.auth-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 20px;
  color: #2b579a;
  font-size: 17px;
  font-weight: 600;
}

.auth-back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 14px;
  color: #8b93a1;
  font-size: 12.5px;
  text-decoration: none;
}

.auth-back:hover {
  color: #2b579a;
}
</style>
