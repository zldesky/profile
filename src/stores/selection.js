import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { useResumeStore } from '@/stores/resume'

/**
 * 纸面模块的选中态（框选 / 多选）。
 * 纯界面状态：不进简历数据、不持久化、不参与撤销历史。
 */
export const useSelectionStore = defineStore('selection', () => {
  const resumeStore = useResumeStore()

  /** 有序去重的选中模块 id，顺序即框选命中的先后 */
  const ids = ref([])

  const count = computed(() => ids.value.length)
  const set = computed(() => new Set(ids.value))

  function has(id) {
    return set.value.has(id)
  }

  /** 整体替换选中集，保持传入顺序并去重 */
  function replace(nextIds) {
    ids.value = [...new Set(nextIds)]
  }

  function toggle(id) {
    ids.value = has(id) ? ids.value.filter((item) => item !== id) : [...ids.value, id]
  }

  function clear() {
    ids.value = []
  }

  // 模块被删除或撤销回滚后，选中集里可能残留已不存在的 id，及时剪掉
  watch(
    () => resumeStore.sections.map((s) => s.id),
    (currentIds) => {
      if (!ids.value.length) return
      const alive = new Set(currentIds)
      const next = ids.value.filter((id) => alive.has(id))
      if (next.length !== ids.value.length) ids.value = next
    },
  )

  return { ids, count, has, replace, toggle, clear }
})
