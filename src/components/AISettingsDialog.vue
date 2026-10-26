<script setup lang="ts">
/**
 * AI 服务设置弹窗：用户自带 API Key（BYOK）。
 *
 * 三个交互上的要点：
 *  1. **边填边存草稿**：弹窗可能被 Esc、点遮罩或外层弹窗关掉而卸载，
 *     组件卸载后 setup 里的 ref 就没了。因此每次输入都写一份 sessionStorage 草稿，
 *     下次打开原样回填 —— 填了一半的 Key 不会因为误关而消失。
 *  2. **模型可从下拉直接选**：各服务商的常用模型列在预设里，省去手打模型名；
 *     仍保留手填，因为各家模型上新很快，写死必然过期。
 *  3. **Esc 只关最上层**：useDialogA11y 需要能追踪的开关（computed），
 *     传 getter 会导致本弹窗从未登记进 Esc 栈，一次 Esc 连外层弹窗一起关掉。
 */
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import BaseSelect from '@/components/BaseSelect.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y.ts'
import { useToast } from '@/composables/useToast'
import { API, request } from '@/utils/api'
import { aiChat } from '@/utils/aiClient'
import {
  AI_PRESETS,
  clearAIDraft,
  clearAISettings,
  loadAIDraft,
  loadAISettings,
  presetById,
  saveAIDraft,
  saveAISettings,
} from '@/utils/aiKeyStore'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'saved'])

const { toast } = useToast()

const cardRef = useTemplateRef('cardRef')
/** 必须是能追踪的 Ref：传 getter 的话 useDialogA11y 的 watch 只求值一次，弹窗不会进 Esc 栈 */
const isOpen = computed(() => props.open)
useDialogA11y(isOpen, cardRef, () => emit('close'))

const presetId = shallowRef('magpie')
const baseUrl = shallowRef('')
const model = shallowRef('')
const apiKey = shallowRef('')
const remember = shallowRef(true)
const showKey = shallowRef(false)
const testing = shallowRef(false)
const keyReady = shallowRef(false)
/** 是否手填模型名（选「自定义模型」时）。为 false 时模型用下拉选择 */
const customModel = shallowRef(false)
/** 当前表单内容是否来自未保存的草稿，界面据此提示 */
const fromDraft = shallowRef(false)

const preset = computed(() => presetById(presetId.value))
/** 免 Key 预设（Magpie）：不显示 Key 输入框，改为显示联调状态 */
const isNoKey = computed(() => preset.value.noKey === true)
/** 当前服务商可选的内置模型；「自定义」预设没有候选，直接手填 */
const modelOptions = computed(() => preset.value.models || [])

/* ---------------- Magpie 本机直连状态 ---------------- */

/**
 * 服务端对 Magpie 的答复。
 *
 * `available` 是**服务端判定**的结果，不是前端猜的：它同时考虑
 * 「开关是否开启」与「是否回环部署」——云端部署时这里会是 false，
 * 界面就明说不可用，而不是让用户点了联调再吃一个莫名失败。
 */
interface MagpieStatus {
  available: boolean
  reason: string
  baseUrl: string
  installDir: string
  canAutoInstall: boolean
  installed: boolean
  installedAt: string
  running: boolean
  version: string
  models: Array<{ id: string; label: string }>
  defaultModel: string
  message: string
}

const magpieStatus = shallowRef<MagpieStatus | null>(null)
const magpieLoading = shallowRef(false)
const magpieError = shallowRef('')
/** 一键联调结果：能回出内容才算真通（端口通不等于能用） */
const probeResult = shallowRef('')
/** 下载确认框与安装进度 */
const installConfirmOpen = shallowRef(false)
const installing = shallowRef(false)

/**
 * 读取 Magpie 状态。
 *
 * 只在「免 Key 预设被选中」且弹窗打开时拉，避免每次开设置都多一个请求。
 * 失败不弹 toast：状态区自己会说明，弹窗里多一个错误提示反而吵。
 */
async function refreshMagpie() {
  if (magpieLoading.value) return
  magpieLoading.value = true
  magpieError.value = ''
  try {
    magpieStatus.value = await request<MagpieStatus>(API.magpieStatus)
  } catch (error) {
    const err = error as { code?: string; message?: string }
    magpieError.value =
      err.code === 'AUTH_EXPIRED' ? '需要先登录才能使用本机 AI 通道' : err.message || '读取失败'
    magpieStatus.value = null
  } finally {
    magpieLoading.value = false
  }
}

/** 一键联调：真的发一次最小对话，成功即写入配置（用户不必再点保存） */
async function probeMagpie() {
  if (testing.value) return
  testing.value = true
  probeResult.value = ''
  magpieError.value = ''
  try {
    const result = await request<{ model: string; latencyMs: number; reply: string }>(
      API.magpieProbe,
      { method: 'POST', body: { model: model.value.trim() || undefined } },
    )
    probeResult.value = `已连通：${result.model}，${result.latencyMs} ms，回复「${result.reply}」`

    /*
     * 联调成功就直接落配置。
     * 理由：这一步已经把「地址 + 模型 + 额度 + 网络」全部验过了，
     * 再要求用户点一次「保存并测试」是多余的一步，而且容易忘 ——
     * 忘了的话他会以为配好了，回到润色弹窗却仍提示去设置。
     */
    saveAISettings({
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      apiKey: '',
      remember: remember.value,
      noKey: true,
    })
    clearAIDraft()
    fromDraft.value = false
    keyReady.value = true
    toast('Magpie 已连通，之后无需 API Key')
    emit('saved')
    await refreshMagpie()
  } catch (error) {
    const err = error as { code?: string; message?: string }
    magpieError.value =
      err.code === 'AUTH_EXPIRED' ? '需要先登录才能使用本机 AI 通道' : err.message || '联调失败'
  } finally {
    testing.value = false
  }
}

/** 用户确认后下载安装（默认落到服务端配置的目录，Windows 下是 D:\Tool） */
async function installMagpie() {
  installConfirmOpen.value = false
  if (installing.value) return
  installing.value = true
  magpieError.value = ''
  try {
    const result = await request<{
      filePath: string
      version: string
      pid: number
      launchError: string
    }>(API.magpieInstall, { method: 'POST', body: { confirm: true } })
    toast(
      result.launchError
        ? `已下载到 ${result.filePath}，但自动启动失败：${result.launchError}`
        : `Magpie ${result.version} 已安装并启动，稍等几秒再点「一键联调」`,
      4200,
    )
    // 刚启动的进程要几秒才监听端口，这里不立刻探测，交给用户点联调
    await refreshMagpie()
  } catch (error) {
    const err = error as { code?: string; message?: string }
    magpieError.value = err.message || '下载失败'
  } finally {
    installing.value = false
  }
}

/*
 * 两处下拉的选项形状映射：
 * - AI_PRESETS 用 { id, label }，BaseSelect 要 { value, label }；
 * - modelOptions 是字符串数组，值即标签。
 * 都在调用点映射，不动数据源本身。
 */
const presetOptions = computed(() =>
  AI_PRESETS.map((item) => ({ value: item.id, label: item.label })),
)
const modelSelectOptions = computed(() =>
  modelOptions.value.map((name) => ({ value: name, label: name })),
)
const isCustomPreset = computed(() => presetId.value === 'custom')

/**
 * 回填优先级：草稿 > 已保存配置 > 预设默认值。
 * 草稿在前是因为它的含义就是「上次没填完的东西」。
 */
function fillForm() {
  const saved = loadAISettings()
  const draft = loadAIDraft()

  if (draft) {
    presetId.value = presetById(draft.presetId).id
    baseUrl.value = draft.baseUrl ?? ''
    model.value = draft.model ?? ''
    apiKey.value = draft.apiKey ?? ''
    remember.value = draft.remember !== false
    fromDraft.value = true
  } else {
    presetId.value = saved
      ? AI_PRESETS.find((p) => p.baseUrl === saved.baseUrl)?.id || 'custom'
      : AI_PRESETS[0].id
    const source = saved || AI_PRESETS[0]
    baseUrl.value = source.baseUrl || ''
    model.value = source.model || ''
    apiKey.value = saved?.apiKey || ''
    remember.value = saved ? saved.remember : true
    fromDraft.value = false
  }

  // 免 Key 配置没有 apiKey，用 isUsableSettings 的语义判「已配置」而不是看 Key 在不在
  keyReady.value = Boolean(saved?.noKey || saved?.apiKey)
  // 模型不在候选里（例如手填过）时切到手填，否则下拉会显示成空
  customModel.value = !(presetById(presetId.value).models || []).includes(model.value)
  showKey.value = false
  probeResult.value = ''
  magpieError.value = ''

  // 选中免 Key 预设时拉一次本机 Magpie 状态（云端部署会在这里得到「不可用」）
  if (presetById(presetId.value).noKey) void refreshMagpie()
}

watch(
  () => props.open,
  (open) => {
    if (open) fillForm()
  },
)

/** 统一入口：模板各输入框的 @input 都走它，省去为 5 个字段各写一个 watch */
function persistDraft() {
  saveAIDraft({
    presetId: presetId.value,
    baseUrl: baseUrl.value,
    model: model.value,
    apiKey: apiKey.value,
    remember: remember.value,
    noKey: isNoKey.value,
  })
  fromDraft.value = true
}

/** 换服务商：填入该家默认地址与模型 */
function applyPreset() {
  const picked = presetById(presetId.value)
  if (picked.baseUrl) {
    baseUrl.value = picked.baseUrl
    model.value = picked.model
  }
  // 自定义预设没有候选模型，直接进入手填
  customModel.value = !picked.models?.length
  probeResult.value = ''
  magpieError.value = ''
  // 切到免 Key 预设就探一次；切走则清掉状态，避免把 Magpie 的结论带到别家
  if (picked.noKey) void refreshMagpie()
  else magpieStatus.value = null
  persistDraft()
}

/**
 * 在「下拉选模型」与「手填模型名」之间切换。
 * 抽成函数而不是写在模板里：模板的行内处理器必须保持单条语句，
 * 多语句被 Prettier 折行后 Vue 编译器会直接解析失败（npm run build 会炸）。
 */
function toggleCustomModel() {
  customModel.value = !customModel.value
  persistDraft()
}

async function saveAndTest() {
  if (testing.value) return

  // 免 Key 通道的必填项只有地址与模型：走联调那条路，不要求 Key
  if (isNoKey.value) {
    await probeMagpie()
    return
  }

  if (!baseUrl.value.trim() || !model.value.trim() || !apiKey.value.trim()) {
    toast('服务地址、模型与 API Key 都要填写')
    return
  }

  testing.value = true
  try {
    await aiChat({
      settings: {
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        apiKey: apiKey.value.trim(),
      },
      messages: [{ role: 'user', content: '回复「OK」两个字，不要其它内容。' }],
      temperature: 0,
    })
    saveAISettings({
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      apiKey: apiKey.value.trim(),
      remember: remember.value,
    })
    // 已正式保存，草稿的使命结束
    clearAIDraft()
    fromDraft.value = false
    keyReady.value = true
    toast(`连接成功，配置已保存${remember.value ? '' : '（仅本次会话有效）'}`)
    emit('saved')
  } catch (error) {
    // catch 的参数是 unknown：先收窄再取字段
    const err = error as { code?: string; message?: string }
    if (err.code === 'AUTH_EXPIRED') {
      toast('AI 功能需要先登录')
      return
    }
    toast(err.message || '连接失败，请检查地址、Key 与模型名')
  } finally {
    testing.value = false
  }
}

function forget() {
  clearAISettings()
  apiKey.value = ''
  keyReady.value = false
  fromDraft.value = false
  toast('已清除本机保存的 Key')
}

/** 关掉前把当前输入存成草稿：无论怎么关（Esc / 遮罩 / 关闭按钮）都不丢 */
function close() {
  persistDraft()
  emit('close')
}

/** 打开后把光标落到第一个空字段，省一次点击 */
watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  const card = cardRef.value
  if (!card) return
  const empty = [...card.querySelectorAll('input')].find((el) => !el.value)
  if (empty) empty.focus()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ai-mask" @click.self="close">
      <div
        ref="cardRef"
        class="ai-card"
        role="dialog"
        aria-modal="true"
        aria-label="AI 服务设置"
        tabindex="-1"
      >
        <div class="ai-head">
          <h3 class="ai-title">模型服务设置</h3>
          <button class="ai-close" title="关闭" aria-label="关闭" @click="close">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <label class="ai-field">
          <span>服务商</span>
          <BaseSelect v-model="presetId" :options="presetOptions" @change="applyPreset" />
        </label>

        <!--
          去申请 Key 的直达入口。
          放在「服务商」正下方而不是 Key 输入框旁边，是因为用户的操作顺序是
          「先选服务商 → 再去拿 Key → 再粘贴」；把入口放在输入框旁边，
          会让人在粘贴之后才看到它，那时已经不需要了。
          用 <a target="_blank" rel="noopener noreferrer">：
          noreferrer 是必需的 —— 否则新页面能拿到本页地址，
          而本应用是本地/内网部署，没有理由把它暴露给外部站点。
        -->
        <p v-if="preset.keyUrl" class="ai-keylink">
          <span>{{ preset.freeNote || '需要该服务商的 API Key' }}</span>
          <a
            class="ai-keylink-a"
            :href="preset.keyUrl"
            target="_blank"
            rel="noopener noreferrer"
            :title="`在新标签页打开 ${preset.label} 的 Key 页面`"
          >
            去拿 Key
            <SvgIcon name="link" :size="12" />
          </a>
        </p>

        <label class="ai-field">
          <span>服务地址（OpenAI 兼容）</span>
          <input
            v-model="baseUrl"
            class="ed-input"
            type="url"
            placeholder="https://api.deepseek.com"
            spellcheck="false"
            @input="persistDraft"
          />
        </label>

        <label class="ai-field">
          <span>模型</span>
          <span class="ai-model-row">
            <BaseSelect
              v-if="!customModel && modelOptions.length"
              v-model="model"
              :options="modelSelectOptions"
              @change="persistDraft"
            />
            <input
              v-else
              v-model="model"
              class="ed-input"
              placeholder="deepseek-chat"
              spellcheck="false"
              @input="persistDraft"
            />
            <button
              v-if="modelOptions.length"
              class="ed-icon-btn"
              type="button"
              :title="customModel ? '从列表选择' : '手动输入模型名'"
              :aria-label="customModel ? '从列表选择模型' : '手动输入模型名'"
              @click="toggleCustomModel"
            >
              <SvgIcon :name="customModel ? 'layout' : 'text'" :size="14" />
            </button>
          </span>
        </label>

        <!--
          免 Key 通道（Magpie 本机直连）：不显示 Key 输入框，改为显示本机状态。
          为什么不显示一个禁用的 Key 框：那会让人以为"还差一个 Key 没填"，
          而这条路根本不需要 Key —— 界面要如实表达这一点。
        -->
        <div v-if="isNoKey" class="ai-magpie">
          <div class="ai-magpie-head">
            <SvgIcon :name="magpieStatus?.running ? 'check' : 'clock'" :size="13" />
            <span v-if="magpieLoading">正在检测本机 Magpie…</span>
            <span v-else-if="magpieError" class="ai-magpie-bad">{{ magpieError }}</span>
            <span v-else-if="magpieStatus && !magpieStatus.available" class="ai-magpie-bad">
              {{ magpieStatus.reason }}
            </span>
            <span v-else-if="magpieStatus?.running">
              已连接 Magpie{{ magpieStatus.version ? ` ${magpieStatus.version}` : '' }}，免 Key
            </span>
            <span v-else-if="magpieStatus?.installed">
              已安装但未运行（{{ magpieStatus.installedAt }}），请先启动它
            </span>
            <span v-else class="ai-magpie-bad">未检测到 Magpie</span>
          </div>

          <p v-if="magpieStatus?.message && !magpieStatus.running" class="ai-magpie-note">
            {{ magpieStatus.message }}
          </p>

          <p v-if="probeResult" class="ai-magpie-ok">{{ probeResult }}</p>

          <div class="ai-magpie-actions">
            <button
              class="ed-btn ed-btn-primary"
              :disabled="testing || installing || !magpieStatus?.available"
              @click="probeMagpie"
            >
              <SvgIcon :name="testing ? 'refresh' : 'check'" :size="14" />
              <span>{{ testing ? '联调中…' : '一键联调' }}</span>
            </button>

            <!-- 没装才给下载入口：已经装了却再显示一个"下载"，只会让人以为要重装 -->
            <button
              v-if="
                magpieStatus?.available && !magpieStatus?.installed && magpieStatus?.canAutoInstall
              "
              class="ed-btn"
              :disabled="installing"
              @click="installConfirmOpen = true"
            >
              <SvgIcon name="download" :size="14" />
              <span>{{ installing ? '下载中…' : '下载并安装' }}</span>
            </button>

            <button class="ed-btn" :disabled="magpieLoading" @click="refreshMagpie">
              <SvgIcon name="refresh" :size="14" />
              <span>重新检测</span>
            </button>
          </div>

          <p class="ai-magpie-note">
            用本机 Magpie 已登录账号的额度，不需要 API Key。仅本机部署可用 ——
            公网部署时这条通道会停用，请改用下面任意一家的 Key。
          </p>
        </div>

        <label v-if="!isNoKey" class="ai-field">
          <span>API Key</span>
          <span class="ai-key-row">
            <input
              v-model="apiKey"
              class="ed-input"
              :type="showKey ? 'text' : 'password'"
              :placeholder="isCustomPreset ? 'sk-…' : '粘贴该服务商的 API Key'"
              autocomplete="off"
              spellcheck="false"
              @input="persistDraft"
            />
            <button
              class="ed-icon-btn"
              type="button"
              :title="showKey ? '隐藏' : '显示'"
              :aria-label="showKey ? '隐藏 Key' : '显示 Key'"
              @click="showKey = !showKey"
            >
              <SvgIcon :name="showKey ? 'eyeOff' : 'eye'" :size="14" />
            </button>
          </span>
        </label>

        <label v-if="!isNoKey" class="ed-toggle">
          <input v-model="remember" type="checkbox" class="ed-check" @change="persistDraft" />
          <span>记住密钥（保存到本机浏览器，下次免输入）</span>
        </label>

        <p v-if="fromDraft && !keyReady" class="ai-draft-hint">
          <SvgIcon name="clock" :size="13" />
          <span>已恢复上次未保存的内容，点「保存并测试」后才会生效。</span>
        </p>

        <p v-if="!isNoKey" class="ed-hint">
          Key 只保存在你自己的浏览器里（{{ remember ? 'localStorage' : '仅当前会话' }}），
          请求经由你部署的本机服务转发，服务端不保存、不记录 Key。
          任何本地存储都可能被本机恶意软件读取，建议使用低额度的专用 Key。
        </p>

        <div class="ai-actions">
          <button v-if="keyReady" class="ed-btn" @click="forget">清除已存的配置</button>
          <span class="ai-spacer"></span>
          <!-- 免 Key 通道的"保存"就是联调：上面那块已经有主按钮，这里不重复放 -->
          <button
            v-if="!isNoKey"
            class="ed-btn ed-btn-primary"
            :disabled="testing"
            @click="saveAndTest"
          >
            <SvgIcon :name="testing ? 'refresh' : 'check'" :size="14" />
            <span>{{ testing ? '测试中…' : '保存并测试' }}</span>
          </button>
        </div>

        <!--
          下载确认：这是全站唯一会下载并执行外部程序的入口，
          必须由用户明确点一次。默认焦点不在"确认"上，避免误按回车就装上。
        -->
        <ConfirmDialog
          :open="installConfirmOpen"
          title="下载 Magpie 到本机"
          :description="`将从 usemagpie.ai 下载 Magpie ${magpieStatus?.canAutoInstall ? '（约 60 MB）' : ''} 并校验 sha256，保存到 ${magpieStatus?.installDir || '本机'}，随后启动它。它会花本机 Magpie 账号的额度，需要你在它界面里登录一次。`"
          confirm-text="下载并安装"
          cancel-text="取消"
          @confirm="installMagpie"
          @cancel="installConfirmOpen = false"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-mask {
  position: fixed;
  inset: 0;
  z-index: 92;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ed-overlay);
}

.ai-card {
  width: 100%;
  max-width: 400px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px 20px 16px;
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
  outline: none;
}

.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ai-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.ai-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--ed-radius-sm);
  background: transparent;
  color: var(--ed-text-4);
  cursor: pointer;
}

.ai-close:hover {
  background: var(--ed-fill);
  color: var(--ed-brand-strong);
}

.ai-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.ai-field > span:first-child {
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.ai-key-row,
.ai-model-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-key-row .ed-input,
.ai-model-row .ed-input,
.ai-model-row .bsel {
  flex: 1 1 auto;
  min-width: 0;
}

/*
 * 「去拿 Key」提示条。
 *
 * 刻意做得**低对比、不抢注意力**：它是一个便利入口，不是必填项。
 * 做成醒目按钮会让人以为「必须先点这里」，而实际上很多用户早就存着 Key。
 * 左侧说明「有没有免费额度」是更值钱的信息 —— 很多人以为必须付费。
 */
.ai-keylink {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -4px 0 10px;
  padding: 6px 9px;
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
  color: var(--ed-text-3);
  font-size: 11.5px;
  line-height: 1.5;
}

.ai-keylink-a {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  min-height: 24px;
  padding: 0 4px;
  color: var(--ed-brand-strong);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.ai-keylink-a:hover {
  text-decoration: underline;
}

.ai-keylink-a:focus-visible {
  outline: 2px solid var(--ed-brand);
  outline-offset: 1px;
  border-radius: var(--ed-radius-xs);
}

/* 草稿提示：琥珀色，与「软校验警告」同一语气 */
.ai-draft-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 10px;
  padding: 7px 9px;
  border-radius: var(--ed-radius-sm);
  background: var(--ed-warn-tint);
  color: var(--ed-warn);
  font-size: 12px;
  line-height: 1.55;
}

.ai-draft-hint :deep(.svg-icon) {
  flex: 0 0 auto;
  margin-top: 2px;
}

.ai-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.ai-spacer {
  flex: 1 1 auto;
}

/*
 * 免 Key 通道的状态区。
 *
 * 用 --ed-fill-2 而不是警示色：它平时是"一切正常"的说明块，
 * 只有出错时（.ai-magpie-bad）才转成警示色 —— 整块常驻红底会让人以为一直有故障。
 */
.ai-magpie {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 0 12px;
  padding: 10px 11px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-sm);
  background: var(--ed-fill-2);
}

.ai-magpie-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--ed-text-2);
  font-size: 12.5px;
  line-height: 1.5;
}

.ai-magpie-head :deep(.svg-icon) {
  flex: 0 0 auto;
  margin-top: 2px;
}

.ai-magpie-bad {
  color: var(--ed-warn);
}

.ai-magpie-ok {
  margin: 0;
  color: var(--ed-brand-deep);
  font-size: 12px;
  line-height: 1.55;
  word-break: break-all;
}

.ai-magpie-note {
  margin: 0;
  color: var(--ed-text-3);
  font-size: 11.5px;
  line-height: 1.6;
}

.ai-magpie-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
