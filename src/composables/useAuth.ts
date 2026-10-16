import { shallowRef } from 'vue'

export interface AuthUser {
  id: number
  username: string
  /** admin = 实例管理员（首个注册账号），member = 普通用户 */
  role?: 'admin' | 'member'
}

/** 登录态三态：确认会话中 / 未登录（纯本地可用）/ 已登录（云端同步激活） */
export type AuthStatus = 'loading' | 'anon' | 'authed'

/**
 * 登录态。模块级单例：路由、顶栏、导出流程看到的都是同一份状态。
 */
const user = shallowRef<AuthUser | null>(null)
const status = shallowRef<AuthStatus>('loading')

let initPromise: Promise<void> | null = null

async function requestMe(): Promise<AuthUser | null> {
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
function markExpired(): void {
  user.value = null
  status.value = 'anon'
}

export function useAuth() {
  /**
   * 启动时确认一次会话。幂等：多处调用共享同一个 Promise，
   * 避免刷新瞬间发出多个 /api/auth/me。
   */
  function init(): Promise<void> {
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
   * @param captchaToken 注册必填：滑块验证通过令牌，登录不传
   */
  async function submitCredentials(
    action: 'login' | 'register',
    username: string,
    password: string,
    captchaToken?: string,
  ): Promise<AuthUser> {
    const response = await fetch(`/api/auth/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, captchaToken }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error: Error & { status?: number } = new Error(data?.message || '请求失败')
      error.status = response.status
      throw error
    }

    user.value = data.user
    status.value = 'authed'
    return data.user
  }

  function login(username: string, password: string): Promise<AuthUser> {
    return submitCredentials('login', username, password)
  }

  function register(username: string, password: string, captchaToken: string): Promise<AuthUser> {
    return submitCredentials('register', username, password, captchaToken)
  }

  async function logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* 即使请求失败也照样清本地态：服务端会话 30 天后自然过期 */
    }
    markExpired()
  }

  return { user, status, init, login, register, logout, markExpired }
}
