<script setup>
/**
 * 联系方式字段列表：图标、字段名与内容的增删改。
 */
import SvgIcon from '@/components/SvgIcon.vue'
import { ICON_OPTIONS } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

const updateField = (fieldId, patch) => store.updateBasicsField(fieldId, patch)
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title">
      <span>联系方式</span>
      <button class="ed-icon-btn" title="添加字段" @click="store.addBasicsField()">
        <SvgIcon name="plus" :size="15" />
      </button>
    </div>

    <div v-if="!store.basics.fields.length" class="ed-empty">暂无联系方式字段</div>

    <div v-for="field in store.basics.fields" :key="field.id" class="field-item">
      <div class="ed-row">
        <select
          class="ed-select ed-icon-select"
          :value="field.icon"
          @change="updateField(field.id, { icon: $event.target.value })"
        >
          <option v-for="option in ICON_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <input
          class="ed-input field-label"
          :value="field.label"
          placeholder="字段名"
          @input="updateField(field.id, { label: $event.target.value })"
        />
        <button
          class="ed-icon-btn danger"
          title="删除字段"
          @click="store.removeBasicsField(field.id)"
        >
          <SvgIcon name="trash" :size="14" />
        </button>
      </div>
      <input
        class="ed-input"
        :value="field.value"
        placeholder="字段内容"
        @input="updateField(field.id, { value: $event.target.value })"
      />
    </div>

    <p class="ed-hint">
      建议只保留姓名、电话、邮箱与意向城市。年龄、性别、籍贯这类信息对求职帮助有限，可按目标岗位的投递习惯保留或删除。
    </p>
    <p class="ed-hint">部分模板会把「基本信息的字段」与「求职意向模块」放入窄栏，无需重复填写。</p>
  </div>
</template>

<style scoped>
.field-item {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #eef0f4;
}

.field-item:last-of-type {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: 0;
}

.field-label {
  flex: 1 1 auto;
}
</style>
