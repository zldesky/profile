<script setup lang="ts">
/**
 * 多选悬浮工具条：跟随选中区的整体位置，提供批量显隐与四向间距微调。
 * 定位由 PreviewPane 依据选中区的视口矩形计算，本组件只负责渲染与动作上抛。
 *
 * 间距用一个 `adjust` 事件而不是每个方向一对事件（原先 gap / indent 各一个）：
 * 方向从 2 个变成 4 个后，成对事件会变成 8 个，加第五个方向时还要再改签名。
 */
import SvgIcon from '@/components/SvgIcon.vue'

defineProps({
  /** 视口坐标 { left, top }，left 为工具条中心点 */
  anchor: { type: Object, required: true },
  count: { type: Number, required: true },
})

const emit = defineEmits<{
  'toggle-visible': []
  /** field：上方 / 下方 / 左侧 / 右侧；step：正负步长（px） */
  adjust: [field: 'extraGap' | 'extraGapBottom' | 'indent' | 'indentRight', step: number]
  clear: []
}>()

/** 四个方向的按钮分组，顺序按「上下左右」排，与编辑面板的滑杆顺序一致 */
const SPACING_GROUPS = [
  { field: 'extraGap', label: '上', minus: '减小上方间距', plus: '增大上方间距' },
  { field: 'extraGapBottom', label: '下', minus: '减小下方间距', plus: '增大下方间距' },
  { field: 'indent', label: '左', minus: '减小左缩进', plus: '增大左缩进' },
  { field: 'indentRight', label: '右', minus: '减小右缩进', plus: '增大右缩进' },
] as const
</script>

<template>
  <div class="sel-toolbar no-print" :style="{ left: `${anchor.left}px`, top: `${anchor.top}px` }">
    <span class="sel-count">已选 {{ count }} 个模块</span>
    <button class="sel-btn" title="隐藏所选模块" @click="emit('toggle-visible')">
      <SvgIcon name="eyeOff" :size="14" />
    </button>

    <span class="sel-sep"></span>

    <span
      v-for="group in SPACING_GROUPS"
      :key="group.field"
      class="sel-group"
      role="group"
      :aria-label="`${group.label}侧间距`"
    >
      <span class="sel-tip">{{ group.label }}</span>
      <button class="sel-btn" :title="group.minus" @click="emit('adjust', group.field, -4)">
        <SvgIcon name="minus" :size="14" />
      </button>
      <button class="sel-btn" :title="group.plus" @click="emit('adjust', group.field, 4)">
        <SvgIcon name="plus" :size="14" />
      </button>
    </span>

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
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--ed-ink);
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

/*
 * 每个方向的「标签 + 减/加」收成一组。分组而不是平铺，是因为四个方向的按钮
 * 一共 8 个，平铺后读者无法判断哪个「+」属于哪一侧 —— 标签与按钮必须绑定。
 */
.sel-group {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin: 0 2px;
}

/*
 * 窄屏收窄：四个方向全展开时工具条接近 500px，在手机视口里会溢出。
 * 只压间距、不隐藏任何方向 —— 隐藏按钮会让「能不能调右边」变成看运气。
 */
/*
 * 窄屏收窄。四个方向全展开时工具条约 500px，手机视口放不下。
 *
 * 取舍顺序是「先省装饰、再省标签、最后才动按钮尺寸」：
 * 按钮的 24px 命中区是静态审计的门槛，不能为了塞下工具条而破掉。
 * 所以这里只压内边距与标签，按钮保持 24px。
 */
@media (max-width: 720px) {
  .sel-toolbar {
    gap: 1px;
    padding: 3px 5px;
  }

  /* 计数是辅助信息，工具条本身已按选中区定位 */
  .sel-count {
    display: none;
  }

  .sel-group {
    margin: 0;
  }
}

/*
 * 400px 以下再收一档：方向标签（上/下/左/右）全部隐藏，只留 8 个按钮 + 关闭。
 * 语义不丢 —— 每个按钮的 title 写明方向（「增大右缩进」），
 * 每组还有 aria-label 兜住分组含义。按钮尺寸保持不变。
 */
@media (max-width: 400px) {
  .sel-toolbar {
    gap: 0;
    padding: 3px 4px;
  }

  .sel-tip {
    display: none;
  }

  .sel-group {
    gap: 0;
  }

  .sel-sep {
    margin: 0 1px;
  }
}

.sel-sep {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: rgba(255, 255, 255, 0.18);
}
</style>
