<script setup>
/**
 * 顶部操作栏。
 * 数据导入导出与 PDF 导出逻辑分别在 useResumeFile / usePdfExport，
 * 本组件只负责按钮编排与状态展示。
 */
import { computed, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

import AuthDialog from '@/components/AuthDialog.vue'
import PasswordDialog from '@/components/PasswordDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useAuth } from '@/composables/useAuth'
import { useAuthDialog } from '@/composables/useAuthDialog'
import { usePdfExport } from '@/composables/usePdfExport'
import { useResumeFile } from '@/composables/useResumeFile'
import { useToast } from '@/composables/useToast'
import { TEMPLATES } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'
import { formatTime } from '@/utils/helpers'

const props = defineProps({
  /** 窄屏两栏二选一，此按钮的含义随之改变 */
  isMobile: { type: Boolean, default: false },
  /** 编辑面板当前是否可见 */
  panelVisible: { type: Boolean, default: true },
})

const emit = defineEmits(['toggle-panel'])

/** 宽屏是显隐面板，窄屏是「编辑 / 预览」切换，同一颗按钮两种语义 */
const toggleLabel = computed(() => {
  if (props.isMobile) return props.panelVisible ? '预览' : '编辑'
  return props.panelVisible ? '隐藏面板' : '显示面板'
})

const toggleIcon = computed(() => {
  if (props.isMobile) return props.panelVisible ? 'eye' : 'text'
  return props.panelVisible ? 'eyeOff' : 'eye'
})

const store = useResumeStore()
const fileInput = useTemplateRef('fileInput')

const auth = useAuth()
const { toast } = useToast()
const router = useRouter()
const authDialog = useAuthDialog()

/**
 * 登录 / 注册入口：默认在编辑器内弹窗完成，不丢当前编辑；
 * 服务端配置关闭弹窗（AUTH_POPUP=off）时回退为跳转独立登录页。
 */
async function openLogin() {
  const opened = await authDialog.open({ mode: 'login' })
  if (!opened) router.push({ name: 'login' })
}

const { exportJSON, importFromFile, resetResume } = useResumeFile()
const {
  exporting,
  quota,
  quotaExhausted,
  needPassword,
  passwordOpen,
  passwordError,
  printPdf,
  exportViaServer,
  submitPassword,
  cancelPassword,
  refreshQuota,
} = usePdfExport()

/** 退出后同步一次额度（未登录时服务端不再返回），让导出按钮立刻反映状态 */
async function onLogout() {
  await auth.logout()
  await refreshQuota()
  toast('已退出登录，简历仍保留在本机')
}

const serverExportText = computed(() => {
  if (exporting.value) return '渲染中…'
  if (quotaExhausted.value) return '今日额度已用完'
  return '一键导出 PDF'
})

/** 服务要口令时换成锁图标，让按钮在点击前就说明为什么会被拦下 */
const serverExportIcon = computed(() => (needPassword.value ? 'lock' : 'download'))

const serverExportTitle = computed(() => {
  if (quotaExhausted.value) {
    return '今日导出额度已用完，次日 0 点重置；可改用「打印导出」，它不消耗额度'
  }
  if (needPassword.value) {
    return '渲染服务已启用访问口令，点击后输入口令即可导出'
  }
  const state = quota.value
    ? `今日剩余 ${quota.value.remaining} / ${quota.value.limit} 次`
    : '自动带背景、无需勾选任何选项'
  return `由本地渲染服务生成矢量 PDF：${state}`
})

const templateName = computed(
  () => TEMPLATES.find((t) => t.id === store.resume.template)?.name || '自定义',
)

const saveText = computed(() => {
  if (store.storageWarning) return '保存受限'
  return store.savedAt ? `已保存 ${formatTime(store.savedAt).slice(11)}` : '尚未修改'
})

/** 每次选择前清空，保证连续选同一个文件也能触发 change */
function pickFile() {
  fileInput.value.value = ''
  fileInput.value.click()
}

function onFileChange(event) {
  importFromFile(event.target.files?.[0])
}
</script>

<template>
  <header class="editor-topbar">
    <div class="brand">
      <SvgIcon name="layout" :size="17" />
      <span class="brand-name">简历工坊</span>
      <small>{{ templateName }}</small>
    </div>

    <div class="spacer"></div>

    <button
      class="ed-btn is-compact"
      :disabled="!store.canUndo"
      title="撤销（Ctrl+Z）"
      aria-label="撤销"
      @click="store.undo"
    >
      <SvgIcon name="undo" :size="14" />
    </button>

    <button
      class="ed-btn is-compact"
      :disabled="!store.canRedo"
      title="重做（Ctrl+Shift+Z）"
      aria-label="重做"
      @click="store.redo"
    >
      <SvgIcon name="redo" :size="14" />
    </button>

    <span v-if="store.storageWarning" class="save-state warn">{{ store.storageWarning }}</span>
    <span v-else class="save-state">{{ saveText }}</span>

    <button class="ed-btn" @click="emit('toggle-panel')">
      <SvgIcon :name="toggleIcon" :size="14" />
      <span>{{ toggleLabel }}</span>
    </button>

    <!-- 下面三个属于次要操作，窄屏收成图标；文字仍在无障碍树里，靠 aria-label 保留语义 -->
    <button class="ed-btn is-compact" title="导入数据" aria-label="导入数据" @click="pickFile">
      <SvgIcon name="upload" :size="14" />
      <span class="btn-label">导入数据</span>
    </button>

    <button class="ed-btn is-compact" title="导出数据" aria-label="导出数据" @click="exportJSON">
      <SvgIcon name="download" :size="14" />
      <span class="btn-label">导出数据</span>
    </button>

    <button class="ed-btn is-compact" title="恢复示例" aria-label="恢复示例" @click="resetResume">
      <SvgIcon name="refresh" :size="14" />
      <span class="btn-label">恢复示例</span>
    </button>

    <button
      class="ed-btn"
      title="在打印窗口另存为 PDF：文本可选、体积最小，需手动勾选「背景图形」"
      @click="printPdf"
    >
      <SvgIcon name="print" :size="14" />
      <span>打印导出</span>
    </button>

    <button
      class="ed-btn ed-btn-primary"
      :disabled="exporting || quotaExhausted"
      :title="serverExportTitle"
      @click="exportViaServer"
    >
      <SvgIcon :name="serverExportIcon" :size="14" />
      <span>{{ serverExportText }}</span>
      <span v-if="quota && !quotaExhausted" class="quota-badge">{{ quota.remaining }}</span>
    </button>

    <!-- 账号区：未登录给入口，已登录只显示身份与退出 -->
    <button v-if="auth.status.value === 'anon'" class="ed-btn" @click="openLogin">
      <SvgIcon name="user" :size="14" />
      <span>登录 / 注册</span>
    </button>
    <template v-else-if="auth.status.value === 'authed'">
      <span class="user-chip" :title="`已登录：${auth.user.value?.username}`">
        <SvgIcon name="user" :size="14" />
        <span class="user-chip-name">{{ auth.user.value?.username }}</span>
      </span>
      <button class="ed-btn is-compact" title="退出登录" aria-label="退出登录" @click="onLogout">
        <SvgIcon name="close" :size="14" />
        <span class="btn-label">退出</span>
      </button>
    </template>

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      hidden
      @change="onFileChange"
    />

    <!-- 两个弹窗组件内部都会 Teleport 到 body，放在这里只是便于就近阅读 -->
    <AuthDialog />
    <PasswordDialog
      :open="passwordOpen"
      :error="passwordError"
      :busy="exporting"
      @submit="submitPassword"
      @cancel="cancelPassword"
    />
  </header>
</template>

<style scoped>
.editor-topbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #e3e6ec;
  background: #fff;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #2b579a;
}

.brand-name {
  color: #1f2329;
  font-size: 15px;
  font-weight: 600;
}

.brand small {
  color: #7b8494;
  font-size: 12px;
  font-weight: 400;
}

.spacer {
  flex: 1 1 auto;
}

.save-state {
  max-width: 320px;
  color: #8b93a1;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.save-state.warn {
  color: #b45309;
}

/* 主按钮内的剩余额度角标 */
.quota-badge {
  margin-left: 2px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 登录用户的身份展示：纯文本、不可点，与按钮区分开 */
.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 4px;
  color: #5b6472;
  font-size: 12.5px;
}

.user-chip-name {
  max-width: 120px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

@media (max-width: 900px) {
  .editor-topbar {
    gap: 6px;
    padding: 8px 10px;
  }

  /* 模板名属于可省略信息，窄屏把它让给操作按钮 */
  .brand small {
    display: none;
  }

  .save-state {
    max-width: 108px;
  }

  /* 触控目标不小于 36px，同时压掉多余的横向留白 */
  .ed-btn {
    min-height: 36px;
    padding: 8px 10px;
    font-size: 12.5px;
  }

  /* 次要操作收成纯图标，标签仍在无障碍树中（aria-label 已给出） */
  .is-compact {
    gap: 0;
    padding: 8px;
  }

  .is-compact .btn-label {
    display: none;
  }
}
</style>
