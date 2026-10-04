<script setup>
/**
 * 预览区底部工具条：缩放、页数提示、头像坐标读数与「压缩到一页」。
 * 纯展示组件，所有操作通过事件上抛给 PreviewPane。
 */
import SvgIcon from '@/components/SvgIcon.vue'

defineProps({
  zoom: { type: Number, required: true },
  autoFit: { type: Boolean, default: false },
  pageCount: { type: Number, required: true },
  compressing: { type: Boolean, default: false },
  dragging: { type: Boolean, default: false },
  offset: { type: Object, default: () => ({ x: 0, y: 0 }) },
})

const emit = defineEmits(['zoom-in', 'zoom-out', 'fit', 'compress'])
</script>

<template>
  <footer class="editor-tools">
    <span v-if="dragging" class="drag-readout"> 头像 X {{ offset.x }} / Y {{ offset.y }} mm </span>

    <button class="ed-btn ed-btn-icon" title="缩小" aria-label="缩小" @click="emit('zoom-out')">
      <SvgIcon name="zoomOut" :size="15" />
    </button>
    <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
    <button class="ed-btn ed-btn-icon" title="放大" aria-label="放大" @click="emit('zoom-in')">
      <SvgIcon name="zoomIn" :size="15" />
    </button>
    <!-- 窄屏收成图标，给「压缩到一页」腾出位置 -->
    <button
      class="ed-btn is-fit"
      :class="{ 'is-active': autoFit }"
      title="适应窗口"
      aria-label="适应窗口"
      @click="emit('fit')"
    >
      <SvgIcon name="refresh" :size="14" />
      <span class="btn-label">适应窗口</span>
    </button>

    <span class="divider"></span>

    <span class="page-badge" :class="{ 'is-over': pageCount > 1 }">{{ pageCount }} 页 A4</span>
    <button
      class="ed-btn"
      :disabled="pageCount <= 1 || compressing"
      title="逐步收紧字号与行距，把内容压进一页"
      @click="emit('compress')"
    >
      <SvgIcon name="check" :size="14" />
      <span>{{ compressing ? '压缩中…' : '压缩到一页' }}</span>
    </button>
  </footer>
</template>

<style scoped>
/*
 * 悬浮工具条：不再占一条底栏，而是浮在画布下沿的胶囊。
 * 半透明白 + backdrop blur，按钮全部去边框变幽灵态，是画布类产品的通用做法。
 */
.editor-tools {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 10;
  display: flex;
  transform: translateX(-50%);
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  padding: 6px 8px;
  border: 1px solid var(--ed-line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--ed-shadow-lg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* 胶囊内按钮去掉描边和投影，只留悬停底色，避免整条工具条显得零件堆叠 */
.editor-tools .ed-btn {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.editor-tools .ed-btn:hover {
  background: var(--ed-fill);
}

.editor-tools .ed-btn:disabled:hover {
  background: transparent;
}

.editor-tools .ed-btn.is-active {
  background: var(--ed-brand-tint);
}

.zoom-value {
  min-width: 44px;
  color: var(--ed-text-2);
  font-size: 12.5px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.divider {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--ed-line-soft);
}

.page-badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.page-badge.is-over {
  background: var(--ed-warn-tint);
  color: var(--ed-warn);
}

.drag-readout {
  margin-right: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .editor-tools {
    /* 空间不够时换行而不是把按钮压扁；拖动读数出现时尤其需要。
       叠加 iPhone 手势条安全区，按钮不被系统边缘手势压住 */
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }

  .ed-btn {
    min-height: 36px;
  }

  /* 一行放不下时宁可换行，也别把「压缩到一页」的文字挤掉 */
  .is-fit {
    gap: 0;
    padding: 8px;
  }

  .is-fit .btn-label {
    display: none;
  }

  .zoom-value {
    min-width: 40px;
  }

  .divider {
    display: none;
  }
}
</style>
