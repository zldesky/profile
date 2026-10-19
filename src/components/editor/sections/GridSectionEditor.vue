<script setup lang="ts">
/**
 * 键值网格内容编辑：求职意向、荣誉奖项、证书、作品集等。
 */
import BaseSelect from '@/components/BaseSelect.vue'
import DragHandle from '@/components/editor/DragHandle.vue'
import DraggableList from '@/components/editor/DraggableList.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { ICON_OPTIONS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'
import type { GridSection } from '@/types/resume'

const props = defineProps<{ section: GridSection }>()

const store = useResumeStore()

const updateItem = (itemId: string, patch: Record<string, unknown>): void =>
  store.updateGridItem(props.section.id, itemId, patch)

/**
 * 拖拽用的可写视图（按 id 顺序重排）。
 *
 * 不能直接 `v-model` 到 section 的数组：section 是 prop，往它的属性上赋值
 * 会被 Vue 拦下 —— 拖完 SortableJS 改过 DOM、但数据没变，Vue 重渲染时顺序会**回弹**。
 * 改走 store 的 reorder 动作（按 id 整体重排，与 reorderSectionsByIds 同一套校验），
 * 于是撤销 / 落盘 / 纸面重排全部自动跟上。
 */
/** 拖完把新顺序交给 store 的按 id 重排 */
function onReorder(ids: string[]): void {
  store.reorderGridItemsByIds(props.section.id, ids)
}
</script>

<template>
  <div class="grid-editor">
    <div v-if="!section.items.length" class="ed-empty">暂无条目</div>

    <DraggableList :items="section.items" class="ed-sub-list" @reorder="onReorder">
      <div v-for="(item, index) in section.items" :key="item.id" class="ed-sub">
        <div class="ed-row">
          <DragHandle :index="index" :total="section.items.length" :item-id="item.id" />
          <BaseSelect
            class="ed-icon-select"
            dense
            :model-value="item.icon"
            :options="ICON_OPTIONS"
            @update:model-value="updateItem(item.id, { icon: String($event ?? '') })"
          />
          <input
            class="ed-input"
            :value="item.label"
            placeholder="标签"
            @input="updateItem(item.id, { label: ($event.target as HTMLInputElement).value })"
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
          @input="updateItem(item.id, { value: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </DraggableList>

    <button class="ed-btn ed-btn-block" @click="store.addGridItem(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加一项</span>
    </button>
  </div>
</template>
