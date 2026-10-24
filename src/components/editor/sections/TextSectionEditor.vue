<script setup lang="ts">
/**
 * 段落文本编辑：自我评价、个人总结等。
 * 「表达助手」对整段只提供措辞改写（整段不适用「动词开头」那套要点规则）。
 */
import { shallowRef } from 'vue'

import ExpressionAssistantDialog from '@/components/ExpressionAssistantDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import CharCountHint from '@/components/editor/sections/CharCountHint.vue'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import type { TextSection } from '@/types/resume'

const props = defineProps<{ section: TextSection }>()

const store = useResumeStore()
const { toast } = useToast()

const polishOpen = shallowRef(false)

function applyPolish(text: string): void {
  store.updateSection(props.section.id, { content: text })
  toast('已应用，Ctrl+Z 可撤销')
}
</script>

<template>
  <div class="text-editor">
    <div class="text-head">
      <button
        class="ed-btn"
        title="打开表达助手：整段措辞改写，应用前可再手动修改"
        @click="polishOpen = true"
      >
        <SvgIcon name="sparkles" :size="14" />
        <span>表达助手</span>
      </button>
    </div>

    <textarea
      class="ed-textarea ed-para-input"
      :value="section.content"
      placeholder="填写段落内容"
      @input="
        store.updateSection(section.id, { content: ($event.target as HTMLInputElement).value })
      "
    ></textarea>
    <!--
      段落的建议区间与要点不同：自我评价是「三四句话」，40–160 字比较合适。
      沿用要点的 8–80 会让正常篇幅的段落一直提示超过上限，久了就没人看这个提示。
    -->
    <CharCountHint :text="section.content" :min="40" :max="160" />
    <p class="ed-hint">支持换行，预览与打印会保留换行效果。</p>

    <ExpressionAssistantDialog
      :open="polishOpen"
      kind="summary"
      title="表达助手 · 段落"
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
