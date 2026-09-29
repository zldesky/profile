<script setup>
/**
 * 段落文本编辑：自我评价、个人总结等。
 */
import { useResumeStore } from '@/stores/resume'

defineProps({
  section: { type: Object, required: true },
})

const store = useResumeStore()
</script>

<template>
  <div class="text-editor">
    <textarea
      class="ed-textarea ed-para-input"
      :value="section.content"
      placeholder="填写段落内容"
      @input="store.updateSection(section.id, { content: $event.target.value })"
    ></textarea>
    <p class="ed-hint">支持换行，预览与打印会保留换行效果。</p>
  </div>
</template>
