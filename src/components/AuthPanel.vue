<script setup>
/**
 * 登录 / 注册表单本体。
 * 独立登录页（LoginPage）与编辑器内弹窗（AuthDialog）共用：
 * 标签切换、凭证校验、滑块验证码与提交都在这里，成功后向父层抛 authed(user)。
 */
import { ref, shallowRef } from 'vue'

import SliderCaptcha from '@/components/SliderCaptcha.vue'
import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'

const emit = defineEmits(['authed'])

const props = defineProps({
  /** 初始标签：弹窗按触发场景传入（如导出场景直接落在登录） */
  initialMode: { type: String, default: 'login' },
})

const auth = useAuth()
const { toast } = useToast()

const mode = shallowRef(props.initialMode === 'register' ? 'register' : 'login')
const username = ref('')
const password = ref('')
const captchaToken = ref('')
const captchaRef = ref(null)
const busy = shallowRef(false)
const error = shallowRef('')

function switchMode(next) {
  mode.value = next
  error.value = ''
  // 切到登录时滑块随 v-if 卸载，令牌一并清掉
  if (next !== 'register') captchaToken.value = ''
}

/** 与服务端 validateCredentials 相同的规则，先拦一道省一次往返 */
function validate() {
  const name = username.value.trim()
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]{2,32}$/.test(name)) {
    return '用户名需为 2-32 位中英文、数字、下划线或连字符'
  }
  if (password.value.length < 8) return '密码至少 8 位'
  if (password.value.length > 72) return '密码最长 72 位'
  if (mode.value === 'register' && !captchaToken.value) return '请先完成滑块验证'
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
        : await auth.register(username.value.trim(), password.value, captchaToken.value)
    toast(mode.value === 'login' ? `欢迎回来，${user.username}` : `注册成功，${user.username}`)
    emit('authed', user)
  } catch (requestError) {
    error.value = requestError.message || '请求失败'
    // 注册请求会把通过令牌消费掉（无论成败），失败后必须重做滑块验证
    if (mode.value === 'register') captchaRef.value?.refresh()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
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

      <SliderCaptcha
        v-if="mode === 'register'"
        ref="captchaRef"
        v-model="captchaToken"
        :disabled="busy"
      />

      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

      <button class="ed-btn ed-btn-primary ed-btn-block" type="submit" :disabled="busy">
        {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
      </button>
    </form>

    <p class="auth-hint">
      登录后简历自动云端同步，可在任何设备继续编辑；不登录也可以直接使用本地编辑与打印导出。
    </p>
  </div>
</template>

<style scoped>
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
</style>
