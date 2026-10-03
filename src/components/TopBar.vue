<script setup>
/**
 * 顶部操作栏。
 * 数据导入导出与 PDF 导出逻辑分别在 useResumeFile / usePdfExport，
 * 本组件只负责按钮编排与状态展示。
 */
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

import AuthDialog from '@/components/AuthDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PasswordDialog from '@/components/PasswordDialog.vue'
import ResumeManagerDialog from '@/components/ResumeManagerDialog.vue'
import ShareDialog from '@/components/ShareDialog.vue'
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

/** 「我的简历」管理弹窗 */
const managerOpen = shallowRef(false)
/** 分享弹窗（要求登录，未登录先走登录流程） */
const shareOpen = shallowRef(false)

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

/** 分享要求登录：未登录先拉起登录，成功后用户再点一次即可 */
function openShare() {
  if (auth.status.value !== 'authed') {
    openLogin()
    return
  }
  shareOpen.value = true
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

/** 退出前先确认：误触退出会打断云端同步，值得多一次点击 */
const logoutConfirmOpen = shallowRef(false)

async function confirmLogout() {
  logoutConfirmOpen.value = false
  await onLogout()
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
    <div class="tb-brand">
      <span class="tb-logo"><SvgIcon name="layout" :size="16" /></span>
      <span class="brand-name">简历工坊</span>
      <span class="brand-chip">{{ templateName }}</span>
    </div>

    <span class="tb-sep" aria-hidden="true"></span>

    <div class="tb-group">
      <button
        class="ed-icon-btn"
        :disabled="!store.canUndo"
        title="撤销（Ctrl+Z）"
        aria-label="撤销"
        @click="store.undo"
      >
        <SvgIcon name="undo" :size="15" />
      </button>

      <button
        class="ed-icon-btn"
        :disabled="!store.canRedo"
        title="重做（Ctrl+Shift+Z）"
        aria-label="重做"
        @click="store.redo"
      >
        <SvgIcon name="redo" :size="15" />
      </button>
    </div>

    <span v-if="store.storageWarning" class="save-state warn">{{ store.storageWarning }}</span>
    <span v-else class="save-state">{{ saveText }}</span>

    <span class="tb-sep" aria-hidden="true"></span>

    <button
      class="ed-btn tb-collapse-md"
      title="管理本地保存的多份简历"
      @click="managerOpen = true"
    >
      <SvgIcon name="copy" :size="14" />
      <span class="btn-label">我的简历</span>
    </button>

    <button class="ed-btn tb-collapse-md" :title="toggleLabel" @click="emit('toggle-panel')">
      <SvgIcon :name="toggleIcon" :size="14" />
      <span class="btn-label">{{ toggleLabel }}</span>
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

    <div class="spacer"></div>

    <button
      class="ed-btn is-compact"
      title="生成公开只读链接，任何人可查看与打印"
      aria-label="分享"
      @click="openShare"
    >
      <SvgIcon name="link" :size="14" />
      <span class="btn-label">分享</span>
    </button>

    <button
      class="ed-btn is-compact"
      title="在打印窗口另存为 PDF：文本可选、体积最小，需手动勾选「背景图形」"
      aria-label="打印导出"
      @click="printPdf"
    >
      <SvgIcon name="print" :size="14" />
      <span class="btn-label">打印导出</span>
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

    <span class="tb-sep" aria-hidden="true"></span>

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
      <button
        class="ed-btn is-compact"
        title="退出登录"
        aria-label="退出登录"
        @click="logoutConfirmOpen = true"
      >
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

    <!-- 弹窗组件内部都会 Teleport 到 body，放在这里只是便于就近阅读 -->
    <ResumeManagerDialog :open="managerOpen" @close="managerOpen = false" />
    <ShareDialog :open="shareOpen" @close="shareOpen = false" />
    <AuthDialog />
    <ConfirmDialog
      :open="logoutConfirmOpen"
      title="退出登录"
      description="退出后简历仍保留在本机，重新登录后继续云端同步。"
      confirm-text="退出登录"
      danger
      @confirm="confirmLogout"
      @cancel="logoutConfirmOpen = false"
    />
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
  padding: 9px 14px;
  border-bottom: 1px solid var(--ed-line-soft);
  background: var(--ed-surface);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
  flex-wrap: wrap;
}

/* 品牌区：渐变 logo 块 + 产品名 + 当前模板胶囊 */
.tb-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tb-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--ed-brand-grad-hi) 0%, var(--ed-brand-strong) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    var(--ed-brand-glow);
  color: #fff;
}

.brand-name {
  color: var(--ed-ink);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.brand-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 12px;
  white-space: nowrap;
}

/* 工具条分组之间的竖向分隔线：没有它，一排等权按钮就还是「摆在一起」而不是「分好类」 */
.tb-sep {
  width: 1px;
  height: 20px;
  margin: 0 2px;
  background: var(--ed-line-soft);
}

.tb-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.spacer {
  flex: 1 1 auto;
}

.save-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  color: var(--ed-text-4);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 保存状态指示点：正常为品牌绿，受限时转琥珀色 */
.save-state::before {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ed-brand);
}

.save-state.warn {
  color: var(--ed-warn);
}

.save-state.warn::before {
  background: #f79009;
}

/* 主按钮内的剩余额度角标 */
.quota-badge {
  margin-left: 2px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 登录用户的身份展示：纯文本、不可点，与按钮区分开 */
.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 4px;
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.user-chip-name {
  max-width: 120px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/*
     * 三档宽度分级收缩，保证桌面宽度下永远单行：
     *  ≤1440 次要操作（导入/导出/恢复示例/分享/打印/退出）收成纯图标；
     *  ≤1280 再收掉模板名胶囊；
     *  ≤1120 保存状态与「我的简历 / 面板切换」的文字也让位，只剩图标与主 CTA。
     * 文字全部保留在 title / aria-label 里，语义不丢。
     */
@media (max-width: 1440px) {
  .editor-topbar {
    gap: 6px;
  }

  .is-compact {
    gap: 0;
    padding: 8px;
  }

  .is-compact .btn-label {
    display: none;
  }
}

@media (max-width: 1280px) {
  .brand-chip {
    display: none;
  }
}

@media (max-width: 1120px) {
  .save-state {
    display: none;
  }

  .tb-collapse-md {
    gap: 0;
    padding: 8px;
  }

  .tb-collapse-md .btn-label {
    display: none;
  }
}

@media (max-width: 900px) {
  .editor-topbar {
    gap: 6px;
    padding: 8px 10px;
  }

  /* 模板名与分隔线属于可省略信息，窄屏把它们让给操作按钮 */
  .brand-chip,
  .tb-sep {
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

  /* 两栏二选一是手机上的高频操作，切换文字恢复显示 */
  .tb-collapse-md {
    gap: 6px;
  }

  .tb-collapse-md .btn-label {
    display: inline;
  }
}
</style>
