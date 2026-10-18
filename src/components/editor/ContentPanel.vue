<script setup lang="ts">
/**
 * 内容页签：锚点导航条 + 基本信息 + 模块列表。
 *
 * 锚点条解决长面板「找不到模块」的问题：点击滚动定位到对应卡片并短暂高亮；
 * 反向滚动时按「视口顶部最近的卡片」回亮锚点。滚动监听挂在 .panel-body 上
 * （本组件的滚动祖先），用 rAF 节流，卸载时统一清理。
 *
 * 用单一根容器包裹，使父级可以用 v-show 切换而不依赖 fragment。
 */
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'

import BasicsEditor from '@/components/editor/BasicsEditor.vue'
import SectionList from '@/components/editor/SectionList.vue'
import { useResumeStore } from '@/stores/resume'

const store = useResumeStore()

const rootRef = useTemplateRef('rootRef')

/** 当前视口顶部对应的锚点 id，用于反向高亮 */
const activeId = shallowRef('basics')

const anchors = computed(() => [
  { id: 'basics', title: '基本信息', visible: true },
  ...store.sections.map((s) => ({ id: s.id, title: s.title, visible: s.visible })),
])

/*
 * 高亮计时器。声明提到 go() 之前：
 * 原来它在 go() **后面**才 `let removeFlash = null`，而 go() 里先用了它。
 * let 有暂时性死区，只是 go() 只在点击时被调用、那时模块早已求值完，
 * 所以一直没炸 —— 属于「能跑但顺序不对」的写法。类型检查把它报了出来。
 */
let removeFlash: ReturnType<typeof setTimeout> | null = null

/**
 * 滚动定位到锚点。要点：目标若在折叠卡片里会先失效，
 * 所以这里不展开内容，只定位卡片头 —— 展开交给用户自己操作。
 */
function go(id: string) {
  const el = rootRef.value?.querySelector(`[data-section-id="${CSS.escape(id)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // 短暂高亮目标卡片，让「点到了哪」有明确反馈；超时后移除，不影响常规样式
  el.classList.add('is-nav-flash')
  if (removeFlash !== null) clearTimeout(removeFlash)
  removeFlash = setTimeout(() => el.classList.remove('is-nav-flash'), 1400)
  activeId.value = id
}

/** rAF 节流的滚动 spy：取视口顶部（页签下沿）之上最近的卡片 */
let ticking = false
function onScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    ticking = false
    const root = rootRef.value
    if (!root) return
    const threshold = 90
    let current = 'basics'
    root.querySelectorAll<HTMLElement>('[data-section-id]').forEach((el) => {
      if (el.getBoundingClientRect().top <= threshold) current = el.dataset.sectionId ?? current
    })
    activeId.value = current
  })
}

let scroller: Element | null | undefined = null

onMounted(() => {
  scroller = rootRef.value?.closest('.panel-body') ?? null
  scroller?.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  scroller?.removeEventListener('scroll', onScroll)
  if (removeFlash !== null) clearTimeout(removeFlash)
})
</script>

<template>
  <div ref="rootRef" class="panel-content">
    <nav class="panel-nav" aria-label="编辑定位">
      <button
        v-for="anchor in anchors"
        :key="anchor.id"
        type="button"
        :class="{ 'is-active': activeId === anchor.id, 'is-hidden-sec': !anchor.visible }"
        :title="anchor.visible ? `定位到「${anchor.title}」` : `「${anchor.title}」已在简历中隐藏`"
        @click="go(anchor.id)"
      >
        {{ anchor.title }}
      </button>
    </nav>

    <div data-section-id="basics">
      <BasicsEditor />
    </div>

    <SectionList />
  </div>
</template>

<style scoped>
.panel-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--ed-line-soft);
}

.panel-nav button {
  max-width: 96px;
  padding: 4px 10px;
  border: 1px solid var(--ed-line);
  border-radius: 999px;
  background: var(--ed-surface);
  color: var(--ed-text-2);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: 0.15s;
}

.panel-nav button:hover {
  border-color: var(--ed-line-2);
  background: var(--ed-fill-2);
  color: var(--ed-ink);
}

.panel-nav button.is-active {
  border-color: var(--ed-brand-border);
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-weight: 600;
}

/*
 * 当前所在模块的锚点也要有悬停反馈。
 *
 * 上面 `button:hover` 的浅色被这条更具体的 `.is-active` 盖住，于是鼠标停在
 * 当前模块的锚点上没有任何变化（实测 :hover 匹配、计算样式不变）——
 * 交互态审计 tools/audit-interaction.mjs 报出的就是这个。
 * 只压暗背景、不动文字色：文字与底色是对比度配好的。用 color-mix 而非写死色值，
 * 品牌色被 applyChromeAccent 换掉后依然成立。
 */
.panel-nav button.is-active:hover {
  background: color-mix(in srgb, var(--ed-brand-tint) 94%, #000);
}

/* 已隐藏模块的锚点：视觉降一级，提示它不在纸面上 */
.panel-nav button.is-hidden-sec {
  border-style: dashed;
  color: var(--ed-text-4);
  text-decoration: line-through;
  text-decoration-color: var(--ed-line-2);
}
</style>
