import { shallowRef } from 'vue'

/**
 * 登录态。模块级单例：路由、顶栏、导出流程看到的都是同一份状态。
 *
 * status 有三态：
 *  - loading：正在向服务端确认会话（刷新后的短暂窗口）；
 *  - anon：未登录，编辑器照常可用（纯本地），只是没有云端同步与一键导出；
 *  - authed：已登录，云端同步激活。
 */
const user = shallowRef(null)
const status = shallowRef('loading')

let initPromise = null

async function requestMe() {
  try {
    const response = await fetch('/api/auth/me')
    if (!response.ok) return null
    const data = await response.json()
    return data?.authenticated ? data.user : null
  } catch {
    // 服务未启动时按未登录处理，编辑器不依赖后端也能用
    return null
  }
}

/** 收到 401（会话过期）时统一走这里：回到匿名态，界面随之切回「登录」入口 */
function markExpired() {
  user.value = null
  status.value = 'anon'
}

export function useAuth() {
  /**
   * 启动时确认一次会话。幂等：多处调用共享同一个 Promise，
   * 避免刷新瞬间发出多个 /api/auth/me。
   */
  function init() {
    if (!initPromise) {
      initPromise = requestMe().then((found) => {
        user.value = found
        status.value = found ? 'authed' : 'anon'
      })
    }
    return initPromise
  }

  /**
   * 登录/注册共用：失败抛出带服务端可读信息的 Error，调用方展示在表单上。
   * @param {'login' | 'register'} action
   * @param {string} [captchaToken] 注册必填：滑块验证通过令牌，登录不传
   */
  async function submitCredentials(action, username, password, captchaToken) {
    const response = await fetch(`/api/auth/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, captchaToken }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data?.message || '请求失败')
      error.status = response.status
      throw error
    }

    user.value = data.user
    status.value = 'authed'
    return data.user
  }

  function login(username, password) {
    return submitCredentials('login', username, password)
  }

  function register(username, password, captchaToken) {
    return submitCredentials('register', username, password, captchaToken)
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* 即使请求失败也照样清本地态：服务端会话 30 天后自然过期 */
    }
    markExpired()
  }

  return { user, status, init, login, register, logout, markExpired }
}
