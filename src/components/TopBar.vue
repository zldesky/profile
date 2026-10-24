<script setup lang="ts">
/**
 * 顶部操作栏。
 * 数据导入导出与 PDF 导出逻辑分别在 useResumeFile / usePdfExport，
 * 本组件只负责按钮编排与状态展示。
 */
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
} from 'vue'
import { useRouter } from 'vue-router'

import AuthDialog from '@/components/AuthDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { useAuth } from '@/composables/useAuth'
import { useAuthDialog } from '@/composables/useAuthDialog'
import { usePdfExport } from '@/composables/usePdfExport'
import { useResumeFile } from '@/composables/useResumeFile'
import { useToast } from '@/composables/useToast'
import { TEMPLATES } from '@/data/presets'
import { useResumeStore } from '@/stores/resume'
import { formatTime } from '@/utils/helpers'
import { parseResumePdf } from '@/utils/pdfImport'
import { checkResume } from '@/utils/completeness'
const CompletenessDialog = defineAsyncComponent(() => import('@/components/CompletenessDialog.vue'))
const JdMatchDialog = defineAsyncComponent(() => import('@/components/JdMatchDialog.vue'))
const TextNormalizeDialog = defineAsyncComponent(
  () => import('@/components/TextNormalizeDialog.vue'),
)
const ShareDialog = defineAsyncComponent(() => import('@/components/ShareDialog.vue'))
const ResumeManagerDialog = defineAsyncComponent(
  () => import('@/components/ResumeManagerDialog.vue'),
)
const PasswordDialog = defineAsyncComponent(() => import('@/components/PasswordDialog.vue'))

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
/** 简历体检 / 岗位对照弹窗 */
const checkOpen = shallowRef(false)
const jdOpen = shallowRef(false)

/**
 * 体检角标：还剩多少处可以改进。
 *
 * 为什么要做这个数字：体检快照只在打开弹窗时算一次，用户在编辑器里改了半天，
 * 完全不知道自己离「没问题」还有多远。角标把这件事变成可看见的目标，
 * 也让人有动力点开它。
 *
 * 用 computed 而不是 watch + ref：checkResume 是纯函数、几百微秒级别，
 * 每次简历变化重算一次完全够快，而 watch 会引入「什么时候该刷新」的状态问题。
 * 数字来自 completeness 的 total（按处数计），不是「合并后的条数」。
 */
const checkTotal = computed(() => (checkResume(store.resume) as { total: number }).total)
/** 导出菜单：JSON / Markdown / 纯文本 / 整包备份 */
const exportMenuOpen = shallowRef(false)

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
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

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

const {
  exportJSON,
  exportMarkdown,
  exportSourceMarkdown,
  exportPlainText,
  exportBackup,
  importFromFile,
  importMarkdownFile,
  resetResume,
  pendingConfirm,
  confirmPending,
  cancelPending,
} = useResumeFile()
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
  preflightOpen,
  preflightIssues,
  confirmPreflight,
  cancelPreflight,
  exportPackage,
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
  return '导出 PDF'
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
  const input = fileInput.value
  if (!input) return
  input.value = ''
  input.click()
}

function onFileChange(event: Event) {
  importFromFile((event.target as HTMLInputElement).files?.[0])
}

/** 导入菜单：JSON/备份、PDF 与 Markdown 三条入口共用 */
const importMenuOpen = shallowRef(false)
const pdfInput = useTemplateRef<HTMLInputElement>('pdfInput')
/** PDF 解析在主线程外的 worker 里跑，但整包可能要一两秒，按钮给出忙态 */
const pdfParsing = shallowRef(false)

/** 内容源 Markdown 的文件选择器，与 PDF 那条入口同一套写法 */
const markdownInput = useTemplateRef<HTMLInputElement>('markdownInput')

function pickMarkdown() {
  const input = markdownInput.value
  if (!input) return
  input.value = ''
  input.click()
}

function onMarkdownChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importMarkdownFile(file)
}

function pickPdf() {
  const input = pdfInput.value
  if (!input) return
  input.value = ''
  input.click()
}

/**
 * 导入 PDF 简历：浏览器端解析（文字层启发式），转成新文档交给用户核对。
 * 扫描件没有文字层会直接给出可读的错误提示。
 */
async function onPdfChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (pdfParsing.value) return
  pdfParsing.value = true
  try {
    const { resume, warnings } = await parseResumePdf(file)
    store.importAsDoc(resume)
    if (resume.basics.name) {
      store.renameDoc(store.activeDocId, `${resume.basics.name}的简历`)
    }
    toast(
      warnings.length
        ? `已导入，请核对：${warnings[0]}${warnings.length > 1 ? ` 等 ${warnings.length} 项` : ''}`
        : 'PDF 已转为可编辑简历，请核对识别结果',
    )
  } catch (rawError) {
    const error = rawError as { message?: string }
    toast(error.message || 'PDF 解析失败')
  } finally {
    pdfParsing.value = false
  }
}

/** 点菜单外面收起导入 / 导出菜单 */
function onDocPointerDown(event: PointerEvent) {
  // target 是 EventTarget | null，且点到的可能是文本节点，所以先收窄成 Element
  const target = event.target
  if (!(target instanceof Element) || !target.closest('.menu-wrap')) {
    exportMenuOpen.value = false
    importMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))

/** 从导出菜单触发一项导出后收起菜单 */
function runExport(action: () => void) {
  exportMenuOpen.value = false
  action()
}

/**
 * 打开「统一文案格式」。
 * 包一层函数而不是在模板里写 `exportMenuOpen = false; normalizeOpen = true`：
 * 多语句行内表达式会被 Prettier 折行，Vue 编译器解析失败，只有 build 会炸。
 */
const normalizeOpen = shallowRef(false)
function openNormalize() {
  exportMenuOpen.value = false
  normalizeOpen.value = true
}

/**
 * 导入菜单同理：先收起菜单再打开文件选择框。
 * 动作收进函数而不是写在模板里，是为了避免模板里出现多语句行内表达式——
 * Prettier 换行后 Vue 编译器解析不了，会以语法错误中断构建。
 */
function runImport(action: () => void) {
  importMenuOpen.value = false
  action()
}
</script>

<template>
  <header class="editor-topbar">
    <div class="tb-brand">
      <span class="tb-logo ed-brand-block"><SvgIcon name="layout" :size="16" /></span>
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

    <router-link
      class="ed-btn tb-collapse-md tb-link"
      :to="{ name: 'collection' }"
      title="浏览官网简历合集"
    >
      <SvgIcon name="image" :size="14" />
      <span class="btn-label">简历合集</span>
    </router-link>

    <router-link
      v-if="auth.user.value?.role === 'admin'"
      class="ed-btn tb-collapse-md tb-link"
      :to="{ name: 'admin' }"
      title="风格与模板管理后台"
    >
      <SvgIcon name="palette" :size="14" />
      <span class="btn-label">管理后台</span>
    </router-link>

    <button class="ed-btn tb-collapse-md" :title="toggleLabel" @click="emit('toggle-panel')">
      <SvgIcon :name="toggleIcon" :size="14" />
      <span class="btn-label">{{ toggleLabel }}</span>
    </button>

    <!-- 下面几个属于次要操作，窄屏收成图标；文字仍在无障碍树里，靠 aria-label 保留语义 -->
    <div class="menu-wrap">
      <button
        class="ed-btn is-compact"
        :class="{ 'is-active': importMenuOpen }"
        title="导入数据：JSON / 备份 / PDF 简历 / Markdown"
        aria-label="导入数据"
        aria-haspopup="menu"
        :aria-expanded="importMenuOpen"
        @click="importMenuOpen = !importMenuOpen"
      >
        <SvgIcon name="upload" :size="14" />
        <span class="btn-label">导入数据</span>
      </button>
      <div v-if="importMenuOpen" class="export-menu" role="menu">
        <button role="menuitem" @click="runImport(pickFile)">
          <span class="menu-name">JSON / 备份文件</span>
          <span class="menu-desc">本应用导出的数据</span>
        </button>
        <button role="menuitem" :disabled="pdfParsing" @click="runImport(pickPdf)">
          <span class="menu-name">{{ pdfParsing ? '解析中…' : 'PDF 简历导入' }}</span>
          <span class="menu-desc">规则解析，整份重建</span>
        </button>
        <button role="menuitem" @click="runImport(pickMarkdown)">
          <span class="menu-name">Markdown 简历导入</span>
          <span class="menu-desc">VSCode / Obsidian 里写的 .md</span>
        </button>
      </div>
    </div>

    <div class="menu-wrap">
      <button
        class="ed-btn is-compact"
        :class="{ 'is-active': exportMenuOpen }"
        title="导出"
        aria-label="导出"
        aria-haspopup="menu"
        :aria-expanded="exportMenuOpen"
        @click="exportMenuOpen = !exportMenuOpen"
      >
        <SvgIcon name="download" :size="14" />
        <span class="btn-label">导出数据</span>
      </button>
      <div v-if="exportMenuOpen" class="export-menu" role="menu">
        <button role="menuitem" @click="runExport(exportJSON)">
          <span class="menu-name">JSON 数据备份</span>
          <span class="menu-desc">可再次导入</span>
        </button>
        <button role="menuitem" @click="runExport(exportMarkdown)">
          <span class="menu-name">Markdown 文档</span>
          <span class="menu-desc">在线文档</span>
        </button>
        <button role="menuitem" @click="runExport(exportSourceMarkdown)">
          <span class="menu-name">Markdown 内容源</span>
          <span class="menu-desc">可在外编辑器里改，再导回</span>
        </button>
        <button role="menuitem" @click="runExport(exportPlainText)">
          <span class="menu-name">纯文本</span>
          <span class="menu-desc">ATS / 表单粘贴</span>
        </button>
        <!--
          投递包放在导出菜单最前面（由 CSS 的 order 控制会更麻烦，这里直接用顺序）：
          它是最接近「我投出去」这个终点的一个动作，值得紧挨着其它导出项。
        -->
        <button role="menuitem" @click="runExport(exportPackage)">
          <span class="menu-name">投递包（PDF + 纯文本）</span>
          <span class="menu-desc">打成一个 zip，命名带年月</span>
        </button>
        <button role="menuitem" @click="runExport(exportBackup)">
          <span class="menu-name">整包备份</span>
          <span class="menu-desc">全部简历 + 历史版本</span>
        </button>
        <!--
          「统一文案格式」放在导出菜单而不是主按钮区：
          它是一次性的整篇整理，不是高频操作。放主区会稀释真正高频的几个动作。
        -->
        <button role="menuitem" @click="openNormalize">
          <span class="menu-name">统一文案格式…</span>
          <span class="menu-desc">中英空格、多余空格，先预览再改</span>
        </button>
      </div>
    </div>

    <button
      class="ed-btn is-compact"
      title="返回示例简历：当前内容会先记入历史，可用 Ctrl+Z 撤销"
      aria-label="返回示例简历"
      @click="resetResume"
    >
      <SvgIcon name="refresh" :size="14" />
      <span class="btn-label">示例简历</span>
    </button>

    <button
      class="ed-btn is-compact"
      :class="{ 'has-badge': checkTotal > 0 }"
      :title="
        checkTotal > 0
          ? `简历体检：还有 ${checkTotal} 处可以改进，逐条说明为什么，点一条可跳到对应位置`
          : '简历体检：目前没有发现问题'
      "
      aria-label="简历体检"
      @click="checkOpen = true"
    >
      <SvgIcon name="check" :size="14" />
      <span class="btn-label">简历体检</span>
      <span v-if="checkTotal > 0" class="tb-badge">{{ checkTotal }}</span>
    </button>

    <button
      class="ed-btn is-compact"
      title="岗位对照：把目标岗位的要求逐条对到你的简历上，看哪些词没落到纸面"
      aria-label="岗位对照"
      @click="jdOpen = true"
    >
      <SvgIcon name="sparkles" :size="14" />
      <span class="btn-label">岗位对照</span>
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
    <button
      v-if="auth.status.value === 'anon'"
      class="ed-btn tb-collapse-sm"
      title="登录 / 注册"
      aria-label="登录 / 注册"
      @click="openLogin"
    >
      <SvgIcon name="user" :size="14" />
      <span class="btn-label">登录 / 注册</span>
    </button>
    <template v-else-if="auth.status.value === 'authed'">
      <span class="user-chip tb-collapse-sm" :title="`已登录：${auth.user.value?.username}`">
        <SvgIcon name="user" :size="14" />
        <span class="btn-label user-chip-name">{{ auth.user.value?.username }}</span>
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
    <input ref="pdfInput" type="file" accept="application/pdf,.pdf" hidden @change="onPdfChange" />
    <input
      ref="markdownInput"
      type="file"
      accept="text/markdown,.md,.markdown"
      hidden
      @change="onMarkdownChange"
    />

    <!-- 弹窗组件内部都会 Teleport 到 body，放在这里只是便于就近阅读 -->
    <ResumeManagerDialog :open="managerOpen" @close="managerOpen = false" />
    <ShareDialog :open="shareOpen" @close="shareOpen = false" />
    <CompletenessDialog :open="checkOpen" @close="checkOpen = false" />
    <JdMatchDialog :open="jdOpen" @close="jdOpen = false" />
    <TextNormalizeDialog :open="normalizeOpen" @close="normalizeOpen = false" />

    <!--
      导出前检查：只列出 error 级问题，且不硬阻断 —— 用户可以「仍然导出」。
      硬阻断会把「先导出一份看看效果」变成一件烦人的事。
    -->
    <ConfirmDialog
      :open="preflightOpen"
      title="导出前先看一眼"
      :description="`这份简历还有 ${preflightIssues.length} 处硬伤：${preflightIssues.map((i) => i.title).join('、')}。这些会在纸上直接露出来，建议先补上。`"
      confirm-text="仍然导出"
      cancel-text="先修改"
      @confirm="confirmPreflight"
      @cancel="cancelPreflight"
    />
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

    <!--
      导入 / 恢复示例这类「会覆盖数据」的确认框。
      文案来自 useResumeFile 的 askConfirm，这里只负责渲染 —— 组合式函数不持有 UI。
    -->
    <ConfirmDialog
      :open="!!pendingConfirm"
      :title="pendingConfirm?.title ?? ''"
      :description="pendingConfirm?.description ?? ''"
      :confirm-text="pendingConfirm?.confirmText ?? '确定'"
      :danger="pendingConfirm?.danger ?? true"
      @confirm="confirmPending"
      @cancel="cancelPending"
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

/* 顶栏里的路由链接按钮（如「简历合集」）：去掉 <a> 默认下划线与颜色 */
.tb-link {
  text-decoration: none;
}

/* 品牌区：渐变 logo 块 + 产品名 + 当前模板胶囊 */
.tb-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tb-logo.ed-brand-block {
  width: 28px;
  height: 28px;
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

/* 导出下拉菜单：锚定按钮下方，点外面由全局 pointerdown 收起 */
.menu-wrap {
  position: relative;
}

.export-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 70;
  min-width: 210px;
  padding: 6px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-md);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
}

.export-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ed-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.export-menu button:hover {
  background: var(--ed-fill-2);
}

.menu-name {
  flex: 0 0 auto;
  font-weight: 500;
}

.menu-desc {
  margin-left: auto;
  padding-left: 12px;
  color: var(--ed-text-4);
  font-size: 11px;
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
  background: var(--ed-warn);
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

/*
 * 体检角标：与主按钮上的 quota-badge 区分开 —— 那个是白字压在主色底上，
 * 这个压在普通按钮上，所以用浅色底 + 深色字，保证在两种按钮上都可读。
 * 不用红色：这些都不是硬伤，用告警色会让人焦虑，而「还剩几处可以改」应该是中性的。
 */
.tb-badge {
  margin-left: 2px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 登录用户的身份展示：纯文本、不可点，与按钮区分开 */
.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

@media (max-width: 600px) {
  /*
   * 手机宽度：账号入口也收成纯图标，间距再收一档，
   * 顶栏从三行并回两行（360px 设备第二行刚好放下）。
   * 320px 的老设备仍会折三行，由下一档再收品牌名。
   */
  .editor-topbar {
    gap: 4px;
    padding: 8px;
  }

  .tb-collapse-sm {
    gap: 0;
    padding: 8px;
  }

  .tb-collapse-sm .btn-label {
    display: none;
  }
}

@media (max-width: 360px) {
  /* 320px 设备：只留 logo 块，产品名让位给操作按钮 */
  .brand-name {
    display: none;
  }
}
</style>
