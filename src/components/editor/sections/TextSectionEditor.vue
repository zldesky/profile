<script setup>
/**
 * 段落文本编辑：自我评价、个人总结等。
 * 「AI 润色」整段改写：用户自带 Key，确认后才应用。
 */
import { shallowRef } from 'vue'

import AIPolishDialog from '@/components/AIPolishDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'

const props = defineProps({
  section: { type: Object, required: true },
})

const store = useResumeStore()
const { toast } = useToast()

const polishOpen = shallowRef(false)

function applyPolish(text) {
  store.updateSection(props.section.id, { content: text })
  toast('已应用润色结果，Ctrl+Z 可撤销')
}
</script>

<template>
  <div class="text-editor">
    <div class="text-head">
      <button
        class="ed-btn"
        title="让 AI 改写整段内容，应用前可再手动修改"
        @click="polishOpen = true"
      >
        <SvgIcon name="sparkles" :size="14" />
        <span>AI 润色</span>
      </button>
    </div>

    <textarea
      class="ed-textarea ed-para-input"
      :value="section.content"
      placeholder="填写段落内容"
      @input="store.updateSection(section.id, { content: $event.target.value })"
    ></textarea>
    <p class="ed-hint">支持换行，预览与打印会保留换行效果。</p>

    <AIPolishDialog
      :open="polishOpen"
      kind="summary"
      title="AI 润色段落"
      :text="section.content"
      @apply="applyPolish"
      @close="polishOpen = false"
    />
  </div>
</template>

<style scoped>
.text-head {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}
</style>
