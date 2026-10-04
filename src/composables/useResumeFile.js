import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { BACKUP_KIND } from '@/utils/backup'
import { resumeToMarkdown, resumeToPlainText } from '@/utils/exporters'
import { downloadFile, formatTime } from '@/utils/helpers'

/**
 * 简历数据的导入、导出与重置。
 * 只处理数据流与副作用，文件选择框由调用方持有。
 */
export function useResumeFile() {
  const store = useResumeStore()
  const { toast } = useToast()

  const baseName = () => store.basics.name || '简历'

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
          const message = count
            ? `导入整包备份将覆盖本机全部 ${count} 份简历与历史版本，确定继续？`
            : '导入整包备份将覆盖本机全部数据，确定继续？'
          if (!window.confirm(message)) return
          const restored = store.importAllData(data)
          toast(`已恢复整包备份：${restored} 份简历`)
          return
        }
        if (!data || typeof data !== 'object' || !Array.isArray(data.sections)) {
          throw new Error('缺少 sections 字段')
        }
        const currentName = store.basics.name || '未命名简历'
        if (!window.confirm(`导入将覆盖当前简历「${currentName}」，确定继续？`)) return
        store.replaceResume(data)
        toast('已导入简历数据')
      } catch (error) {
        toast(`导入失败：${error.message}`)
      }
    }
    reader.onerror = () => toast('文件读取失败')
    reader.readAsText(file)
  }

  function resetResume() {
    if (!window.confirm('恢复为示例简历？当前所有修改都会丢失。')) return
    store.resetAll()
    toast('已恢复示例简历')
  }

  return { exportJSON, exportMarkdown, exportPlainText, exportBackup, importFromFile, resetResume }
}
