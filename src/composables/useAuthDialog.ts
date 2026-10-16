import { shallowRef } from 'vue'

import { fetchServerHealth } from '@/utils/serverPdf'
import type { AuthUser } from '@/composables/useAuth'

type AuthMode = 'login' | 'register'

/**
 * 登录 / 注册弹窗的全局状态（模块级单例）。
 *
 * 编辑器内的三处入口共用：顶栏「登录 / 注册」按钮、未登录一键导出。
 * 是否启用弹窗由服务端配置 AUTH_POPUP 决定（经 /api/health 下发）：
 * open() 返回 false 表示配置关闭了弹窗，调用方自行回退为跳转独立登录页。
 *
 * onAuthed 回调用于「导出前先登录」这类续跑场景：登录成功 → 关闭弹窗 →
 * 继续执行原操作，用户不丢编辑上下文。
 */
const visible = shallowRef(false)
const initialMode = shallowRef<AuthMode>('login')
let afterAuthed: ((user: AuthUser) => void) | null = null
/** 弹窗开关缓存：每次页面加载只拉一次健康检查 */
let popupFlagPromise: Promise<boolean> | null = null

async function popupEnabled(): Promise<boolean> {
  if (!popupFlagPromise) {
    popupFlagPromise = fetchServerHealth('').then(
      (health) => health?.authPopup !== false,
      () => true, // 服务未启动等异常时按开启处理，不阻塞登录入口
    )
  }
  return popupFlagPromise
}

export function useAuthDialog() {
  /**
   * 尝试打开弹窗。
   * @returns false = 配置关闭了弹窗，调用方应跳转登录页
   */
  async function open(
    options: { mode?: AuthMode; onAuthed?: (user: AuthUser) => void } = {},
  ): Promise<boolean> {
    if (!(await popupEnabled())) return false
    initialMode.value = options.mode ?? 'login'
    afterAuthed = options.onAuthed || null
    visible.value = true
    return true
  }

  function close(): void {
    visible.value = false
    afterAuthed = null
  }

  /** AuthPanel 认证成功后调用：关弹窗并续跑回调 */
  function notifyAuthed(user: AuthUser): void {
    const callback = afterAuthed
    close()
    callback?.(user)
  }

  return { visible, initialMode, open, close, notifyAuthed }
}
