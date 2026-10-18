<script setup lang="ts">
/**
 * 条目列表编辑：教育背景、工作经历、项目经历、校园经历等。
 * 每段经历交给 ExperienceEntryEditor，本组件只负责模块级开关与列表编排。
 */
import { computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

import SvgIcon from '@/components/SvgIcon.vue'
import ExperienceEntryEditor from '@/components/editor/sections/ExperienceEntryEditor.vue'
import { useResumeStore } from '@/stores/resume'
import type { EntriesSection, EntryItem } from '@/types/resume'

const props = defineProps<{ section: EntriesSection }>()

const store = useResumeStore()

/**
 * 拖拽用的可写视图。
 *
 * **不能直接 `v-model="section.items"`**：section 是 prop，往它的属性上赋值会被
 * Vue 拦下，拖完 DOM 被 SortableJS 改过、但数据没变，于是 Vue 重渲染时**顺序回弹**。
 * 实测就是这样：SortableJS 明明接管了（sortable-chosen / drag / ghost 都出现），
 * 松手后条目却恢复原样 —— 看起来像「拖拽没生效」，实际是写回被吞了。
 *
 * 改成 get/set 走 store 的动作：set 里把新数组换算成一次 moveEntry，
 * 于是撤销、落盘、纸面重排全都自动跟上（模块卡片那层直接绑 store 的数组，所以没这个问题）。
 */
const draggableItems = computed<EntryItem[]>({
  get: () => props.section.items,
  set: (next) => {
    const cur = props.section.items
    /*
     * 把「新顺序」换算成 store 的 moveEntry(from, to)。
     * 做法：逐位比对，第一个不同的位置就是 from；那一位上的条目在新数组里的位置就是 to。
     * 不用「next[0] 的位置」那种简化写法 —— 它只对「拖到第一位」成立。
     * 只换序、不增删，所以这样换算与 SortableJS 的结果等价；
     * 借用 store 的 moveItem 也就顺带拿到了撤销 / 落盘 / 纸面重排。
     */
    let from = -1
    for (let i = 0; i < cur.length; i += 1) {
      if (cur[i]?.id !== next[i]?.id) {
        from = i
        break
      }
    }
    if (from < 0) return
    const to = next.findIndex((item) => item.id === cur[from].id)
    if (to < 0 || to === from) return
    store.moveEntry(props.section.id, from, to)
  },
})
</script>

<template>
  <div class="entries-editor">
    <label class="ed-toggle">
      <input
        class="ed-check"
        type="checkbox"
        :checked="section.showLogo"
        @change="
          store.updateSection(section.id, { showLogo: ($event.target as HTMLInputElement).checked })
        "
      />
      <span>显示机构图标（校徽 / 公司 logo）</span>
    </label>
    <p v-if="section.showLogo" class="ed-hint">
      通常只建议国内顶尖院校或知名企业使用；普通院校贴校徽容易减分。未上传图片时会用机构名首字占位。
    </p>

    <div v-if="!section.items.length" class="ed-empty">暂无经历条目</div>

    <!--
      条目拖拽排序：与模块卡片同一套做法（VueDraggable + handle=".ed-drag"）。
      **但 v-model 不能直接绑 section.items**（那是 prop，写回会被 Vue 拦下，
      拖完顺序会回弹），改绑 draggableItems 这个可写视图 —— 详见脚本里的说明。

      index 仍在 v-for 里现算：数组换序后 Vue 会重新渲染，
      每段的「第 N 段」与上移/下移按钮的 disabled 状态随之更新。
      保留上移/下移按钮是因为键盘用户拖不了 —— 它们是可达性兜底，不是冗余。
    -->
    <VueDraggable v-model="draggableItems" :animation="160" handle=".ed-drag" class="entry-list">
      <ExperienceEntryEditor
        v-for="(entry, index) in section.items"
        :key="entry.id"
        :section="section"
        :entry="entry"
        :index="index"
        :total="section.items.length"
      />
    </VueDraggable>

    <button class="ed-btn ed-btn-block ed-btn-primary" @click="store.addEntry(section.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加一段经历</span>
    </button>
  </div>
</template>
