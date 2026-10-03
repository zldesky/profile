<script setup>
/**
 * 快捷键速查弹窗：按「?」呼出，列出现有全部编辑器快捷键。
 * 纯展示组件，关闭行为交回父级。
 */
import { computed, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

const isMac =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || '')

/** 平台相关的修饰键展示：Mac 用 ⌘/⇧，其余用 Ctrl */
const groups = computed(() => {
  const mod = isMac ? '⌘' : 'Ctrl'
  const shift = isMac ? '⇧' : 'Shift'
  return [
    {
      title: '编辑',
      items: [
        { keys: [mod, 'Z'], label: '撤销' },
        { keys: [mod, shift, 'Z'], label: '重做' },
        { keys: [mod, 'Y'], label: '重做' },
      ],
    },
    {
      title: '文件',
      items: [{ keys: [mod, 'S'], label: '导出 JSON 备份' }],
    },
    {
      title: '纸面',
      items: [{ keys: ['Delete'], label: '隐藏纸面选中的模块' }],
    },
    {
      title: '帮助',
      items: [{ keys: ['?'], label: '打开本速查' }],
    },
  ]
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sc-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="sc-card"
        role="dialog"
        aria-modal="true"
        aria-label="快捷键速查"
        tabindex="-1"
      >
        <div class="sc-head">
          <h3 class="sc-title">快捷键</h3>
          <button class="sc-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <div v-for="group in groups" :key="group.title" class="sc-group">
          <div class="sc-group-title">{{ group.title }}</div>
          <div v-for="item in group.items" :key="item.label + item.keys.join()" class="sc-row">
            <span class="sc-label">{{ item.label }}</span>
            <span class="sc-keys">
              <kbd v-for="k in item.keys" :key="k">{{ k }}</kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sc-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 24, 40, 0.42);
}

.sc-card {
  width: 100%;
  max-width: 360px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.sc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.sc-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.sc-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ed-text-4);
  cursor: pointer;
}

.sc-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.sc-group {
  padding: 10px 0;
  border-bottom: 1px solid var(--ed-line-soft);
}

.sc-group:last-child {
  border-bottom: 0;
  padding-bottom: 2px;
}

.sc-group-title {
  margin-bottom: 6px;
  color: var(--ed-text-3);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.sc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  color: var(--ed-text);
  font-size: 13px;
}

.sc-keys {
  display: inline-flex;
  gap: 4px;
}

kbd {
  min-width: 22px;
  padding: 2px 6px;
  border: 1px solid var(--ed-line-2);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--ed-fill-2);
  color: var(--ed-text-2);
  font-family: var(--ed-font);
  font-size: 11.5px;
  line-height: 1.5;
  text-align: center;
}
</style>
