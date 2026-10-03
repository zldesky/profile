<script setup>
/**
 * 首次访问引导：居中卡片 + 分步圆点，讲清「纸面预览 / 右侧编辑 / 设计换肤 / 一键导出」。
 * 完成或跳过后写入 localStorage 标记，此后不再出现；不走聚焦高亮那类重型导览，
 * 简历工具一上手就会改内容，三步说明足够建立心智。
 */
import { computed, shallowRef, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'

const emit = defineEmits(['done'])

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => true,
  cardRef,
  () => emit('done'),
)

const STEPS = [
  {
    icon: 'layout',
    title: '左侧纸面，实时预览',
    desc: '所有修改即改即见。直接在纸上点选模块，还能框选多个模块批量隐藏、微调间距。',
  },
  {
    icon: 'text',
    title: '右侧面板，填写内容',
    desc: '「基本信息」与「简历模块」都在右侧编辑；顶部锚点条可以快速跳到对应模块。',
  },
  {
    icon: 'palette',
    title: '设计页签，换个气质',
    desc: '12 套模板与配色随挑随换，界面主题会跟随简历主色一起变，所见即所得。',
  },
  {
    icon: 'download',
    title: '一键导出，直接投递',
    desc: '顶栏「一键导出 PDF」生成矢量投递版；登录后简历自动云端同步，换设备不丢。',
  },
]

const step = shallowRef(0)
const current = computed(() => STEPS[step.value])
const isLast = computed(() => step.value === STEPS.length - 1)

function next() {
  if (isLast.value) emit('done')
  else step.value += 1
}
</script>

<template>
  <Teleport to="body">
    <div class="ob-mask">
      <div
        ref="cardRef"
        class="ob-card"
        role="dialog"
        aria-modal="true"
        aria-label="新手引导"
        tabindex="-1"
      >
        <div class="ob-step-mark">第 {{ step + 1 }} / {{ STEPS.length }} 步</div>

        <div class="ob-icon-wrap">
          <span class="ob-icon"><SvgIcon :name="current.icon" :size="22" /></span>
        </div>

        <h3 class="ob-title">{{ current.title }}</h3>
        <p class="ob-desc">{{ current.desc }}</p>

        <div class="ob-dots" role="tablist" aria-label="引导进度">
          <button
            v-for="(item, index) in STEPS"
            :key="item.title"
            class="ob-dot"
            :class="{ 'is-active': index === step }"
            :aria-label="`第 ${index + 1} 步：${item.title}`"
            @click="step = index"
          ></button>
        </div>

        <div class="ob-actions">
          <button class="ob-skip" @click="emit('done')">跳过引导</button>
          <span class="ob-spacer"></span>
          <button v-if="step > 0" class="ed-btn" @click="step -= 1">上一步</button>
          <button class="ed-btn ed-btn-primary" @click="next">
            {{ isLast ? '开始使用' : '下一步' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ob-mask {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 24, 40, 0.42);
}

.ob-card {
  width: 100%;
  max-width: 380px;
  padding: 22px 24px 18px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  text-align: center;
  outline: none;
}

.ob-step-mark {
  color: var(--ed-text-4);
  font-size: 11.5px;
  letter-spacing: 0.08em;
}

.ob-icon-wrap {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.ob-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--ed-brand-grad-hi) 0%, var(--ed-brand-strong) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    var(--ed-brand-glow);
  color: #fff;
}

.ob-title {
  margin: 14px 0 6px;
  color: var(--ed-ink);
  font-size: 16.5px;
  font-weight: 700;
}

.ob-desc {
  margin: 0;
  min-height: 48px;
  color: var(--ed-text-2);
  font-size: 13px;
  line-height: 1.7;
}

.ob-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin: 10px 0 14px;
}

.ob-dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--ed-line-2);
  cursor: pointer;
  transition: 0.2s;
}

.ob-dot.is-active {
  width: 18px;
  background: var(--ed-brand);
}

.ob-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ob-skip {
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: var(--ed-text-4);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.ob-skip:hover {
  color: var(--ed-text-2);
}

.ob-spacer {
  flex: 1 1 auto;
}
</style>
