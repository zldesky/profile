<script setup>
/**
 * 头像裁剪弹窗。
 * 上传照片的比例与选定的头像尺寸不一致时弹出：拖动选取保留区域、滑杆缩放，
 * 确认后按当前头像比例裁出长边 420px 的 JPEG 入库（与其他头像路径体积一致）。
 * 几何计算（cover 缩放、平移收敛、取样矩形）在 utils/imageCrop.js，纯函数可直测。
 */
import { computed, reactive, shallowRef, watch } from 'vue'

import { readImageSize } from '@/utils/helpers'
import { clampPan, computeSourceRect, coverScale } from '@/utils/imageCrop'

const props = defineProps({
  open: { type: Boolean, default: false },
  src: { type: String, default: '' },
  /** 头像框尺寸（毫米），只用于约束比例与展示文案 */
  frameWidth: { type: Number, required: true },
  frameHeight: { type: Number, required: true },
})
const emit = defineEmits(['confirm', 'cancel'])

/** 裁剪框的最长边显示像素 */
const FRAME_LONG = 260
/** 裁剪输出的最长边像素，与头像其他入库路径保持一致 */
const FRAME_LONG_OUT = 420
/** 缩放上限是初始 cover 缩放的倍数 */
const ZOOM_MAX = 3

const display = computed(() => {
  const ratio = props.frameWidth / props.frameHeight
  return props.frameWidth >= props.frameHeight
    ? { w: FRAME_LONG, h: Math.round(FRAME_LONG / ratio) }
    : { w: Math.round(FRAME_LONG * ratio), h: FRAME_LONG }
})

const imgSize = shallowRef(null)
const scale = shallowRef(1)
const minScale = shallowRef(1)
const offset = reactive({ dx: 0, dy: 0 })
const dragging = shallowRef(false)

const zoomStep = computed(() => (minScale.value * (ZOOM_MAX - 1)) / 100)
const zoomMax = computed(() => minScale.value * ZOOM_MAX)

const imgStyle = computed(() => {
  if (!imgSize.value) return null
  return {
    width: `${imgSize.value.width * scale.value}px`,
    transform: `translate(${offset.dx}px, ${offset.dy}px)`,
  }
})

watch(
  () => [props.open, props.src],
  async ([open]) => {
    if (!open || !props.src) return
    imgSize.value = await readImageSize(props.src)
    minScale.value = coverScale(
      imgSize.value.width,
      imgSize.value.height,
      display.value.w,
      display.value.h,
    )
    applyScale(minScale.value)
    recentre()
  },
)

/** 回到居中位置 */
function recentre() {
  offset.dx = (display.value.w - imgSize.value.width * scale.value) / 2
  offset.dy = (display.value.h - imgSize.value.height * scale.value) / 2
}

/** 缩放时保持框中心对应的源点不动，再收敛平移边界 */
function applyScale(next) {
  if (!imgSize.value) return
  const sourceX = (display.value.w / 2 - offset.dx) / scale.value
  const sourceY = (display.value.h / 2 - offset.dy) / scale.value
  scale.value = Math.max(minScale.value, Math.min(zoomMax.value, next))
  const clamped = clampPan(
    display.value.w / 2 - sourceX * scale.value,
    display.value.h / 2 - sourceY * scale.value,
    imgSize.value.width,
    imgSize.value.height,
    scale.value,
    display.value.w,
    display.value.h,
  )
  offset.dx = clamped.dx
  offset.dy = clamped.dy
}

let lastX = 0
let lastY = 0
function onPointerDown(event) {
  dragging.value = true
  lastX = event.clientX
  lastY = event.clientY
  event.currentTarget.setPointerCapture(event.pointerId)
}

function onPointerMove(event) {
  if (!dragging.value) return
  const clamped = clampPan(
    offset.dx + event.clientX - lastX,
    offset.dy + event.clientY - lastY,
    imgSize.value.width,
    imgSize.value.height,
    scale.value,
    display.value.w,
    display.value.h,
  )
  offset.dx = clamped.dx
  offset.dy = clamped.dy
  lastX = event.clientX
  lastY = event.clientY
}

function onPointerUp() {
  dragging.value = false
}

async function confirmCrop() {
  if (!imgSize.value) return
  try {
    const rect = computeSourceRect(
      imgSize.value.width,
      imgSize.value.height,
      scale.value,
      offset.dx,
      offset.dy,
      display.value.w,
      display.value.h,
    )
    // 输出长边 420px，与头像其他入库路径体积一致
    const outW =
      display.value.w >= display.value.h
        ? FRAME_LONG_OUT
        : Math.round((FRAME_LONG_OUT * display.value.w) / display.value.h)
    const outH =
      display.value.w >= display.value.h
        ? Math.round((FRAME_LONG_OUT * display.value.h) / display.value.w)
        : FRAME_LONG_OUT
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    // 头像入库统一转 JPEG，先铺白底避免透明区域发黑
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('图片无法解析'))
      img.src = props.src
    })
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH)
    emit('confirm', canvas.toDataURL('image/jpeg', 0.9))
  } catch (error) {
    emit('cancel')
    throw error
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cr-mask" @click.self="emit('cancel')">
      <div class="cr-card" role="dialog" aria-modal="true" aria-label="裁剪头像">
        <h3 class="cr-title">裁剪头像</h3>

        <div
          class="cr-frame"
          :class="{ 'is-dragging': dragging }"
          :style="{ width: `${display.w}px`, height: `${display.h}px` }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <img v-if="imgStyle" :src="src" :style="imgStyle" alt="" draggable="false" />
        </div>

        <label class="cr-zoom">
          <span class="cr-zoom-label">缩放</span>
          <input
            class="ed-range"
            type="range"
            :min="minScale"
            :max="zoomMax"
            :step="zoomStep"
            :value="scale"
            @input="applyScale(Number($event.target.value))"
          />
        </label>

        <p class="cr-hint">
          拖动照片选取保留区域，确认后按当前头像比例（{{ frameWidth }}×{{ frameHeight }}mm）裁剪。
        </p>

        <div class="cr-actions">
          <button class="ed-btn" @click="emit('cancel')">取消</button>
          <button class="ed-btn ed-btn-primary" :disabled="!imgSize" @click="confirmCrop">
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cr-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.34);
}

.cr-card {
  width: 100%;
  max-width: 340px;
  padding: 18px 18px 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
}

.cr-title {
  margin: 0 0 12px;
  color: #1f2329;
  font-size: 14.5px;
  font-weight: 600;
}

.cr-frame {
  position: relative;
  overflow: hidden;
  margin: 0 auto;
  border-radius: 6px;
  background: #eceff4;
  /* 触屏拖动时不触发页面滚动 */
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.cr-frame.is-dragging {
  cursor: grabbing;
}

.cr-frame img {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  transform-origin: 0 0;
}

.cr-zoom {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.cr-zoom-label {
  flex: 0 0 auto;
  color: #5b6472;
  font-size: 12px;
}

.cr-hint {
  margin: 10px 0 14px;
  color: #8b93a1;
  font-size: 12px;
  line-height: 1.55;
}

.cr-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
