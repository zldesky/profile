<script setup>
/**
 * 头像：上传、尺寸（默认 1 寸证件照）、形状与位置微调。
 *
 * 位置边界由预览区测量后写入 store，拖拽与滑杆共用同一套限制，
 * 因此滑杆的取值区间会随模板与头像尺寸自动收窄。
 */
import { computed, shallowRef, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useToast } from '@/composables/useToast'
import { AVATAR_SHAPES, AVATAR_SIZE_PRESETS, AVATAR_SIZE_RANGE } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'
import { readImageAsDataUrl } from '@/utils/helpers'

const store = useResumeStore()
const { toast } = useToast()

const fileInput = useTemplateRef('fileInput')
const uploading = shallowRef(false)

const isPresetActive = (preset) =>
  store.basics.avatarWidth === preset.width && store.basics.avatarHeight === preset.height

/** 头像相对模板默认位置的偏移，取整后展示 */
const avatarDx = computed(() => Math.round(Number(store.basics.avatarPos?.dx) || 0))
const avatarDy = computed(() => Math.round(Number(store.basics.avatarPos?.dy) || 0))

const toRange = (a, b) => ({ min: Math.floor(Math.min(a, b)), max: Math.ceil(Math.max(a, b)) })
const dxRange = computed(() => toRange(store.avatarLimits.minDx, store.avatarLimits.maxDx))
const dyRange = computed(() => toRange(store.avatarLimits.minDy, store.avatarLimits.maxDy))

function pickAvatar() {
  fileInput.value.value = ''
  fileInput.value.click()
}

async function onAvatarChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件')
    return
  }

  uploading.value = true
  try {
    const dataUrl = await readImageAsDataUrl(file)
    store.setBasics({ avatar: dataUrl, showAvatar: true })
    toast('头像已更新')
  } catch (error) {
    toast(`头像处理失败：${error.message}`)
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="ed-group">
    <div class="ed-group-title"><span>头像</span></div>

    <div class="avatar-row">
      <button class="avatar-preview" type="button" title="点击上传头像" @click="pickAvatar">
        <img v-if="store.basics.avatar" :src="store.basics.avatar" alt="头像" />
        <SvgIcon v-else name="user" :size="22" />
      </button>
      <div class="avatar-actions">
        <button class="ed-btn ed-btn-block" :disabled="uploading" @click="pickAvatar">
          <SvgIcon name="image" :size="14" />
          <span>{{ uploading ? '处理中…' : store.basics.avatar ? '更换头像' : '上传头像' }}</span>
        </button>
        <button
          v-if="store.basics.avatar"
          class="ed-btn ed-btn-block"
          @click="store.setBasics({ avatar: '' })"
        >
          <SvgIcon name="close" :size="14" />
          <span>移除头像</span>
        </button>
      </div>
    </div>

    <label class="ed-row">
      <span class="ed-label">显示头像</span>
      <input
        class="ed-check"
        type="checkbox"
        :checked="store.basics.showAvatar"
        @change="store.setBasics({ showAvatar: $event.target.checked })"
      />
    </label>

    <div class="seg-caption">尺寸</div>
    <div class="ed-seg">
      <button
        v-for="preset in AVATAR_SIZE_PRESETS"
        :key="preset.label"
        :class="{ 'is-active': isPresetActive(preset) }"
        @click="store.setBasics({ avatarWidth: preset.width, avatarHeight: preset.height })"
      >
        {{ preset.label }}
      </button>
    </div>

    <label class="ed-row">
      <span class="ed-label">宽</span>
      <input
        class="ed-range"
        type="range"
        :min="AVATAR_SIZE_RANGE.width.min"
        :max="AVATAR_SIZE_RANGE.width.max"
        step="1"
        :value="store.basics.avatarWidth"
        @input="store.setBasics({ avatarWidth: Number($event.target.value) })"
      />
      <span class="ed-value">{{ store.basics.avatarWidth }}mm</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">高</span>
      <input
        class="ed-range"
        type="range"
        :min="AVATAR_SIZE_RANGE.height.min"
        :max="AVATAR_SIZE_RANGE.height.max"
        step="1"
        :value="store.basics.avatarHeight"
        @input="store.setBasics({ avatarHeight: Number($event.target.value) })"
      />
      <span class="ed-value">{{ store.basics.avatarHeight }}mm</span>
    </label>

    <div class="seg-caption">形状</div>
    <div class="ed-seg">
      <button
        v-for="shape in AVATAR_SHAPES"
        :key="shape.value"
        :class="{ 'is-active': store.basics.avatarShape === shape.value }"
        @click="store.setBasics({ avatarShape: shape.value })"
      >
        {{ shape.label }}
      </button>
    </div>

    <div class="seg-caption">位置</div>
    <label class="ed-row">
      <span class="ed-label">水平</span>
      <input
        class="ed-range"
        type="range"
        :min="dxRange.min"
        :max="dxRange.max"
        step="1"
        :value="avatarDx"
        @input="store.setAvatarPos({ dx: Number($event.target.value) })"
      />
      <span class="ed-value">{{ avatarDx }}mm</span>
    </label>

    <label class="ed-row">
      <span class="ed-label">垂直</span>
      <input
        class="ed-range"
        type="range"
        :min="dyRange.min"
        :max="dyRange.max"
        step="1"
        :value="avatarDy"
        @input="store.setAvatarPos({ dy: Number($event.target.value) })"
      />
      <span class="ed-value">{{ avatarDy }}mm</span>
    </label>

    <button
      class="ed-btn ed-btn-block"
      :disabled="!avatarDx && !avatarDy"
      @click="store.setAvatarPos({ dx: 0, dy: 0 })"
    >
      <SvgIcon name="refresh" :size="14" />
      <span>头像复位</span>
    </button>

    <p class="ed-hint">
      可拖拽范围：水平 {{ dxRange.min }} ~ {{ dxRange.max }}mm，垂直 {{ dyRange.min }} ~
      {{
        dyRange.max
      }}mm。水平边界取自头像所在容器；向下最多让出一个头像的高度，页头会等量撑高，因此头像不会压住正文。
    </p>
    <p class="ed-hint">也可以直接在预览区按住头像拖动：拖到左侧时姓名与职位会自动让出左侧空间。</p>
    <p class="ed-hint">
      默认 1 寸 25×35mm，是国内证件照通行规格；2 寸为
      35×49mm。圆形要求宽高相等，否则会被拉成椭圆，可先用「正方形」预设。
    </p>
    <p class="ed-hint">头像会自动压缩至长边 420px 并转为 JPEG，用于控制简历数据体积。</p>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="onAvatarChange" />
  </div>
</template>

<style scoped>
.avatar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.avatar-preview {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  overflow: hidden;
  padding: 0;
  border: 1px dashed #d8dce4;
  border-radius: 10px;
  background: #fafbfc;
  color: #b6bcc6;
  cursor: pointer;
}

.avatar-preview:hover {
  border-color: #2b579a;
  color: #2b579a;
}

.avatar-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-actions {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
</style>
