import { shallowRef } from 'vue'

import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { BACKUP_KIND } from '@/utils/backup'
import { resumeToMarkdown, resumeToPlainText } from '@/utils/exporters'
import { markdownToResume, resumeToSourceMarkdown } from '@/utils/markdownSource'
import { downloadFile, formatTime } from '@/utils/helpers'

/**
 * 待确认的危险操作。模块级单例（与 useToast 同一做法），
 * 由 TopBar 统一渲染 ConfirmDialog —— 组合式函数里不持有 UI。
 *
 * 为什么不是「在函数里 await 一个 Promise<boolean>」那种写法：
 * 那样确认框的生命周期会悬在调用栈里，用户中途切文档、刷新页面都会让它永远挂起。
 * 把「请求」与「执行」拆成两步，状态就只是一份可被清空的数据。
 *
 * @type {import('vue').ShallowRef<null | {
 *   title: string, description: string, confirmText: string, danger: boolean,
 *   run: () => void
 * }>}
 */
const pendingConfirm = shallowRef(null)

/**
 * 简历数据的导入、导出与重置。
 * 只处理数据流与副作用，文件选择框由调用方持有。
 */
export function useResumeFile() {
  const store = useResumeStore()
  const { toast } = useToast()

  const baseName = () => store.basics.name || '简历'

  /**
   * 请求用户确认一次危险操作，确认后执行 run。
   * @param {{title: string, description: string, confirmText: string, danger?: boolean}} dialog
   * @param {() => void} run
   */
  function askConfirm(dialog, run) {
    pendingConfirm.value = {
      title: dialog.title,
      description: dialog.description,
      confirmText: dialog.confirmText,
      danger: dialog.danger !== false,
      run,
    }
  }

  /** 由 TopBar 在用户点「确认」时调用 */
  function confirmPending() {
    const task = pendingConfirm.value
    pendingConfirm.value = null
    task?.run?.()
  }

  function cancelPending() {
    pendingConfirm.value = null
  }

  /** 导出为 JSON，可用于备份或换设备继续编辑 */
  function exportJSON() {
    downloadFile(store.toJSON(), `${baseName()}-简历数据.json`)
    toast('已导出 JSON 数据，可用于备份或迁移')
  }

  /** 导出为 Markdown：贴进在线文档或支持 MD 的投递渠道 */
  function exportMarkdown() {
    downloadFile(resumeToMarkdown(store.resume), `${baseName()}-简历.md`, 'text/markdown')
    toast('已导出 Markdown 文档')
  }

  /** 导出为纯文本：面向 ATS 解析与招聘网站表单粘贴 */
  /**
   * 导出「内容源」Markdown。
   *
   * 与上面的 Markdown 文档**不是同一个用途**：
   *  - Markdown 文档（resumeToMarkdown）面向 ATS 与在线文档粘贴，读回来有损；
   *  - 内容源（resumeToSourceMarkdown）带类型提示与键值加粗，**能精确读回来**，
   *    用于在 VSCode / Obsidian / Typora 里编辑，再导回本应用。
   */
  function exportSourceMarkdown() {
    downloadFile(resumeToSourceMarkdown(store.resume), `${baseName()}-简历源.md`, 'text/markdown')
  }

  function exportPlainText() {
    downloadFile(resumeToPlainText(store.resume), `${baseName()}-简历.txt`, 'text/plain')
    toast('已导出纯文本简历')
  }

  /**
   * 整包备份：本机全部简历 + 历史版本打成一个文件，可跨设备恢复。
   * 头像引用内联由 store.exportAllData 完成，这里只负责下载与提示。
   */
  async function exportBackup() {
    try {
      const payload = await store.exportAllData()
      downloadFile(
        JSON.stringify(payload, null, 2),
        `简历工坊-整包备份-${formatTime(Date.now()).slice(0, 10)}.json`,
      )
      const extra = payload.snapshots?.length ? `、${payload.snapshots.length} 条历史版本` : ''
      toast(`已导出整包备份：${payload.docs.length} 份简历${extra}`)
    } catch (error) {
      toast(`整包备份失败：${error.message}`)
    }
  }

  /**
   * 从用户选中的文件导入。
   * 兼容两种文件：整包备份（kind 标识）走全量恢复；单份简历 JSON 覆盖当前简历。
   * 结构不合法时直接放弃，不覆盖现有数据；合法时先确认再执行。
   * @param {File|undefined} file
   */
  function importFromFile(file) {
    if (!file) return

    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result)
        if (data && typeof data === 'object' && data.kind === BACKUP_KIND) {
          const count = Array.isArray(data.docs) ? data.docs.length : 0
          askConfirm(
            {
              title: '恢复整包备份',
              description: count
                ? `会用备份里的 ${count} 份简历与历史版本覆盖本机全部数据。备份文件本身不会被改动。`
                : '会用备份内容覆盖本机全部数据。备份文件本身不会被改动。',
              confirmText: '覆盖并恢复',
            },
            () => {
              const restored = store.importAllData(data)
              toast(`已恢复整包备份：${restored} 份简历`)
            },
          )
          return
        }
        if (!data || typeof data !== 'object' || !Array.isArray(data.sections)) {
          throw new Error('缺少 sections 字段')
        }
        const currentName = store.basics.name || '未命名简历'
        askConfirm(
          {
            title: '导入简历数据',
            description: `会覆盖当前简历「${currentName}」。若现在这份还要留，先导出 JSON 备份再导入。`,
            confirmText: '覆盖并导入',
          },
          () => {
            store.replaceResume(data)
            toast('已导入简历数据')
          },
        )
      } catch (error) {
        toast(`导入失败：${error.message}`)
      }
    }
    reader.onerror = () => toast('文件读取失败')
    reader.readAsText(file)
  }

  /**
   * 导入 Markdown 简历（内容源或手写的 LapisCV 式 md）。
   *
   * 只还原**内容**：主题 / 模板 / 模块布局 / 头像不在 Markdown 里（见 markdownSource 文件头），
   * 导入后会取默认值。这一点必须在确认框里说清 ——
   * 用户以为「导出再导入就完全复原」是很自然的预期，而实际不是。
   *
   * @param {File|undefined} file
   */
  function importMarkdownFile(file) {
    if (!file) return

    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const text = String(reader.result || '')
        const draft = markdownToResume(text)
        const sections = draft.sections.length
        if (!sections && !draft.basics.name) {
          throw new Error('没读出姓名与模块，可能不是简历 Markdown')
        }

        const currentName = store.basics.name || '未命名简历'
        askConfirm(
          {
            title: '从 Markdown 导入',
            description:
              `会覆盖当前简历「${currentName}」，读到 ${sections} 个模块。` +
              '只还原内容：主题、模板、模块布局与头像会取默认值。',
            confirmText: '覆盖并导入',
          },
          () => {
            // replaceResume 内部会走 normalizeResume 补 id 与缺省字段
            store.replaceResume(draft)
            toast(`已从 Markdown 导入：${sections} 个模块`)
          },
        )
      } catch (error) {
        toast(`导入失败：${error.message}`)
      }
    }
    reader.onerror = () => toast('文件读取失败')
    reader.readAsText(file)
  }

  function resetResume() {
    askConfirm(
      {
        title: '返回示例简历',
        description: '当前内容会被示例简历替换。这一步不会清空历史版本，可用 Ctrl+Z 撤销。',
        confirmText: '换成示例简历',
      },
      () => {
        store.resetAll()
        toast('已恢复示例简历')
      },
    )
  }

  return {
    exportJSON,
    exportMarkdown,
    exportSourceMarkdown,
    exportPlainText,
    exportBackup,
    importFromFile,
    importMarkdownFile,
    resetResume,
    /* 确认框的读取端：状态在这里，渲染交给 TopBar */
    pendingConfirm,
    confirmPending,
    cancelPending,
  }
}
