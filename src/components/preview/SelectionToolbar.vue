<script setup>
/**
 * 多选悬浮工具条：跟随选中区的整体位置，提供批量显隐与间距/缩进微调。
 * 定位由 PreviewPane 依据选中区的视口矩形计算，本组件只负责渲染与动作上抛。
 */
import SvgIcon from '@/components/SvgIcon.vue'

defineProps({
  /** 视口坐标 { left, top }，left 为工具条中心点 */
  anchor: { type: Object, required: true },
  count: { type: Number, required: true },
})

const emit = defineEmits(['toggle-visible', 'gap', 'indent', 'clear'])
</script>

<template>
  <div class="sel-toolbar no-print" :style="{ left: `${anchor.left}px`, top: `${anchor.top}px` }">
    <span class="sel-count">已选 {{ count }} 个模块</span>
    <button class="sel-btn" title="隐藏所选模块" @click="emit('toggle-visible')">
      <SvgIcon name="eyeOff" :size="14" />
    </button>

    <span class="sel-sep"></span>

    <span class="sel-tip">间距</span>
    <button class="sel-btn" title="减小上方间距" @click="emit('gap', -4)">
      <SvgIcon name="minus" :size="14" />
    </button>
    <button class="sel-btn" title="增大上方间距" @click="emit('gap', 4)">
      <SvgIcon name="plus" :size="14" />
    </button>

    <span class="sel-tip">缩进</span>
    <button class="sel-btn" title="减小左缩进" @click="emit('indent', -4)">
      <SvgIcon name="minus" :size="14" />
    </button>
    <button class="sel-btn" title="增大左缩进" @click="emit('indent', 4)">
      <SvgIcon name="plus" :size="14" />
    </button>

    <span class="sel-sep"></span>

    <button class="sel-btn" title="取消选择（Esc）" @click="emit('clear')">
      <SvgIcon name="close" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.sel-toolbar {
  position: fixed;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  border-radius: 999px;
  background: #242a35;
  color: #fff;
  box-shadow: 0 6px 20px rgba(15, 22, 34, 0.28);
  transform: translateX(-50%);
  white-space: nowrap;
}

.sel-count {
  padding: 0 5px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
}

.sel-tip {
  padding: 0 2px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}

.sel-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.sel-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.sel-sep {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: rgba(255, 255, 255, 0.18);
}
</style>
