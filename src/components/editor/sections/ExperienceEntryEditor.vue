<script setup lang="ts">
/**
 * 单段经历编辑：时间、单位、职位、机构图标、补充字段与要点。
 * 由 EntriesSectionEditor 按段渲染，自身只负责一段。
 * 要点行的 ✦ 按钮打开「表达助手」：默认给本地规则判断，需要时才走措辞改写。
 */
import { computed, shallowRef, useTemplateRef } from 'vue'

import ExpressionAssistantDialog from '@/components/ExpressionAssistantDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import DragHandle from '@/components/editor/DragHandle.vue'
import DraggableList from '@/components/editor/DraggableList.vue'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { readImageAsDataUrl } from '@/utils/helpers'
import type { Bullet, EntriesSection, EntryItem, EntryMeta } from '@/types/resume'
import type { EntryKind } from '@/utils/expression'

/*
 * 用具体类型而不是 { type: Object }，并且 section 收成 EntriesSection ——
 * 这正是可辨识联合的用法：EntriesSection 的 type 是字面量 'entries'，
 * 因此模板里取 section.items / entry.bullets 才有约束；
 * 若只写宽泛的 Section，取 section.items 会报错，提醒「先确定是哪种模块」。
 */
const props = defineProps<{
  section: EntriesSection
  entry: EntryItem
  index: number
  total: number
}>()

const store = useResumeStore()
const { toast } = useToast()

const logoInput = useTemplateRef('logoInput')
const uploadingLogo = shallowRef(false)

const updateEntry = (patch: Partial<EntryItem>) =>
  store.updateEntry(props.section.id, props.entry.id, patch)
const updateMeta = (metaId: string, patch: Partial<EntryMeta>) =>
  store.updateEntryMeta(props.section.id, props.entry.id, metaId, patch)

/** 当前正在编辑的要点：{ id, text }，null 表示面板关闭 */
const polishTarget = shallowRef<Bullet | null>(null)

/**
 * 这段经历属于哪一类，决定表达助手要不要套「动词开头」那套规则。
 * 用模块标题做启发式判断而不是新增数据字段：加字段要同时改
 * types / normalizeResume / sanitize 三处，而这里只需要一个提示口径。
 */
const entryKind = computed<EntryKind>(() => {
  const title = props.section.title || ''
  if (/教育|学历|学校/.test(title)) return 'education'
  if (/项目/.test(title)) return 'project'
  if (/校园|社团|实践|志愿/.test(title)) return 'campus'
  if (/工作|实习|任职/.test(title)) return 'work'
  return 'unknown'
})

/** 同段其它要点，交给规则引擎做重复检测 */
const siblingBullets = computed(() =>
  props.entry.bullets
    .filter((bullet) => bullet.id !== polishTarget.value?.id)
    .map((bullet) => bullet.text)
    .filter((text) => text.trim() !== ''),
)

function applyPolish(text: string) {
  if (!polishTarget.value) return
  store.updateBullet(props.section.id, props.entry.id, polishTarget.value.id, text)
  toast('已应用，Ctrl+Z 可撤销')
  polishTarget.value = null
}

function pickLogo() {
  const input = logoInput.value
  if (!input) return
  input.value = ''
  input.click()
}

async function onLogoChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    toast('请选择图片文件')
    return
  }

  uploadingLogo.value = true
  try {
    // 图标尺寸小，压到 160px 并用 PNG 保留透明背景
    updateEntry({ logo: await readImageAsDataUrl(file, 160, 'png') })
    toast('机构图标已更新')
  } catch (error) {
    toast(`图片处理失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    uploadingLogo.value = false
  }
}
/*
 * 标签与要点的重排。两者都走 DraggableList 的 reorder 出口 ——
 * 与拖拽、与键盘方向键是同一条路径，所以行为、撤销、落盘完全一致。
 */
function reorderMeta(ids: string[]): void {
  store.reorderEntryMetaByIds(props.section.id, props.entry.id, ids)
}
function reorderBullets(ids: string[]): void {
  store.reorderBulletsByIds(props.section.id, props.entry.id, ids)
}
</script>

<template>
  <div class="entry-editor ed-sub">
    <div class="ed-sub-head">
      <span class="ed-sub-label">第 {{ index + 1 }} 段</span>
      <DragHandle
        :index="index"
        :total="total"
        :item-id="entry.id"
        label="按住拖动可调整条目顺序"
      />
      <button
        class="ed-icon-btn"
        title="上移"
        :disabled="index === 0"
        @click="store.moveEntry(section.id, index, index - 1)"
      >
        <SvgIcon name="up" :size="14" />
      </button>
      <button
        class="ed-icon-btn"
        title="下移"
        :disabled="index === total - 1"
        @click="store.moveEntry(section.id, index, index + 1)"
      >
        <SvgIcon name="down" :size="14" />
      </button>
      <button
        class="ed-icon-btn danger"
        title="删除该段"
        @click="store.removeEntry(section.id, entry.id)"
      >
        <SvgIcon name="trash" :size="14" />
      </button>
    </div>

    <label class="ed-row">
      <span class="ed-label">时间</span>
      <input
        class="ed-input"
        :value="entry.time"
        placeholder="2022-06 - 至今"
        @input="updateEntry({ time: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="ed-row">
      <span class="ed-label">单位</span>
      <input
        class="ed-input"
        :value="entry.org"
        placeholder="公司 / 学校 / 项目名"
        @input="updateEntry({ org: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="ed-row">
      <span class="ed-label">职位</span>
      <input
        class="ed-input"
        :value="entry.role"
        placeholder="岗位 / 专业 / 担任角色"
        @input="updateEntry({ role: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <div v-if="section.showLogo" class="ed-row">
      <span class="ed-label">机构图标</span>
      <button
        class="ed-logo-picker"
        type="button"
        :title="entry.logo ? '更换校徽或公司 logo' : '上传校徽或公司 logo'"
        @click="pickLogo"
      >
        <img v-if="entry.logo" :src="entry.logo" alt="机构图标" />
        <SvgIcon v-else name="image" :size="14" />
      </button>
      <button v-if="entry.logo" class="ed-btn" @click="updateEntry({ logo: '' })">
        <SvgIcon name="close" :size="13" />
        <span>移除</span>
      </button>
      <span v-else class="ed-hint ed-hint-inline">建议使用透明背景的 PNG</span>
    </div>

    <!--
      标签（机构 / 时间这类键值对）可拖拽排序。
      handleClass 用 .ed-drag-sub：这几个列表**嵌套在条目列表内部**，
      与外层同名会让外层 Sortable 抢走手柄，拖标签就变成拖整段经历。
    -->
    <DraggableList :items="entry.meta" handle=".ed-drag-sub" @reorder="reorderMeta">
      <template #default="{ move }">
        <div v-for="(meta, mi) in entry.meta" :key="meta.id" class="ed-row">
          <DragHandle
            :index="mi"
            :total="entry.meta.length"
            :item-id="meta.id"
            handle-class="ed-drag-sub"
            label="按住拖动或用上下方向键调整标签顺序"
            @move="move"
          />
          <input
            class="ed-input ed-meta-label"
            :value="meta.label"
            placeholder="字段名"
            @input="updateMeta(meta.id, { label: ($event.target as HTMLInputElement).value })"
          />
          <input
            class="ed-input"
            :value="meta.value"
            placeholder="字段内容"
            @input="updateMeta(meta.id, { value: ($event.target as HTMLInputElement).value })"
          />
          <button
            class="ed-icon-btn danger"
            title="删除该字段"
            @click="store.removeEntryMeta(section.id, entry.id, meta.id)"
          >
            <SvgIcon name="trash" :size="14" />
          </button>
        </div>
      </template>
    </DraggableList>

    <button class="ed-btn ed-btn-block" @click="store.addEntryMeta(section.id, entry.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加补充字段</span>
    </button>

    <div class="ed-sub-title">要点描述</div>

    <DraggableList :items="entry.bullets" handle=".ed-drag-sub" @reorder="reorderBullets">
      <template #default="{ move }">
        <div v-for="(bullet, bi) in entry.bullets" :key="bullet.id" class="ed-bullet-row">
          <DragHandle
            :index="bi"
            :total="entry.bullets.length"
            :item-id="bullet.id"
            handle-class="ed-drag-sub"
            label="按住拖动或用上下方向键调整要点顺序"
            @move="move"
          />
          <textarea
            class="ed-textarea"
            :value="bullet.text"
            placeholder="一条要点，建议用「做了什么 + 结果数据」的写法"
            @input="
              store.updateBullet(
                section.id,
                entry.id,
                bullet.id,
                ($event.target as HTMLInputElement).value,
              )
            "
          ></textarea>
          <button
            class="ed-icon-btn"
            title="表达助手：检查这条要点，或让模型改写"
            aria-label="打开表达助手"
            @click="polishTarget = { id: bullet.id, text: bullet.text }"
          >
            <SvgIcon name="sparkles" :size="14" />
          </button>
          <button
            class="ed-icon-btn danger"
            title="删除该要点"
            aria-label="删除该要点"
            @click="store.removeBullet(section.id, entry.id, bullet.id)"
          >
            <SvgIcon name="trash" :size="14" />
          </button>
        </div>
      </template>
    </DraggableList>

    <button class="ed-btn ed-btn-block" @click="store.addBullet(section.id, entry.id)">
      <SvgIcon name="plus" :size="14" />
      <span>添加要点</span>
    </button>

    <input
      ref="logoInput"
      type="file"
      accept="image/png,image/jpeg,image/svg+xml,image/webp,image/*"
      hidden
      @change="onLogoChange"
    />

    <ExpressionAssistantDialog
      :open="!!polishTarget"
      kind="bullet"
      title="表达助手 · 要点"
      :text="polishTarget?.text || ''"
      :entry-kind="entryKind"
      :siblings="siblingBullets"
      @apply="applyPolish"
      @close="polishTarget = null"
    />
  </div>
</template>
