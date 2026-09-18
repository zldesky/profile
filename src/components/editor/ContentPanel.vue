<script setup>
/**
 * 内容页签：基本信息 + 模块列表。
 * 用单一根容器包裹，使父级可以用 v-show 切换而不依赖 fragment。
 */
import BasicsEditor from '@/components/editor/BasicsEditor.vue'
import SectionList from '@/components/editor/SectionList.vue'
</script>

<template>
  <div class="panel-content">
    <BasicsEditor />
    <SectionList />
  </div>
</template>
