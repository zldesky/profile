/**
 * 编辑面板（右侧那一栏）的宽度拖拽。
 *
 * 面板原先写死 `flex: 0 0 340px`。这个值对不同人差别很大：改文案的人希望面板宽一点、
 * 对照纸张的人希望窄一点，而纸张本身会跟着预览区宽度自动缩放 —— 面板宽一档，
 * 纸上内容就小一档。所以宽度交给用户拖。
 *
 * 三件容易被忽略、但必须做的事：
 *  1. **上限跟着窗口走**。固定一个 620px 的上限，在 1024 的屏上会把预览区挤到没地方；
 *     这里保证预览区至少留 MIN_STAGE_WIDTH，预览不可用时拖宽面板没有意义。
 *  2. **落盘只在拖完时做一次**。拖动中每帧都写 localStorage 既无必要也伤性能。
 *  3. **键盘也要能调**。拖拽对键盘用户不可达，所以手柄是 role="separator" +
 *     tabindex，方向键微调、双击复位。
 */
import { onBeforeUnmount, shallowRef } from 'vue'

/** 宽度持久化的键。带版本号：将来改上下限或语义时可以换键，避免读到不兼容的旧值 */
const STORAGE_KEY = 'resume-studio-panel-width-v1'

const DEFAULT_WIDTH = 340
/** 再窄内容面板就开始挤压了（模块操作按钮那一排合计约 224px） */
const MIN_WIDTH = 280
/** 再宽就没有意义：表单大多是单列，过宽反而不好读 */
const MAX_WIDTH = 640
/** 预览区至少要留出的宽度，低于这个值纸张会小到看不清 */
const MIN_STAGE_WIDTH = 420
/** 方向键每次调整的幅度 */
const KEYBOARD_STEP = 16

const width = shallowRef(DEFAULT_WIDTH)
/** 是否正在拖拽（用于切换全局光标与禁用文字选择） */
const resizing = shallowRef(false)

/** 当前窗口下允许的最大宽度 */
function maxWidth(): number {
  if (typeof window === 'undefined') return MAX_WIDTH
  // 先按「给预览留出 MIN_STAGE_WIDTH」算，再收到 MAX_WIDTH 以内；
  // 窗口特别窄时下限优先，否则会出现 max < min 的区间
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - MIN_STAGE_WIDTH))
}

function clamp(value: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)))
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width.value))
  } catch {
    /* 隐私模式等场景下写不进去，此时宽度只在本次会话内有效，不该报错打断使用 */
  }
}

/** 读回上次的宽度。初值非法（NaN / 越界）时退回默认 */
function restore(): void {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(saved) && saved > 0) width.value = clamp(saved)
  } catch {
    /* 读不到就用默认值 */
  }
}

restore()

export function usePanelResize() {
  /**
   * 开始拖拽。
   * 用 setPointerCapture：指针移出手柄后仍能收到事件。
   * 手柄没有 click 语义，所以捕获它不会吃掉别的交互
   * （这一点与纸面那个「按一下也要能点到文字」的场景不同）。
   */
  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return
    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement)) return
    event.preventDefault()

    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = width.value
    resizing.value = true
    handle.setPointerCapture?.(pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      // 面板在右侧：向左拖 = 变宽，所以是 startX - clientX
      width.value = clamp(startWidth + (startX - moveEvent.clientX))
    }

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      resizing.value = false
      persist()
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  /** 方向键微调：正值变宽 */
  function nudge(delta: number): void {
    const next = clamp(width.value + delta)
    if (next === width.value) return
    width.value = next
    persist()
  }

  /** 复位到默认宽度（双击手柄，或键盘 Home） */
  function resetWidth(): void {
    width.value = clamp(DEFAULT_WIDTH)
    persist()
  }

  /**
   * 窗口变窄时把过大的宽度收回来，否则面板会一直占着、预览被压没。
   * 只改内存值不落盘：用户的偏好宽度不该被一次临时缩窗覆盖掉 ——
   * 窗口恢复后仍按他原来拖的宽度来。
   */
  function onWindowResize(): void {
    const next = clamp(width.value)
    if (next !== width.value) width.value = next
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize)
    onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))
  }

  return { width, resizing, startResize, nudge, resetWidth, KEYBOARD_STEP, MIN_WIDTH, maxWidth }
}
