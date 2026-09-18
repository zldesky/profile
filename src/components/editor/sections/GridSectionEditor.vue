<script setup>
/**
 * 键值网格内容编辑：求职意向、荣誉奖项、证书、作品集等。
 */
import SvgIcon from '@/components/SvgIcon.vue'
import { ICON_OPTIONS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const props = defineProps({
  section: { type: Object, required: true },
})

const store = useResumeStore()

const updateItem = (itemId, patch) => store.updateGridItem(props.section.id, itemId, patch)
</script>

<template>
  <div class="grid-editor">
    <div v-if="!section.items.length" class="ed-empty">暂无条目</div>

    <div v-for="item in section.items" :key="item.id" class="ed-sub">
      <div class="ed-row">
        <select
          class="ed-select ed-icon-select"
          :value="item.icon"
          @change="updateItem(item.id, { icon: $event.target.value })"
        >
          <option v-for="option in ICON_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <input
          class="ed-input"
          :value="item.label"
          placeholder="标签"
          @input="updateItem(item.id, { label: $event.target.value })"
        />
        <button
          class="ed-icon-btn danger"
          title="删除该项"
          @click="store.removeGridItem(section.id, item.id)"
        >
          <SvgIcon name="trash" :size="14" />
        </button>
      </div>
      <input
        class="ed-input"
        :value="item.value"
        placeholder="内容"
        @input="updateItem(item.id, { value: $event.target.value })"
      />
    </div>

    <button class="ed-btn ed-btn-block" @click="store.addGridItem(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加一项</span>
    </button>
  </div>
</template>
