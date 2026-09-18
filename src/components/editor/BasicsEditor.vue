<script setup>
/**
 * 基本信息：姓名、求职职位，以及头像与联系方式两个子分区。
 */
import AvatarEditor from '@/components/editor/basics/AvatarEditor.vue'
import ContactFieldsEditor from '@/components/editor/basics/ContactFieldsEditor.vue'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()
</script>

<template>
  <div class="basics-editor">
    <div class="ed-group">
      <div class="ed-group-title"><span>基本信息</span></div>

      <label class="ed-row">
        <span class="ed-label">姓名</span>
        <input v-model="store.basics.name" class="ed-input" placeholder="请输入姓名" />
      </label>

      <label class="ed-row">
        <span class="ed-label">求职职位</span>
        <input v-model="store.basics.jobTitle" class="ed-input" placeholder="如：前端开发工程师" />
      </label>
    </div>

    <AvatarEditor />
    <ContactFieldsEditor />
  </div>
</template>
