import { computed, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import { usePdfPassword } from '@/composables/usePdfPassword'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { downloadBlob } from '@/utils/helpers'
import { fetchServerHealth, requestServerPdf } from '@/utils/serverPdf'

const PRINT_HINT = '打印窗口请将「边距」设为默认、勾选「背景图形」，另存为 PDF 即可保留配色与分页'

/**
 * PDF 导出的两条路径，产物都是矢量文本：
 *  1. 打印导出——走浏览器打印，零依赖、不消耗额度，但需要用户手动勾选「背景图形」；
 *  2. 一键导出——走渲染服务，服务端自动开启背景，按用户计每日额度。
 *
 * 服务端鉴别身份靠会话 Cookie（登录后自动携带）或脚本口令 Bearer：
 * 口令只在本地保存，服务端用常量时间比较校验，连续错误会被临时锁定。
 * 未登录点击一键导出时，服务端返回 loginRequired，这里引导去登录页。
 */
export function usePdfExport() {
  const store = useResumeStore()
  const router = useRouter()
  const { toast } = useToast()
  const { password, set: setPassword, clear: clearPassword } = usePdfPassword()

  const exporting = shallowRef(false)
  /** 服务端返回的今日额度；null 表示服务未启动，或尚未通过口令校验 */
  const quota = shallowRef(null)
  /** 服务是否要求口令 */
  const authRequired = shallowRef(false)

  /** 口令输入弹窗状态 */
  const passwordOpen = shallowRef(false)
  const passwordError = shallowRef('')

  const quotaExhausted = computed(() => quota.value !== null && quota.value.remaining <= 0)
  /** 服务要口令、而本地还没有可用口令 */
  const needPassword = computed(() => authRequired.value && !password.value)

  /** 统一的导出文件名，沿用投递习惯：姓名_应聘岗位 */
  const filename = computed(() => {
    const name = (store.basics.name || '简历').trim()
    const role = (store.basics.jobTitle || '').trim()
    return role ? `${name}_${role}` : `${name}_简历`
  })

  /**
   * 同步服务状态。
   * 未通过校验时服务端不回额度，此处保持 null 而不是沿用旧值，
   * 否则口令失效后界面上仍显示着一个已经不可信的剩余次数。
   */
  async function refreshQuota() {
    const health = await fetchServerHealth(password.value)
    authRequired.value = health?.authRequired === true
    quota.value = health?.quota ?? null
  }

  onMounted(refreshQuota)

  /**
   * 打印导出。
   * 打印期间临时改写 document.title，浏览器会用它作为「另存为 PDF」的默认文件名。
   */
  function printPdf() {
    store.save()

    const originalTitle = document.title
    document.title = filename.value
    toast(PRINT_HINT, 4200)

    setTimeout(() => {
      const restore = () => {
        document.title = originalTitle
        window.removeEventListener('afterprint', restore)
      }
      window.addEventListener('afterprint', restore)
      window.print()
      // Safari 等不触发 afterprint 的浏览器兜底恢复
      setTimeout(restore, 2000)
    }, 150)
  }

  /**
   * 按错误成因分流处理。
   * 口令类错误不能笼统提示「导出失败」——用户需要知道是输错了、还是被锁了。
   */
  function handleError(error) {
    const message = error.message || '未知错误'

    switch (error.code) {
      case 'AUTH_REQUIRED':
        // 服务开了口令通道却没带对口令 → 弹口令框；否则是没登录 → 去登录页
        if (authRequired.value) {
          passwordError.value = ''
          passwordOpen.value = true
        } else {
          toast('登录后即可一键导出，正在前往登录页…', 2600)
          router.push({ name: 'login' })
        }
        return

      case 'AUTH_FAILED':
        // 口令错误：清掉本地缓存，避免后续请求继续带着错误口令撞锁定
        clearPassword()
        passwordError.value = '口令不正确，请重新输入'
        passwordOpen.value = true
        return

      case 'AUTH_LOCKED':
        // 已进入锁定窗口，继续重试只会延长锁定，必须停手并说清剩余时间
        clearPassword()
        passwordOpen.value = false
        passwordError.value = ''
        toast(`一键导出失败：${message}`, 5200)
        return

      default: {
        passwordOpen.value = false
        // 额度或来源被拒属于可预期的限制，提示走另一条路而不是让用户去查服务
        const hint = /额度|来源/.test(message)
          ? '可改用「打印导出」'
          : '请确认已运行 npm run pdf，或改用「打印导出」'
        toast(`一键导出失败：${message}。${hint}`, 4800)
      }
    }
  }

  /** 提交给本地渲染服务，取回矢量 PDF 并直接下载 */
  async function runExport() {
    exporting.value = true

    try {
      const blob = await requestServerPdf(store.resume, filename.value, password.value)
      downloadBlob(blob, `${filename.value}.pdf`)

      passwordOpen.value = false
      passwordError.value = ''
      toast('已导出矢量 PDF，文本可选中')
    } catch (error) {
      handleError(error)
    } finally {
      exporting.value = false
      // 无论成功失败都同步一次额度，保证按钮状态与服务端一致
      await refreshQuota()
    }
  }

  async function exportViaServer() {
    if (exporting.value || quotaExhausted.value) return

    // 已知需要口令而本地没有，直接弹窗，省掉一次注定失败的请求
    if (needPassword.value) {
      passwordError.value = ''
      passwordOpen.value = true
      return
    }

    await runExport()
  }

  /** 弹窗提交：先落盘再重试导出，失败时弹窗由 handleError 维持打开 */
  async function submitPassword(value) {
    const next = String(value || '').trim()
    if (!next) {
      passwordError.value = '请输入访问口令'
      return
    }

    setPassword(next)
    await runExport()
  }

  function cancelPassword() {
    passwordOpen.value = false
    passwordError.value = ''
  }

  return {
    filename,
    exporting,
    quota,
    quotaExhausted,
    authRequired,
    needPassword,
    passwordOpen,
    passwordError,
    refreshQuota,
    printPdf,
    exportViaServer,
    submitPassword,
    cancelPassword,
  }
}
