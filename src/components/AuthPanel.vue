<script setup>
/**
 * 登录 / 注册表单本体。
 * 独立登录页（LoginPage）与编辑器内弹窗（AuthDialog）共用：
 * 标签切换、凭证校验、滑块验证码与提交都在这里，成功后向父层抛 authed(user)。
 */
import { ref, shallowRef } from 'vue'

import CaptchaDialog from '@/components/CaptchaDialog.vue'
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
/** 滑块验证弹窗：点击「注册并登录」时才拉起，不在表单里常驻 */
const captchaOpen = shallowRef(false)
const busy = shallowRef(false)
const error = shallowRef('')

function switchMode(next) {
  mode.value = next
  error.value = ''
  captchaToken.value = ''
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

  // 注册先过人机验证：此处弹出滑块窗口，通过后 onCaptchaVerified 回到本函数
  if (mode.value === 'register' && !captchaToken.value) {
    captchaOpen.value = true
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
    // 注册请求会把通过令牌消费掉（无论成败），重新提交时会再次弹出滑块
    captchaToken.value = ''
  } finally {
    busy.value = false
  }
}

/** 滑块验证通过：收下一次性令牌，关弹窗并自动继续注册 */
function onCaptchaVerified(token) {
  captchaToken.value = token
  captchaOpen.value = false
  submit()
}

/** 连续失败达上限：验证窗口自动关闭，表单上给出红色说明 */
function onCaptchaExhausted() {
  captchaOpen.value = false
  error.value = '滑块验证失败次数过多，已自动关闭；点击「注册并登录」可重试'
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

      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>

      <button class="ed-btn ed-btn-primary ed-btn-block" type="submit" :disabled="busy">
        {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
      </button>
    </form>

    <p class="auth-hint">
      登录后简历自动云端同步，可在任何设备继续编辑；不登录也可以直接使用本地编辑与打印导出。
    </p>

    <!-- 验证码弹窗 Teleport 到 body，放在这里只是便于就近阅读 -->
    <CaptchaDialog
      :open="captchaOpen"
      @verified="onCaptchaVerified"
      @cancel="captchaOpen = false"
      @exhausted="onCaptchaExhausted"
    />
  </div>
</template>

<style scoped>
.auth-tabs {
  display: flex;
  margin-bottom: 18px;
  padding: 3px;
  border: 1px solid var(--ed-line-soft);
  border-radius: 9px;
  background: var(--ed-fill);
}

.auth-tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ed-text-2);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: 0.15s;
}

.auth-tab.is-active {
  background: var(--ed-surface);
  color: var(--ed-brand-deep);
  font-weight: 600;
  box-shadow:
    0 1px 2px rgba(16, 24, 40, 0.12),
    0 0 1px rgba(16, 24, 40, 0.1);
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
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.auth-error {
  margin: 0;
  color: var(--ed-danger-strong);
  font-size: 12.5px;
  line-height: 1.5;
}

.auth-hint {
  margin: 16px 0 0;
  color: var(--ed-text-4);
  font-size: 12px;
  line-height: 1.65;
}
</style>
