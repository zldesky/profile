<script setup>
/**
 * 滑块拼图验证码。
 *
 * 服务端生成带缺口的场景图与拼图块（见 server/captcha.js），缺口横向坐标
 * 只在服务端——组件只负责拖动与提交：把滑块位移换算成视图盒坐标发给
 * /api/captcha/verify，通过后把一次性令牌经 v-model 交给表单。
 * Pointer Events 统一鼠标与触摸拖拽；图形按视图盒等比缩放，
 * 容器宽度变化时坐标换算依旧成立。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'failed'])

/** 与服务端约定的视图盒尺寸与拼图块尺寸（见 server/captcha.js） */
const VIEW_WIDTH = 320
/** 拼图块：46 见方 + 上方 8px 凸起，块图宽高比 46:54 */
const PIECE_SIZE = 46
const KNOB_RADIUS = 8
/** 拼图块在视图盒坐标里可移动的最大横向距离 */
const MAX_X = VIEW_WIDTH - PIECE_SIZE
/** 校验失败后红色提示的停留时长，让人看清再换下一张图 */
const FAIL_PAUSE_MS = 900

const stageEl = ref(null)
const challenge = shallowRef(null)
const state = shallowRef('loading') // loading | idle | dragging | verifying | failed | done
/** 拼图块左上角的横向位置（视图盒坐标） */
const dragX = ref(0)
/** 视图盒坐标 → 屏幕像素 的缩放比 */
const scale = ref(1)

let requestSeq = 0
let pointerId = null
let dragStartClientX = 0
let dragStartX = 0
let failedTimer = null

function clearFailedTimer() {
  if (failedTimer) {
    clearTimeout(failedTimer)
    failedTimer = null
  }
}

const hint = computed(() => {
  if (state.value === 'loading') return '加载中…'
  if (state.value === 'verifying') return '校验中…'
  if (state.value === 'done') return '验证通过'
  if (state.value === 'failed') return '未对准缺口，请重试'
  return '按住滑块，拖动到缺口处'
})

const pieceLeftPx = computed(() => dragX.value * scale.value)
const handleWidthPx = computed(() => PIECE_SIZE * scale.value)
const fillWidth = computed(() => `${pieceLeftPx.value + handleWidthPx.value}px`)

/** 拉一张新挑战。验证失败、父层清空令牌后都会走这里重来 */
async function refresh() {
  clearFailedTimer()
  const seq = ++requestSeq
  state.value = 'loading'
  dragX.value = 0
  emit('update:modelValue', '')

  try {
    const response = await fetch('/api/captcha')
    const data = await response.json()
    if (seq !== requestSeq) return
    if (!response.ok || !data?.id) throw new Error('挑战响应不完整')
    challenge.value = data
    state.value = 'idle'
  } catch {
    if (seq !== requestSeq) return
    challenge.value = null
    state.value = 'idle'
  }
}

function updateScale() {
  const width = stageEl.value?.clientWidth
  if (width > 0) scale.value = width / VIEW_WIDTH
}

function onResize() {
  updateScale()
}

onMounted(() => {
  updateScale()
  window.addEventListener('resize', onResize)
  refresh()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  clearFailedTimer()
})

function onPointerDown(event) {
  if (props.disabled || !challenge.value || state.value !== 'idle') return
  updateScale()
  pointerId = event.pointerId
  dragStartClientX = event.clientX
  dragStartX = dragX.value
  state.value = 'dragging'
  try {
    event.currentTarget.setPointerCapture(pointerId)
  } catch {
    // 捕获失败（指针已释放等）时退回 window 监听，拖动依旧可用
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }
}

/** 拖动结束后摘掉可能挂上的兜底监听（没挂上时移除是无操作） */
function detachFallback() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(event) {
  if (state.value !== 'dragging' || event.pointerId !== pointerId) return
  const delta = (event.clientX - dragStartClientX) / scale.value
  dragX.value = Math.max(0, Math.min(MAX_X, dragStartX + delta))
}

function onPointerCancel(event) {
  if (state.value !== 'dragging' || event.pointerId !== pointerId) return
  pointerId = null
  detachFallback()
  state.value = 'idle'
  dragX.value = 0
}

async function onPointerUp(event) {
  if (state.value !== 'dragging' || event.pointerId !== pointerId) return
  pointerId = null
  detachFallback()

  // 几乎没拖动视为误触，直接归位不打扰服务端
  if (dragX.value < 6) {
    state.value = 'idle'
    dragX.value = 0
    return
  }

  state.value = 'verifying'
  try {
    const response = await fetch('/api/captcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: challenge.value.id,
        x: Math.round(dragX.value * 10) / 10,
      }),
    })
    const data = await response.json()
    if (data?.ok && data.token) {
      state.value = 'done'
      emit('update:modelValue', data.token)
      return
    }
  } catch {
    /* 网络/服务异常与验证失败同样处理：红色提示停留片刻后换新图 */
  }

  // 失败：红色提示停留 FAIL_PAUSE_MS 让人看清，期间禁止再拖，
  // 然后自动换一张新图；每次失败都上报给宿主（用于连续失败关闭弹窗）
  state.value = 'failed'
  emit('failed')
  failedTimer = setTimeout(() => refresh(), FAIL_PAUSE_MS)
}

/** 父层清空令牌（如注册失败后重置）时，图形同步换新 */
watch(
  () => props.modelValue,
  (value) => {
    if (!value && state.value === 'done') refresh()
  },
)

defineExpose({ refresh })
</script>

<template>
  <div class="slider-captcha">
    <div
      ref="stageEl"
      class="sc-stage"
      :class="{ 'is-failed': state === 'failed', 'is-done': state === 'done' }"
    >
      <img v-if="challenge" class="sc-bg" :src="challenge.background" alt="" draggable="false" />
      <img
        v-if="challenge && state !== 'loading'"
        class="sc-piece"
        :src="challenge.piece"
        :style="{
          top: `${(challenge.pieceY - KNOB_RADIUS) * scale}px`,
          width: `${PIECE_SIZE * scale}px`,
          height: `${(PIECE_SIZE + KNOB_RADIUS) * scale}px`,
          transform: `translateX(${pieceLeftPx}px)`,
        }"
        alt=""
        draggable="false"
      />
      <button v-if="!challenge" type="button" class="sc-retry" @click="refresh">
        加载失败，点击重试
      </button>
    </div>

    <div class="sc-track" :class="{ 'is-done': state === 'done', 'is-failed': state === 'failed' }">
      <div class="sc-fill" :style="{ width: fillWidth }"></div>
      <span class="sc-hint">{{ hint }}</span>
      <button
        type="button"
        class="sc-handle"
        :style="{ left: `${pieceLeftPx}px`, width: `${handleWidthPx}px` }"
        :disabled="disabled || state === 'done' || state === 'failed' || !challenge"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <i class="sc-grip" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.slider-captcha {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sc-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  border-radius: 8px;
  overflow: hidden;
  background: #eef1f5;
}

.sc-stage.is-failed {
  animation: sc-shake 0.25s;
}

.sc-bg,
.sc-piece {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}

.sc-piece {
  position: absolute;
  left: 0;
  pointer-events: none;
  will-change: transform;
  /* 投影让块在拖动时与背景拉开层次，配合描边保证可见 */
  filter: drop-shadow(0 2px 6px rgba(15, 23, 42, 0.45));
}

.sc-retry {
  position: absolute;
  inset: 0;
  border: none;
  background: rgba(255, 255, 255, 0.88);
  color: #5b6472;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.sc-track {
  position: relative;
  height: 40px;
  border: 1px solid #e3e6ec;
  border-radius: 8px;
  background: #f5f7fa;
  overflow: hidden;
}

.sc-track.is-done {
  border-color: #bfe3cd;
  background: #e8f6ee;
}

.sc-track.is-failed {
  border-color: #eab8b3;
}

.sc-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: #e3ecf8;
}

.sc-track.is-done .sc-fill {
  background: #d3efdd;
}

.sc-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8b93a1;
  font-size: 12.5px;
  user-select: none;
}

.sc-track.is-failed .sc-hint {
  color: #c0392b;
}

.sc-track.is-done .sc-hint {
  color: #2e9e5b;
}

.sc-handle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 0;
  border: 1px solid #d5dae2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.15);
  cursor: grab;
  /* 拖动期间不触发页面滚动/手势 */
  touch-action: none;
}

.sc-handle:active {
  cursor: grabbing;
}

.sc-handle:disabled {
  cursor: default;
}

.sc-handle.is-done {
  border-color: #2e9e5b;
  background: #2e9e5b;
}

.sc-grip {
  width: 12px;
  height: 14px;
  background-image: radial-gradient(circle, #b6bdc9 1.5px, transparent 1.6px);
  background-size: 6px 7px;
}

.sc-handle.is-done .sc-grip {
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.9) 1.5px, transparent 1.6px);
}

@keyframes sc-shake {
  0%,
  100% {
    transform: translateX(0);
  }

  25% {
    transform: translateX(-4px);
  }

  75% {
    transform: translateX(4px);
  }
}
</style>
