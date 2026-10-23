<script setup lang="ts">
/**
 * 字段微调浮条：选中字段后贴着它显示，提示「按住拖动」与当前间距值。
 *
 * 纯展示：拖拽逻辑在 useFieldDrag 里（pointerdown 接管）、写回由 store 负责。
 * 这里只把「现在调的是哪个字段、左右/上下各偏了多少」讲清楚。
 */
import type { FieldLayout } from '@/types/resume'

defineProps<{
  /** 视口坐标 { left, top }，left 为浮条中心 */
  anchor: { left: number; top: number }
  /** 字段显示名 */
  label: string
  /** 当前间距值，展示用 */
  layout: FieldLayout
}>()
</script>

<template>
  <div class="field-nudge no-print" :style="{ left: `${anchor.left}px`, top: `${anchor.top}px` }">
    <span class="fn-label">{{ label }}</span>
    <span class="fn-axes">
      <span class="fn-axis">左 {{ layout.indent }}px</span>
      <span class="fn-axis">上 {{ layout.extraGap }}px</span>
    </span>
    <span class="fn-tip">按住拖动微调 · 双击改文字</span>
  </div>
</template>

<style scoped>
.field-nudge {
  position: fixed;
  z-index: 61;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--ed-ink);
  color: #fff;
  box-shadow: 0 6px 20px rgba(15, 22, 34, 0.28);
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 12px;
}

.fn-label {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.fn-axes {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.fn-axis {
  color: rgba(255, 255, 255, 0.72);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.fn-tip {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}
</style>
