import { computed, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import { useAuth } from '@/composables/useAuth'
import { useAuthDialog } from '@/composables/useAuthDialog'
import { usePdfPassword } from '@/composables/usePdfPassword'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { checkResume } from '@/utils/completeness'
import { decideExportAction } from '@/utils/exportFlow'
import { resumeToPlainText } from '@/utils/exporters'
import { monthStamp, resumeFileName } from '@/utils/filename'
import { downloadBlob, formatBytes, formatTime } from '@/utils/helpers'
import { fetchServerHealth, requestServerPdf } from '@/utils/serverPdf'
import { utf8Bytes, zipBlob } from '@/utils/zip'

const PRINT_HINT = '打印窗口请将「边距」设为默认、勾选「背景图形」，另存为 PDF 即可保留配色与分页'

/**
 * PDF 导出的两条路径，产物都是矢量文本：
 *  1. 打印导出——走浏览器打印，零依赖、不消耗额度，但需要用户手动勾选「背景图形」；
 *  2. 导出 PDF——走渲染服务，服务端自动开启背景，按用户计每日额度。
 *
 * 服务端鉴别身份靠会话 Cookie（登录后自动携带）或脚本口令 Bearer：
 * 口令只在本地保存，服务端用常量时间比较校验，连续错误会被临时锁定。
 * 未登录点击导出时弹出登录/注册弹窗，成功后自动续跑导出（可配置关闭）。
 */
export function usePdfExport() {
  const store = useResumeStore()
  const router = useRouter()
  const { toast } = useToast()
  const auth = useAuth()
  const authDialog = useAuthDialog()
  const { password, set: setPassword, clear: clearPassword } = usePdfPassword()

  const exporting = shallowRef(false)

  /**
   * 导出前检查的结果。
   *
   * 只在**有 error 级问题**时才拦一次（缺姓名、空模块这类会直接让招聘方扣分的）。
   * 不拦 warn / tip：那会把「先导出看看效果」变成一件很烦的事。
   * 也**不做硬阻断** —— 弹一次确认，用户可以点「仍然导出」。
   *
   * 显式标注类型：`shallowRef([])` 会被推成 `Ref<never[]>`，
   * 调用方读 `issue.title` 就报「never 上不存在」——
   * 与 completeness 的 report 是同一类问题（本仓库已出现多次）。
   * @type {import('vue').ShallowRef<Array<{ level: string, title: string, detail: string }>>}
   */
  const preflightIssues = shallowRef([])
  const preflightOpen = shallowRef(false)

  /** 服务端返回的今日额度；null 表示服务未启动，或尚未通过口令校验 */

  /**
   * 服务端下发的导出额度。
   * 用 JSDoc 引用服务端的 QuotaStatus（import type 导出会被擦除，不产生运行时依赖）：
   * `shallowRef(null)` 在 TS 下推成 `Ref<null>`，调用方读 `.value.remaining` 就报
   * 「never 上不存在」—— 与 usePaperSelection 的 bandRect 同一处理：
   * 能用标注解决的事，不必把整个文件迁 TS。
   * @type {import('vue').ShallowRef<import('../server/requestGuards.ts').QuotaStatus | null>}
   */
  const quota = shallowRef(null)
  /** 服务是否要求口令 */
  const authRequired = shallowRef(false)

  /** 口令输入弹窗状态 */
  const passwordOpen = shallowRef(false)
  const passwordError = shallowRef('')

  const quotaExhausted = computed(() => quota.value !== null && quota.value.remaining <= 0)
  /** 服务要口令、而本地还没有可用口令 */
  const needPassword = computed(() => authRequired.value && !password.value)

  /**
   * 统一的导出文件名，沿用投递习惯：姓名_应聘岗位。
   * 规则抽在 utils/filename —— 投递包、打印、下载三处共用同一套清洗，
   * 否则「下载的是 张伟_前端.pdf、打印出来却是 张/伟_前端.pdf」这种不一致迟早出现。
   */
  const filename = computed(() =>
    resumeFileName({ name: store.basics.name, jobTitle: store.basics.jobTitle }),
  )

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
   * 需要登录时的统一入口：默认弹出登录/注册弹窗（不打断编辑），
   * 认证成功后续跑 action；服务端配置关闭弹窗时回退为跳转登录页。
   */
  async function requireAuthThen(action) {
    const opened = await authDialog.open({ mode: 'login', onAuthed: action })
    if (!opened) {
      toast('登录后即可导出 PDF，正在前往登录页…', 2600)
      router.push({ name: 'login' })
    }
  }

  /**
   * 按错误成因分流处理。
   * 口令类错误不能笼统提示「导出失败」——用户需要知道是输错了、还是被锁了。
   */
  function handleError(error) {
    const message = error.message || '未知错误'

    switch (error.code) {
      case 'AUTH_REQUIRED':
        // 服务开了口令通道却没带对口令 → 弹口令框；否则是没登录 → 弹登录/注册框
        if (authRequired.value) {
          passwordError.value = ''
          passwordOpen.value = true
        } else {
          requireAuthThen(() => runExport())
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
        toast(`导出没有成功：${message}`, 5200)
        return

      default: {
        passwordOpen.value = false
        // 额度或来源被拒属于可预期的限制，提示走另一条路而不是让用户去查服务
        const hint = /额度|来源/.test(message)
          ? '可改用「打印导出」'
          : '请确认已运行 npm run pdf，或改用「打印导出」'
        toast(`导出没有成功：${message}。${hint}`, 4800)
      }
    }
  }

  /**
   * 导出前检查：只挑出 error 级问题。
   *
   * 为什么值得做这一步：缺姓名、模块空白这类问题在纸面上看着不明显
   * （尤其模板里留白很多时），但招聘方一眼就能看到。
   * 在导出**之前**提醒一次，成本是一次点击；导出之后发现，成本是一次投递机会。
   *
   * 为什么只拦 error：warn 与 tip 动辄十几条，每次都弹就变成噪音，
   * 用户会养成「闭眼点继续」的习惯 —— 那时连真正该看的那条也会被跳过。
   *
   * @returns true 表示可以继续导出
   */
  function passesPreflight() {
    const report = checkResume(store.resume)
    const blocking = report.issues.filter((issue) => issue.level === 'error')
    if (!blocking.length) return true
    preflightIssues.value = blocking
    preflightOpen.value = true
    return false
  }

  /** 用户在导出前检查里选「仍然导出」 */
  function confirmPreflight() {
    preflightOpen.value = false
    runExport()
  }

  function cancelPreflight() {
    preflightOpen.value = false
  }

  /**
   * 判定这次点击该做什么，并执行「该做的准备」。
   *
   * 判定逻辑在 utils/exportFlow.ts（纯函数，17 例单测覆盖了每种组合）。
   * 这里只负责把判定结果映射成动作 —— 两个导出入口（单份 PDF / 投递包）共用它，
   * 于是「未登录会怎样、要口令会怎样」在两条路径上不会分叉。
   *
   * @param retry 认证成功后要重跑的动作
   * @returns true 表示可以继续执行真正的导出
   */
  async function prepare(retry) {
    const action = decideExportAction({
      auth: auth.status.value,
      authRequired: authRequired.value,
      hasPassword: Boolean(password.value),
      quotaExhausted: quotaExhausted.value,
      exporting: exporting.value,
    })

    if (action === 'noop') return false
    if (action === 'ask-password') {
      passwordError.value = ''
      passwordOpen.value = true
      return false
    }
    if (action === 'ask-login') {
      await requireAuthThen(retry)
      return false
    }
    return true
  }

  /**
   * 投递包：把「投递用的 PDF」与「给 ATS 的纯文本」打成一个 zip。
   *
   * 为什么值得做成一个动作：投递时通常要两份 —— 招聘系统要能解析的纯文本，
   * 人看的是 PDF。分开导两次容易只导一份，或者两份不同步（改完只重导了 PDF）。
   * 装在一个包里，命名一致、时间一致。
   *
   * 不做「打包失败就静默降级成单文件下载」：那会让用户以为拿到了完整投递包。
   */
  async function exportPackage() {
    if (!(await prepare(() => exportPackage()))) return
    if (!passesPreflight()) return

    exporting.value = true
    try {
      const pdfBlob = await requestServerPdf(store.resume, filename.value, password.value)
      const stamp = monthStamp()
      const base = resumeFileName({
        name: store.basics.name,
        jobTitle: store.basics.jobTitle,
        suffix: stamp,
      })

      const entries = [
        { name: `${base}.pdf`, data: new Uint8Array(await pdfBlob.arrayBuffer()) },
        {
          name: `${base}.txt`,
          data: utf8Bytes(resumeToPlainText(store.resume)),
        },
        {
          // 说明文件：拿到包的人（包括几个月后的自己）能知道这两份是什么
          name: '说明.txt',
          data: utf8Bytes(
            [
              `投递包：${store.basics.name || '未命名'}${store.basics.jobTitle ? ` · ${store.basics.jobTitle}` : ''}`,
              `导出时间：${formatTime(Date.now())}`,
              '',
              `${base}.pdf  投递用，文字可选中`,
              `${base}.txt  给招聘系统解析用，纯文本`,
              '',
              '由「简历工坊」导出。',
            ].join('\n'),
          ),
        },
      ]

      downloadBlob(zipBlob(entries), `${base}.zip`)
      passwordOpen.value = false
      passwordError.value = ''
      toast(`已导出投递包（PDF + 纯文本，${formatBytes(zipBlob(entries).size)}）`, 3600)
    } catch (error) {
      handleError(error)
    } finally {
      exporting.value = false
      await refreshQuota()
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
      /*
       * 如实回执：说清「导出了什么、多大」。
       * 原先只说「已导出矢量 PDF，文本可选中」—— 用户无法确认
       * 是不是导出成了空白页，也没法判断文件大小是否正常。
       * 数字都来自真实测量（Blob 的字节数）。
       */
      toast(`已导出 ${filename.value}.pdf（${formatBytes(blob.size)}，文字可选中）`, 3200)
    } catch (error) {
      handleError(error)
    } finally {
      exporting.value = false
      // 无论成功失败都同步一次额度，保证按钮状态与服务端一致
      await refreshQuota()
    }
  }

  async function exportViaServer() {
    /*
     * 导出前检查排在认证之前：
     * 若简历有明显硬伤，先让用户看到问题，而不是先让他登录、再告诉他内容不合格 ——
     * 那个顺序会让人觉得「白登录了一次」。
     */
    if (!(await prepare(() => runExport()))) return
    if (!passesPreflight()) return

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
    /* 导出前检查 */
    preflightOpen,
    preflightIssues,
    confirmPreflight,
    cancelPreflight,
    /* 投递包 */
    exportPackage,
  }
}
