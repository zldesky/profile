<script setup>
/**
 * 单段经历编辑：时间、单位、职位、机构图标、补充字段与要点。
 * 由 EntriesSectionEditor 按段渲染，自身只负责一段。
 */
import { shallowRef, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { readImageAsDataUrl } from '@/utils/helpers'

const props = defineProps({
  section: { type: Object, required: true },
  entry: { type: Object, required: true },
  index: { type: Number, required: true },
  total: { type: Number, required: true },
})

const store = useResumeStore()
const { toast } = useToast()

const logoInput = useTemplateRef('logoInput')
const uploadingLogo = shallowRef(false)

const updateEntry = (patch) => store.updateEntry(props.section.id, props.entry.id, patch)
const updateMeta = (metaId, patch) =>
  store.updateEntryMeta(props.section.id, props.entry.id, metaId, patch)

function pickLogo() {
  logoInput.value.value = ''
  logoInput.value.click()
}

async function onLogoChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件')
    return
  }

  uploadingLogo.value = true
  try {
    // 图标尺寸小，压到 160px 并用 PNG 保留透明背景
    updateEntry({ logo: await readImageAsDataUrl(file, 160, 'png') })
    toast('机构图标已更新')
  } catch (error) {
    toast(`图片处理失败：${error.message}`)
  } finally {
    uploadingLogo.value = false
  }
}
</script>

<template>
  <div class="entry-editor ed-sub">
    <div class="ed-sub-head">
      <span class="ed-sub-label">第 {{ index + 1 }} 段</span>
      <button
        class="ed-icon-btn"
        title="上移"
        :disabled="index === 0"
        @click="store.moveEntry(section.id, index, index - 1)"
      >
        <SvgIcon name="up" :size="14" />
      </button>
      <button
        class="ed-icon-btn"
        title="下移"
        :disabled="index === total - 1"
        @click="store.moveEntry(section.id, index, index + 1)"
      >
        <SvgIcon name="down" :size="14" />
      </button>
      <button
        class="ed-icon-btn danger"
        title="删除该段"
        @click="store.removeEntry(section.id, entry.id)"
      >
        <SvgIcon name="trash" :size="14" />
      </button>
    </div>

    <label class="ed-row">
      <span class="ed-label">时间</span>
      <input
        class="ed-input"
        :value="entry.time"
        placeholder="2022-06 - 至今"
        @input="updateEntry({ time: $event.target.value })"
      />
    </label>

    <label class="ed-row">
      <span class="ed-label">单位</span>
      <input
        class="ed-input"
        :value="entry.org"
        placeholder="公司 / 学校 / 项目名"
        @input="updateEntry({ org: $event.target.value })"
      />
    </label>

    <label class="ed-row">
      <span class="ed-label">职位</span>
      <input
        class="ed-input"
        :value="entry.role"
        placeholder="岗位 / 专业 / 担任角色"
        @input="updateEntry({ role: $event.target.value })"
      />
    </label>

    <div v-if="section.showLogo" class="ed-row">
      <span class="ed-label">机构图标</span>
      <button
        class="ed-logo-picker"
        type="button"
        :title="entry.logo ? '更换校徽或公司 logo' : '上传校徽或公司 logo'"
        @click="pickLogo"
      >
        <img v-if="entry.logo" :src="entry.logo" alt="机构图标" />
        <SvgIcon v-else name="image" :size="14" />
      </button>
      <button v-if="entry.logo" class="ed-btn" @click="updateEntry({ logo: '' })">
        <SvgIcon name="close" :size="13" />
        <span>移除</span>
      </button>
      <span v-else class="ed-hint ed-hint-inline">建议使用透明背景的 PNG</span>
    </div>

    <div v-for="meta in entry.meta" :key="meta.id" class="ed-row">
      <input
        class="ed-input ed-meta-label"
        :value="meta.label"
        placeholder="字段名"
        @input="updateMeta(meta.id, { label: $event.target.value })"
      />
      <input
        class="ed-input"
        :value="meta.value"
        placeholder="字段内容"
        @input="updateMeta(meta.id, { value: $event.target.value })"
      />
      <button
        class="ed-icon-btn danger"
        title="删除该字段"
        @click="store.removeEntryMeta(section.id, entry.id, meta.id)"
      >
        <SvgIcon name="trash" :size="14" />
      </button>
    </div>

    <button class="ed-btn ed-btn-block" @click="store.addEntryMeta(section.id, entry.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加补充字段</span>
    </button>

    <div class="ed-sub-title">要点描述</div>

    <div v-for="bullet in entry.bullets" :key="bullet.id" class="ed-bullet-row">
      <textarea
        class="ed-textarea"
        :value="bullet.text"
        placeholder="一条要点，建议用「做了什么 + 结果数据」的写法"
        @input="store.updateBullet(section.id, entry.id, bullet.id, $event.target.value)"
      ></textarea>
      <button
        class="ed-icon-btn danger"
        title="删除该要点"
        @click="store.removeBullet(section.id, entry.id, bullet.id)"
      >
        <SvgIcon name="trash" :size="14" />
      </button>
    </div>

    <button class="ed-btn ed-btn-block" @click="store.addBullet(section.id, entry.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加要点</span>
    </button>

    <input
      ref="logoInput"
      type="file"
      accept="image/png,image/jpeg,image/svg+xml,image/webp,image/*"
      hidden
      @change="onLogoChange"
    />
  </div>
</template>
