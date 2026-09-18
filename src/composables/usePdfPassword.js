import { ref } from 'vue'

/** 会话存储键。口令只存在浏览器本地，不会进入构建产物，也不会随简历数据导出。 */
const STORAGE_KEY = 'resume-pdf-password'

function read() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || ''
  } catch {
    // 隐私模式等场景下存储被禁用，退化为仅内存保存
    return ''
  }
}

/** 模块级单例：编辑器里只有一处口令状态，不必为此引入 store */
const password = ref(read())

/**
 * PDF 渲染服务的访问口令。
 *
 * 用 sessionStorage 而不是 localStorage：刷新页面仍保留、不必重复输入，
 * 关闭标签页即失效，避免口令在公用电脑上长期留存。
 */
export function usePdfPassword() {
  function set(value) {
    // 与服务端一致地裁剪空白，避免复制粘贴带进空格后校验失败
    const next = String(value || '').trim()
    password.value = next

    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, next)
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* 存储不可用时仅保留在内存，本次会话内依然可用 */
    }
  }

  function clear() {
    set('')
  }

  return { password, set, clear }
}
