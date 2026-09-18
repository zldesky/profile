<script setup>
/**
 * 条目列表编辑：教育背景、工作经历、项目经历、校园经历等。
 * 每段经历交给 ExperienceEntryEditor，本组件只负责模块级开关与列表编排。
 */
import SvgIcon from '@/components/SvgIcon.vue'
import ExperienceEntryEditor from '@/components/editor/sections/ExperienceEntryEditor.vue'
import { useResumeStore } from '@/stores/resume'

const props = defineProps({
  section: { type: Object, required: true },
})

const store = useResumeStore()
</script>

<template>
  <div class="entries-editor">
    <label class="ed-toggle">
      <input
        class="ed-check"
        type="checkbox"
        :checked="section.showLogo"
        @change="store.updateSection(section.id, { showLogo: $event.target.checked })"
      />
      <span>显示机构图标（校徽 / 公司 logo）</span>
    </label>
    <p v-if="section.showLogo" class="ed-hint">
      通常只建议国内顶尖院校或知名企业使用；普通院校贴校徽容易减分。未上传图片时会用机构名首字占位。
    </p>

    <div v-if="!section.items.length" class="ed-empty">暂无经历条目</div>

    <ExperienceEntryEditor
      v-for="(entry, index) in section.items"
      :key="entry.id"
      :section="section"
      :entry="entry"
      :index="index"
      :total="section.items.length"
    />

    <button class="ed-btn ed-btn-block ed-btn-primary" @click="store.addEntry(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加一段经历</span>
    </button>
  </div>
</template>
