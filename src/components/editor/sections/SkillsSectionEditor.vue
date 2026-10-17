<script setup lang="ts">
/**
 * 技能特长编辑：文字描述字段 + 可选的熟练度进度条。
 */
import SvgIcon from '@/components/SvgIcon.vue'
import { useResumeStore } from '@/stores/resume'
import type { SkillsSection } from '@/types/resume'

const props = defineProps<{ section: SkillsSection }>()

const store = useResumeStore()

const updateField = (fieldId: string, patch: Record<string, unknown>): void =>
  store.updateSkillField(props.section.id, fieldId, patch)
const updateSkill = (skillId: string, patch: Record<string, unknown>): void =>
  store.updateSkill(props.section.id, skillId, patch)
</script>

<template>
  <div class="skills-editor">
    <div class="ed-sub-title">文字描述</div>

    <div v-for="field in section.fields" :key="field.id" class="ed-sub">
      <div class="ed-row">
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

    <button class="ed-btn ed-btn-block" @click="store.addSkillField(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加描述字段</span>
    </button>

    <div class="ed-sub-title">
      <span>熟练度</span>
      <label class="ed-toggle">
        <input
          class="ed-check"
          type="checkbox"
          :checked="section.showBars"
          @change="
            store.updateSection(section.id, {
              showBars: ($event.target as HTMLInputElement).checked,
            })
          "
        />
        <span>显示进度条</span>
      </label>
    </div>

    <p v-if="!section.showBars" class="ed-hint">
      进度条默认关闭，简历中只输出上方的文字描述。下方百分比会保留，随时可以重新开启。
    </p>

    <div v-for="skill in section.items" :key="skill.id" class="ed-sub">
      <div class="ed-row">
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
      <div class="ed-row">
        <input
          class="ed-range"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="skill.level"
          @input="
            updateSkill(skill.id, { level: Number(($event.target as HTMLInputElement).value) })
          "
        />
        <span class="ed-value">{{ skill.level }}%</span>
      </div>
    </div>

    <button class="ed-btn ed-btn-block" @click="store.addSkill(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加技能</span>
    </button>

    <p class="ed-hint">投递大厂网申系统时可不填熟练度，纯文字更利于解析。</p>
  </div>
</template>
