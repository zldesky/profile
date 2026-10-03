<script setup>
/**
 * 「我的简历」管理弹窗：本地多份简历的切换、新建、复制、重命名与删除。
 *
 * 数据面全部在 resume store：活跃文档本体在主文档键，非活跃文档存槽位，
 * 本组件只编排交互。删除用内嵌 ConfirmDialog 二次确认；
 * 云端同步只跟随当前打开的这份简历，弹窗里给出说明。
 */
import { shallowRef, useTemplateRef } from 'vue'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { formatTime } from '@/utils/helpers'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const store = useResumeStore()
const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
useDialogA11y(
  () => props.open,
  cardRef,
  () => emit('close'),
)

/** 弹窗内视图：文档列表 ↔ 历史版本 */
const view = shallowRef('docs')

/* ---- 重命名 ---- */

const renamingId = shallowRef('')
const renameDraft = shallowRef('')

function startRename(doc) {
  renamingId.value = doc.id
  renameDraft.value = doc.name
}

function commitRename() {
  if (renamingId.value) store.renameDoc(renamingId.value, renameDraft.value)
  renamingId.value = ''
}

function cancelRename() {
  renamingId.value = ''
}

/* ---- 删除 ---- */

const pendingDelete = shallowRef(null)

function askDelete(doc) {
  pendingDelete.value = doc
}

async function confirmDelete() {
  const doc = pendingDelete.value
  pendingDelete.value = null
  if (!doc) return
  if (!store.removeDoc(doc.id)) {
    toast('至少保留一份简历')
    return
  }
  toast(`已删除「${doc.name}」`)
}

/* ---- 历史版本 ---- */

const pendingRestore = shallowRef(null)

function askRestore(snapshot) {
  pendingRestore.value = snapshot
}

function confirmRestore() {
  const snapshot = pendingRestore.value
  pendingRestore.value = null
  if (!snapshot) return
  if (store.restoreSnapshot(snapshot.id)) {
    emit('close')
    toast(`已恢复到 ${formatTime(snapshot.updatedAt)} 的版本`)
  } else {
    toast('恢复失败：该版本数据已损坏')
  }
}

/* ---- 其它操作 ---- */

function openDoc(doc) {
  if (doc.id === store.activeDocId) {
    emit('close')
    return
  }
  store.switchDoc(doc.id)
  emit('close')
  toast(`已切换到「${doc.name}」`)
}

function createDoc() {
  store.createDoc()
  emit('close')
  toast('已新建空白简历')
}

function duplicateDoc(doc) {
  store.duplicateDoc(doc.id)
  toast(`已创建「${doc.name}」的副本`)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="rm-mask" @click.self="emit('close')">
      <div
        ref="cardRef"
        class="rm-card"
        role="dialog"
        aria-modal="true"
        aria-label="我的简历"
        tabindex="-1"
      >
        <div class="rm-head">
          <div class="rm-head-left">
            <button
              v-if="view === 'history'"
              class="ed-icon-btn"
              title="返回简历列表"
              aria-label="返回简历列表"
              @click="view = 'docs'"
            >
              <SvgIcon name="up" :size="14" style="transform: rotate(-90deg)" />
            </button>
            <h3 class="rm-title">{{ view === 'docs' ? '我的简历' : '历史版本' }}</h3>
          </div>
          <button class="rm-close" title="关闭" aria-label="关闭" @click="emit('close')">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <ul v-if="view === 'docs'" class="rm-list">
          <li v-for="doc in store.docList" :key="doc.id" class="rm-item">
            <template v-if="renamingId === doc.id">
              <input
                v-model="renameDraft"
                class="ed-input"
                aria-label="简历名称"
                maxlength="40"
                @keyup.enter="commitRename"
                @keyup.escape="cancelRename"
                @blur="commitRename"
              />
            </template>
            <template v-else>
              <button class="rm-open" :title="`打开「${doc.name}」`" @click="openDoc(doc)">
                <span class="rm-name">{{ doc.name }}</span>
                <span v-if="doc.id === store.activeDocId" class="rm-badge">当前</span>
                <span class="rm-time">{{ formatTime(doc.updatedAt) }}</span>
              </button>
              <div class="rm-actions">
                <button
                  class="ed-icon-btn"
                  title="重命名"
                  aria-label="重命名"
                  @click="startRename(doc)"
                >
                  <SvgIcon name="text" :size="14" />
                </button>
                <button
                  class="ed-icon-btn"
                  title="创建副本"
                  aria-label="创建副本"
                  @click="duplicateDoc(doc)"
                >
                  <SvgIcon name="copy" :size="14" />
                </button>
                <button
                  class="ed-icon-btn danger"
                  title="删除"
                  aria-label="删除"
                  :disabled="store.docList.length <= 1"
                  @click="askDelete(doc)"
                >
                  <SvgIcon name="trash" :size="14" />
                </button>
              </div>
            </template>
          </li>
        </ul>

        <div v-else class="rm-list">
          <div v-if="!store.snapshots.length" class="ed-empty">
            暂无历史版本，编辑时会自动按间隔留档
          </div>
          <div v-for="snap in store.snapshots" :key="snap.id" class="rm-item">
            <button
              class="rm-open"
              :title="`恢复到 ${formatTime(snap.updatedAt)} 的版本`"
              @click="askRestore(snap)"
            >
              <span class="rm-name">{{ snap.name }}</span>
              <span class="rm-time">{{ formatTime(snap.updatedAt) }}</span>
            </button>
            <div class="rm-actions">
              <button class="ed-btn" @click="askRestore(snap)">
                <SvgIcon name="refresh" :size="13" />
                <span>恢复</span>
              </button>
            </div>
          </div>
          <p class="ed-hint">
            恢复会覆盖当前内容；恢复前会先把当前状态自动留档一份，反悔可再恢复回来。
          </p>
        </div>

        <div class="rm-footer">
          <template v-if="view === 'docs'">
            <div class="rm-footer-row">
              <button class="ed-btn" @click="createDoc">
                <SvgIcon name="plus" :size="14" />
                <span>新建空白简历</span>
              </button>
              <button class="ed-btn" @click="view = 'history'">
                <SvgIcon name="clock" :size="14" />
                <span>历史版本</span>
                <span v-if="store.snapshots.length" class="rm-count">
                  {{ store.snapshots.length }}
                </span>
              </button>
            </div>
            <p class="ed-hint rm-hint">
              登录后云端同步跟随当前打开的这份简历；其余简历保存在本机。
            </p>
          </template>
        </div>

        <ConfirmDialog
          :open="!!pendingDelete"
          title="删除简历"
          :description="`确定删除「${pendingDelete?.name || ''}」？删除后不可恢复，建议先导出 JSON 备份。`"
          confirm-text="删除"
          danger
          @confirm="confirmDelete"
          @cancel="pendingDelete = null"
        />

        <ConfirmDialog
          :open="!!pendingRestore"
          title="恢复历史版本"
          :description="`恢复到 ${pendingRestore ? formatTime(pendingRestore.updatedAt) : ''} 的版本？当前内容会先自动留档一份。`"
          confirm-text="恢复"
          @confirm="confirmRestore"
          @cancel="pendingRestore = null"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rm-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 24, 40, 0.42);
}

.rm-card {
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: 16px;
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.rm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.rm-head-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rm-count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.rm-footer-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rm-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.rm-close {
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

.rm-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.rm-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.rm-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid var(--ed-line-soft);
}

.rm-item:last-child {
  border-bottom: 0;
}

/* 点击整行打开简历；「当前」行点了只关弹窗 */
.rm-open {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.rm-open:hover {
  background: var(--ed-fill-2);
}

.rm-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ed-ink);
  font-size: 13.5px;
  font-weight: 500;
}

.rm-badge {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-size: 11px;
  font-weight: 600;
}

.rm-time {
  flex: 0 0 auto;
  color: var(--ed-text-4);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.rm-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}

.rm-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--ed-line-soft);
}

.rm-hint {
  margin: 0;
}
</style>
