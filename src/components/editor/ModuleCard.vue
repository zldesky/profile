<script setup>
/**
 * 单个简历模块卡片：标题重命名、显隐、排序、复制、删除，展开后编辑内容。
 * 展开状态由父级持有，便于新增模块后自动展开。
 */
import SectionEditor from '@/components/editor/SectionEditor.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useResumeStore } from '@/stores/resume'
import { useSelectionStore } from '@/stores/selection'

const props = defineProps({
  section: { type: Object, required: true },
  index: { type: Number, required: true },
  total: { type: Number, required: true },
  open: { type: Boolean, default: false },
})

// 删除涉及确认与父级展开状态清理，统一交给 SectionList 处理
const emit = defineEmits(['toggle', 'remove'])

const store = useResumeStore()
// 纸面上选中模块时，对应卡片同步高亮，方便在两侧之间对照
const selection = useSelectionStore()

const toggleVisible = () =>
  store.updateSection(props.section.id, { visible: !props.section.visible })
</script>

<template>
  <div
    class="ed-card"
    :data-section-id="section.id"
    :class="{ 'is-hidden': !section.visible, 'is-sec-selected': selection.has(section.id) }"
  >
    <div class="ed-card-head">
      <span class="ed-drag" title="按住拖动可调整模块顺序">
        <SvgIcon name="drag" :size="15" />
      </span>

      <input
        class="ed-card-title"
        :value="section.title"
        title="点击可重命名模块"
        @input="store.updateSection(section.id, { title: $event.target.value })"
      />

      <button
        class="ed-icon-btn"
        :title="section.visible ? '在简历中隐藏' : '在简历中显示'"
        @click="toggleVisible"
      >
        <SvgIcon :name="section.visible ? 'eye' : 'eyeOff'" :size="14" />
      </button>

      <button
        class="ed-icon-btn expand"
        :class="{ 'is-open': open }"
        :title="open ? '收起编辑' : '展开编辑'"
        @click="emit('toggle')"
      >
        <SvgIcon name="down" :size="14" />
      </button>
    </div>

    <div v-if="open" class="ed-card-body">
      <div class="ed-actions">
        <button
          class="ed-icon-btn"
          title="上移"
          :disabled="index === 0"
          @click="store.moveSection(index, index - 1)"
        >
          <SvgIcon name="up" :size="14" />
        </button>
        <button
          class="ed-icon-btn"
          title="下移"
          :disabled="index === total - 1"
          @click="store.moveSection(index, index + 1)"
        >
          <SvgIcon name="down" :size="14" />
        </button>
        <button class="ed-icon-btn" title="复制该模块" @click="store.duplicateSection(section.id)">
          <SvgIcon name="copy" :size="14" />
        </button>
        <span class="ed-spacer"></span>
        <button class="ed-icon-btn danger" title="删除该模块" @click="emit('remove')">
          <SvgIcon name="trash" :size="14" />
        </button>
      </div>

      <SectionEditor :section="section" />
    </div>
  </div>
</template>

<style scoped>
/* 该模块正在纸面上被选中（可多选），与单卡片 hover 高亮区分 */
.ed-card.is-sec-selected {
  border-color: var(--ed-brand-border);
  box-shadow: 0 0 0 3px var(--ed-brand-ring);
}

.expand :deep(.svg-icon) {
  transition: transform 0.18s;
}

.expand.is-open :deep(.svg-icon) {
  transform: rotate(180deg);
}
</style>
