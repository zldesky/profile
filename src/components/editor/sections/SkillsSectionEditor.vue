<script setup lang="ts">
/**
 * 技能特长编辑：文字描述字段 + 技能名列表（可拖拽排序）。
 *
 * 这里原先还有「熟练度」——一个 0-100 的滑块，配合纸面的进度条与导出里的百分比。
 * 已整套移除（界面 / 纸面 / 导出 / 就地编辑）：简历里给技能打百分比
 * 既不精确也不加分，纯文字列表更利于网申系统解析。
 * 数据里的 level 字段保留未删，旧简历与旧备份照常能加载，只是不再被使用。
 */
import SvgIcon from '@/components/SvgIcon.vue'
import DragHandle from '@/components/editor/DragHandle.vue'
import DraggableList from '@/components/editor/DraggableList.vue'
import { useResumeStore } from '@/stores/resume'
import type { SkillsSection } from '@/types/resume'

const props = defineProps<{ section: SkillsSection }>()

const store = useResumeStore()

const updateField = (fieldId: string, patch: Record<string, unknown>): void =>
  store.updateSkillField(props.section.id, fieldId, patch)
const updateSkill = (skillId: string, patch: Record<string, unknown>): void =>
  store.updateSkill(props.section.id, skillId, patch)

/**
 * 拖拽用的可写视图（按 id 顺序重排）。
 *
 * 不能直接 `v-model` 到 section 的数组：section 是 prop，往它的属性上赋值
 * 会被 Vue 拦下 —— 拖完 SortableJS 改过 DOM、但数据没变，Vue 重渲染时顺序会**回弹**。
 * 改走 store 的 reorder 动作（按 id 整体重排，与 reorderSectionsByIds 同一套校验），
 * 于是撤销 / 落盘 / 纸面重排全部自动跟上。
 */
/** 拖完把新顺序交给 store 的按 id 重排 */
function reorderFields(ids: string[]): void {
  store.reorderSkillFieldsByIds(props.section.id, ids)
}
function reorderSkills(ids: string[]): void {
  store.reorderSkillsByIds(props.section.id, ids)
}
</script>

<template>
  <div class="skills-editor">
    <div class="ed-sub-title">文字描述</div>

    <DraggableList :items="section.fields" class="ed-sub-list" @reorder="reorderFields">
      <div v-for="(field, index) in section.fields" :key="field.id" class="ed-sub">
        <div class="ed-row">
          <DragHandle :index="index" :total="section.fields.length" :item-id="field.id" />
          <input
            class="ed-input ed-meta-label"
            :value="field.label"
            placeholder="标签"
            @input="updateField(field.id, { label: ($event.target as HTMLInputElement).value })"
          />
          <button
            class="ed-icon-btn danger"
            title="删除该字段"
            @click="store.removeSkillField(section.id, field.id)"
          >
            <SvgIcon name="trash" :size="14" />
          </button>
        </div>
        <textarea
          class="ed-textarea"
          :value="field.value"
          placeholder="描述内容"
          @input="updateField(field.id, { value: ($event.target as HTMLInputElement).value })"
        ></textarea>
      </div>
    </DraggableList>

    <button class="ed-btn ed-btn-block" @click="store.addSkillField(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加描述字段</span>
    </button>

    <DraggableList :items="section.items" class="ed-sub-list" @reorder="reorderSkills">
      <div v-for="(skill, index) in section.items" :key="skill.id" class="ed-sub">
        <div class="ed-row">
          <DragHandle :index="index" :total="section.items.length" :item-id="skill.id" />
          <input
            class="ed-input"
            :value="skill.name"
            placeholder="技能名称"
            @input="updateSkill(skill.id, { name: ($event.target as HTMLInputElement).value })"
          />
          <button
            class="ed-icon-btn danger"
            title="删除该技能"
            @click="store.removeSkill(section.id, skill.id)"
          >
            <SvgIcon name="trash" :size="14" />
          </button>
        </div>
      </div>
    </DraggableList>

    <button class="ed-btn ed-btn-block" @click="store.addSkill(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加技能</span>
    </button>

    <p class="ed-hint">建议只列技能名，按熟练程度从高到低排列，拖动左侧手柄可调整顺序。</p>
  </div>
</template>
