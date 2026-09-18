import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { downloadFile } from '@/utils/helpers'

/**
 * 简历数据的导入、导出与重置。
 * 只处理数据流与副作用，文件选择框由调用方持有。
 */
export function useResumeFile() {
  const store = useResumeStore()
  const { toast } = useToast()

  /** 导出为 JSON，可用于备份或换设备继续编辑 */
  function exportJSON() {
    downloadFile(store.toJSON(), `${store.basics.name || '简历'}-简历数据.json`)
    toast('已导出 JSON 数据，可用于备份或迁移')
  }

  /**
   * 从用户选中的文件导入。
   * 结构不合法时直接放弃，不覆盖当前简历。
   * @param {File|undefined} file
   */
  function importFromFile(file) {
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (!data || typeof data !== 'object' || !Array.isArray(data.sections)) {
          throw new Error('缺少 sections 字段')
        }
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

  return { exportJSON, importFromFile, resetResume }
}
