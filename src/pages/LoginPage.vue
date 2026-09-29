<script setup>
/**
 * 登录 / 注册页。
 *
 * 编辑器不强制登录，这里只服务两件事：换设备恢复简历、解锁一键导出。
 * 注册即登录（注册成功直接建立会话），失败原因原样展示在表单下方。
 */
import { ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import SvgIcon from '@/components/SvgIcon.vue'
import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const auth = useAuth()
const { toast } = useToast()

const mode = shallowRef('login') // login | register
const username = ref('')
const password = ref('')
const busy = shallowRef(false)
const error = shallowRef('')

/** 会话恢复后误入登录页（比如点收藏夹）时直接送回编辑器 */
watch(
  auth.status,
  (value) => {
    if (value === 'authed') router.replace({ name: 'editor' })
  },
  { immediate: true },
)

function switchMode(next) {
  mode.value = next
  error.value = ''
}

/** 与服务端 validateCredentials 相同的规则，先拦一道省一次往返 */
function validate() {
  const name = username.value.trim()
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]{2,32}$/.test(name)) {
    return '用户名需为 2-32 位中英文、数字、下划线或连字符'
  }
  if (password.value.length < 8) return '密码至少 8 位'
  if (password.value.length > 72) return '密码最长 72 位'
  return ''
}

async function submit() {
  if (busy.value) return
  error.value = ''

  const invalid = validate()
  if (invalid) {
    error.value = invalid
    return
  }

  busy.value = true
  try {
    const user =
      mode.value === 'login'
        ? await auth.login(username.value.trim(), password.value)
        : await auth.register(username.value.trim(), password.value)
    toast(mode.value === 'login' ? `欢迎回来，${user.username}` : `注册成功，${user.username}`)
    router.replace({ name: 'editor' })
  } catch (requestError) {
    error.value = requestError.message || '请求失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-brand">
        <SvgIcon name="layout" :size="20" />
        <span>简历工坊</span>
      </div>

      <div class="auth-tabs" role="tablist">
        <button
          class="auth-tab"
          :class="{ 'is-active': mode === 'login' }"
          role="tab"
          :aria-selected="mode === 'login'"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          class="auth-tab"
          :class="{ 'is-active': mode === 'register' }"
          role="tab"
          :aria-selected="mode === 'register'"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label class="auth-field">
          <span>用户名</span>
          <input
            v-model="username"
            class="ed-input"
            type="text"
            name="username"
            placeholder="中英文、数字、下划线或连字符"
            autocomplete="username"
            spellcheck="false"
            :disabled="busy"
          />
        </label>

        <label class="auth-field">
          <span>密码</span>
          <input
            v-model="password"
            class="ed-input"
            type="password"
            name="password"
            placeholder="至少 8 位"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            :disabled="busy"
          />
        </label>

        <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

        <button class="ed-btn ed-btn-primary ed-btn-block" type="submit" :disabled="busy">
          {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>

      <p class="auth-hint">
        登录后简历自动云端同步，可在任何设备继续编辑；不登录也可以直接使用本地编辑与打印导出。
      </p>

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

.auth-tabs {
  display: flex;
  margin-bottom: 18px;
  border: 1px solid #e3e6ec;
  border-radius: 9px;
  padding: 3px;
  background: #f5f7fa;
}

.auth-tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #5b6472;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: 0.15s;
}

.auth-tab.is-active {
  background: #fff;
  color: #2b579a;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.auth-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.auth-field > span {
  color: #5b6472;
  font-size: 12.5px;
}

.auth-error {
  margin: 0;
  color: #c0392b;
  font-size: 12.5px;
  line-height: 1.5;
}

.auth-hint {
  margin: 16px 0 0;
  color: #8b93a1;
  font-size: 12px;
  line-height: 1.65;
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
