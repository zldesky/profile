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
    <span v-if="dragging" class="drag-readout">
      头像 X {{ offset.x }} / Y {{ offset.y }} mm
    </span>

    <button
      class="ed-btn ed-btn-icon"
      title="缩小"
      aria-label="缩小"
      @click="emit('zoom-out')"
    >
      <SvgIcon name="zoomOut" :size="15" />
    </button>
    <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
    <button
      class="ed-btn ed-btn-icon"
      title="放大"
      aria-label="放大"
      @click="emit('zoom-in')"
    >
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
.editor-tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid #e3e6ec;
  background: #fafbfc;
}

.zoom-value {
  min-width: 44px;
  color: #5b6472;
  font-size: 12.5px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: #e3e6ec;
}

.page-badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef1f5;
  color: #5b6472;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.page-badge.is-over {
  background: #fdf1e3;
  color: #b45309;
}

.drag-readout {
  margin-right: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eaf0fa;
  color: #24487f;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .editor-tools {
    /* 空间不够时换行而不是把按钮压扁；拖动读数出现时尤其需要 */
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
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
