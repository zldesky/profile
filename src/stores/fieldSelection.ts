import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 「字段级微调」的选中态。
 *
 * 与模块选中（useSelectionStore）分开：模块选中用于框选 / 批量显隐 / 整组拖动；
 * 字段选中用于「点一个字段，按 WASD 单独调它的间距」。两者可以同时存在，
 * 但语义不同，混在一个 ref 里会让两套交互互相干扰。
 *
 * 纯界面状态：不持久化、不进撤销历史。字段间距本身存在简历数据里（section.fieldLayouts），
 * 这里只记「现在正在调哪个字段」。
 */
export const useFieldSelectionStore = defineStore('fieldSelection', () => {
  /** 当前正在微调的字段所属模块 id */
  const sectionId = ref<string>('')
  /** 字段身份串（见 utils/fieldLayout.ts 的 fieldLayoutKey） */
  const fieldKey = ref<string>('')
  /** 字段种类，用于按种类取可调范围（如 bulletText / entryTime） */
  const field = ref<string>('')
  /** 字段的显示名，浮条提示用 */
  const label = ref<string>('')

  const active = computed(() => Boolean(sectionId.value && fieldKey.value))

  function select(next: {
    sectionId: string
    fieldKey: string
    field: string
    label: string
  }): void {
    sectionId.value = next.sectionId
    fieldKey.value = next.fieldKey
    field.value = next.field
    label.value = next.label
  }

  function clear(): void {
    sectionId.value = ''
    fieldKey.value = ''
    field.value = ''
    label.value = ''
  }

  return { sectionId, fieldKey, field, label, active, select, clear }
})
