<script setup lang="ts">
/**
 * 管理后台（/admin，仅管理员）：编辑「模板 × 风格」SKU 运行时配置。
 *
 * 两个编辑区：
 *  1. 风格预设——增删改一键风格（名称、主色、标题样式、标记、底边线、字体）；
 *  2. 兼容矩阵——勾选每个模板允许的风格白名单。
 * 保存为全量 PUT（服务端校验枚举后入库），编辑器经 useStyleConfig 立即吃到新配置。
 *
 * 门卫：未登录先登录（弹窗，失败回退 /login）；非管理员账号显示无权限。
 * 内置默认：服务器从未保存过配置时，以代码内置组合作为编辑起点，保存后入库为准。
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import AuthDialog from '@/components/AuthDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useAuth } from '@/composables/useAuth'
import { useAuthDialog } from '@/composables/useAuthDialog'
import { useStyleConfig } from '@/composables/useStyleConfig'
import type { ServerStyleConfig } from '@/composables/useStyleConfig'
import { API, API_ERROR, ApiError, errorMessage as describeError, request } from '@/utils/api'
import { buildMatrixPayload } from '@/utils/styleMatrix'
import BaseSelect from '@/components/BaseSelect.vue'
import type { StylePreset } from '@/types/resume'
import { useToast } from '@/composables/useToast'
import {
  FONTS,
  STYLE_PRESETS,
  TEMPLATES,
  TITLE_BOTTOM_STYLES,
  TITLE_MARKERS,
  TITLE_STYLES,
} from '@/data/presets'

const router = useRouter()
const auth = useAuth()
const authDialog = useAuthDialog()
const styleConfig = useStyleConfig()
const { toast } = useToast()

/**
 * 草稿里的一个风格：key 为空表示「新建、尚未定 key」。
 * patch 与 StylePreset['patch'] 同源（Theme 的子集），不另起一套形状。
 */
interface DraftPreset {
  key: string
  name: string
  patch: StylePreset['patch']
  /**
   * 本地新加、尚未保存的风格。
   * 它此刻还没有正式 key（本地用 draft-<时间戳> 占位），保存时交给服务端生成 ——
   * 这个标记原先只在代码里用，没写进形状，类型检查把它点了出来。
   */
  isNew?: boolean
}

/** 模板 id → 允许的风格 key 列表 */
type DraftMatrix = Record<string, string[]>

/** loading | ready | forbidden | error | anon */
const state = shallowRef<'loading' | 'ready' | 'forbidden' | 'error' | 'anon'>('loading')
const errorMessage = shallowRef('')
const saving = shallowRef(false)

/** 草稿态：保存前的一切编辑都发生在 draft 上 */
const draftPresets = shallowRef<DraftPreset[]>([])
const draftMatrix = shallowRef<DraftMatrix>({})

/**
 * 编辑中的风格（null = 未在编辑）；key 为空表示新建。
 *
 * 必须用深响应的 ref 而不是 shallowRef：下拉/输入框的 v-model 写的是
 * editing.value.patch.fontKey 这类**嵌套字段**，浅响应感知不到，
 * 保存虽然能读到值，但界面回显永远停在旧值 —— v1 的原生 select 由浏览器
 * 自行更新选中显示，把这个缺陷掩盖了；BaseSelect 改为自绘菜单后
 * （显示值读 props）当场暴露，真实点击往返测试抓到。
 */
const editing = ref<DraftPreset | null>(null)

const fontOptions = Object.entries(FONTS).map(([key, font]) => ({ key, name: font.name }))

/*
 * 字体下拉的选项。多一个「跟随简历当前字体」的空值项：
 * 原来写的是 <option :value="undefined">，DOM 里 value 会变成字符串 "undefined"，
 * 读写两个方向都不牢靠。改用 BaseSelect 的空值项，值真正是 undefined。
 */
const fontSelectOptions = computed(() => [
  { value: undefined, label: '跟随简历当前字体' },
  ...fontOptions.map((font) => ({ value: font.key, label: font.name })),
])

/** 内置默认作为编辑起点（服务器从未保存过时） */
function draftFromBuiltin(): { presets: DraftPreset[]; matrix: DraftMatrix } {
  return {
    presets: STYLE_PRESETS.map((preset) => ({
      key: preset.key,
      name: preset.name,
      patch: { ...preset.patch },
    })),
    // tpl.styles 在类型上是可选，这里已用 filter 保证存在；
    // 展开处补 ?? [] 让类型系统也能确认（原写法靠 filter 的语义，TS 看不出来）
    matrix: Object.fromEntries(
      TEMPLATES.filter((tpl) => tpl.styles).map((tpl) => [tpl.id, [...(tpl.styles ?? [])]]),
    ),
  }
}

/**
 * 服务端 /api/styles-admin 下发的风格条目。
 * 响应体在客户端是 any，这里声明用到的字段即可 ——
 * 与其它页面一致：在类型边界处就近声明，不把整个响应建成大接口。
 */
interface AdminPresetPayload {
  key: string
  name: string
  patch: StylePreset['patch']
}

async function loadAdmin() {
  state.value = 'loading'
  try {
    const data = await request<{
      config: { presets?: AdminPresetPayload[]; matrix?: Record<string, string[]> } | null
    }>(API.stylesAdmin)

    if (data.config) {
      draftPresets.value = (data.config.presets ?? []).map((preset) => ({
        key: preset.key,
        name: preset.name,
        patch: { ...preset.patch },
      }))
      draftMatrix.value = Object.fromEntries(
        Object.entries(data.config.matrix || {}).map(([id, keys]) => [id, [...keys]]),
      )
    } else {
      // 服务端从未保存过：以内置默认作为编辑起点
      const base = draftFromBuiltin()
      draftPresets.value = base.presets
      draftMatrix.value = base.matrix
    }
    state.value = 'ready'
  } catch (error) {
    /*
     * 三种失败要分开表达，不能都落到一个「加载失败」：
     *  - 401 会话过期 → 回到匿名门卫，让用户重新登录；
     *  - 403 会话有效但角色不足（非管理员）→ 门卫页，重试也没用；
     *  - 其余 → 错误态，可重试。
     * 判据用 ApiError.code / status，不再手搓 response.status 分支。
     */
    if (error instanceof ApiError && error.code === API_ERROR.AUTH_EXPIRED) {
      auth.markExpired()
      state.value = 'anon'
      errorMessage.value = '登录已过期，请重新登录'
      return
    }
    if (error instanceof ApiError && error.status === 403) {
      state.value = 'forbidden'
      return
    }
    state.value = 'error'
    errorMessage.value = describeError(error) || '配置读取失败'
  }
}

watch(
  () => auth.status.value,
  (value) => {
    // 匿名：停在登录门卫；登录成功：拉取配置。state 只在 authed 后才有意义
    if (value === 'anon') {
      state.value = 'anon'
      return
    }
    if (value === 'authed' && state.value !== 'ready') loadAdmin()
  },
  { immediate: true },
)

/* ---------------- 风格预设编辑 ---------------- */

function startCreate() {
  editing.value = {
    key: '',
    name: '',
    patch: { accent: '#1e3a8a', titleStyle: 'fill', titleMarker: 'square', titleBottom: 'none' },
  }
}

function startEdit(preset: DraftPreset) {
  editing.value = { key: preset.key, name: preset.name, patch: { ...preset.patch } }
}

function cancelEdit() {
  editing.value = null
}

function saveDraft() {
  const draft = editing.value
  if (!draft) return
  const name = draft.name.trim()
  if (!name) {
    toast('风格名称不能为空')
    return
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.patch.accent ?? '')) {
    toast('主色须为 #RRGGBB 格式')
    return
  }
  const existing = draftPresets.value.findIndex((preset) => preset.key === (draft.key ?? ''))
  if (existing >= 0) {
    draftPresets.value[existing] = { ...draft, name }
  } else {
    // 新建风格此刻还没有 key：交给保存接口生成，本地先用临时键占位
    draftPresets.value.push({ ...draft, key: `draft-${Date.now()}`, name, isNew: true })
  }
  editing.value = null
  toast(`风格「${name}」已加入草稿，点「保存全部」后生效`)
}

function removePreset(preset: DraftPreset) {
  if (draftPresets.value.length <= 1) {
    toast('至少保留一个风格')
    return
  }
  draftPresets.value = draftPresets.value.filter((item) => item.key !== preset.key)
  // 矩阵同步清理被删风格
  for (const [id, keys] of Object.entries(draftMatrix.value)) {
    draftMatrix.value[id] = keys.filter((key) => key !== preset.key)
  }
  toast(`风格「${preset.name}」已从草稿移除，点「保存全部」后生效`)
}

/* ---------------- 兼容矩阵编辑 ---------------- */

function toggleCell(templateId: string, styleKey: string, allowed: boolean) {
  const keys = new Set(draftMatrix.value[templateId] || [])
  if (allowed) keys.add(styleKey)
  else keys.delete(styleKey)
  draftMatrix.value[templateId] = [...keys]
}

function setRowAll(templateId: string, allowed: boolean) {
  draftMatrix.value[templateId] = allowed ? draftPresets.value.map((preset) => preset.key) : []
}

/**
 * 提交给服务端的兼容矩阵。
 *
 * **只写有内容的行。** 原先这里对每个模板都写一行、缺省填空数组，
 * 注释还说「语义更直观」——实际效果相反：classic / custom 没有 styles 白名单，
 * 于是它们的行被写成 `[]`，而读取侧把 `[]` 当成了「一个风格都不允许」，
 * 导致默认模板上所有风格胶囊被置灰。空行 = 不限制，别把它写进存储。
 * 语义的单一出处是 utils/styleMatrix.ts（有单测锁定）。
 */
const matrixPayload = computed(() => buildMatrixPayload(TEMPLATES, draftMatrix.value))

/* ---------------- 保存 ---------------- */

async function saveAll() {
  if (saving.value) return
  saving.value = true
  try {
    // 新建风格占位的临时键在保存时去掉，由服务端生成正式 key
    const presets = draftPresets.value.map((preset) => ({
      key: preset.isNew ? undefined : preset.key,
      name: preset.name,
      patch: preset.patch,
    }))
    await request(API.stylesAdmin, {
      method: 'PUT',
      body: { presets, matrix: matrixPayload.value },
    })

    // 服务端可能生成了新 key：回读一次，编辑器同会话立即生效
    const fresh = await request<{ config: ServerStyleConfig | null }>(API.styles)
    if (fresh.config) {
      styleConfig.applyLocal(
        (fresh.config.presets ?? []).map((preset) => ({
          key: preset.key,
          name: preset.name,
          swatch: preset.patch?.accent,
          patch: { ...preset.patch },
        })),
        fresh.config.matrix || {},
      )
    }
    // 本地草稿对齐服务端（补回生成的 key、去掉 isNew 标记）
    await loadAdmin()
    toast('已保存，编辑器风格与矩阵已更新')
  } catch (error) {
    // 保存失败时不再照常提示「已保存」：文档提到的假成功最难查
    if (error instanceof ApiError && error.code === API_ERROR.AUTH_EXPIRED) {
      auth.markExpired()
      toast('登录已过期，请重新登录')
      return
    }
    toast(describeError(error) || '保存失败')
  } finally {
    saving.value = false
  }
}

function resetToBuiltin() {
  const base = draftFromBuiltin()
  draftPresets.value = base.presets
  draftMatrix.value = base.matrix
  toast('已恢复为内置默认组合（草稿态），保存后生效')
}

/** 登录入口：后台页内弹窗完成，配置关闭时回独立登录页 */
async function openLogin() {
  const opened = await authDialog.open({ mode: 'login' })
  if (!opened) router.push({ name: 'login' })
}

const detailText = (patch: StylePreset['patch']) =>
  `${TITLE_STYLES.find((item) => item.value === patch.titleStyle)?.label || patch.titleStyle} · ${
    TITLE_MARKERS.find((item) => item.value === patch.titleMarker)?.label || patch.titleMarker
  } · ${TITLE_BOTTOM_STYLES.find((item) => item.value === patch.titleBottom)?.label || patch.titleBottom} · ${
    FONTS[patch.fontKey ?? '']?.name || '默认字体'
  }`
</script>

<template>
  <div class="ad2-page">
    <header class="ad2-topbar">
      <router-link class="ad2-brand" :to="{ name: 'editor' }" title="返回编辑器">
        <span class="ad2-logo ed-brand-block"><SvgIcon name="layout" :size="15" /></span>
        <span class="ad2-name">简历工坊</span>
      </router-link>
      <span class="ad2-chip">管理后台</span>
      <div class="spacer"></div>
      <span v-if="auth.status.value === 'authed'" class="ad2-user">
        <SvgIcon name="user" :size="13" />
        <span>{{ auth.user.value?.username }}</span>
      </span>
    </header>

    <main class="ad2-main">
      <div
        v-if="
          auth.status.value === 'loading' || (auth.status.value === 'authed' && state === 'loading')
        "
        class="ad2-state"
      >
        <p>正在加载…</p>
      </div>

      <!-- 未登录：就地登录 -->
      <div v-else-if="auth.status.value === 'anon' || state === 'error'" class="ad2-state">
        <SvgIcon class="ad2-state-icon" name="lock" :size="24" />
        <p class="ad2-state-title">{{ state === 'error' ? errorMessage : '管理后台需要登录' }}</p>
        <button class="ed-btn ed-btn-primary" @click="openLogin">
          <SvgIcon name="user" :size="14" />
          <span>登录 / 注册</span>
        </button>
        <button v-if="state === 'error'" class="ed-btn" @click="loadAdmin">
          <SvgIcon name="refresh" :size="14" />
          <span>重试</span>
        </button>
      </div>

      <!-- 非管理员 -->
      <div v-else-if="state === 'forbidden'" class="ad2-state">
        <SvgIcon class="ad2-state-icon" name="lock" :size="24" />
        <p class="ad2-state-title">当前账号不是管理员</p>
        <p class="ad2-state-hint">实例的第一个注册账号自动成为管理员；如需调整请联系部署者。</p>
      </div>

      <template v-else>
        <section class="ad2-head">
          <h1 class="ad2-title">风格与模板配置</h1>
          <p class="ad2-sub">
            一键风格的增删改 + 每套模板的兼容风格白名单（SKU 矩阵）。保存后全站编辑器立即生效。
          </p>
        </section>

        <!-- 风格预设 -->
        <section class="ad2-section">
          <div class="ad2-sec-head">
            <h2 class="ad2-sec-title">风格预设</h2>
            <button class="ed-btn" @click="startCreate">
              <SvgIcon name="plus" :size="14" />
              <span>新建风格</span>
            </button>
          </div>

          <div class="ad2-style-list">
            <div v-for="preset in draftPresets" :key="preset.key" class="ad2-style-row">
              <i class="ad2-swatch" :style="{ background: preset.patch.accent }"></i>
              <div class="ad2-style-meta">
                <strong>{{ preset.name }}</strong>
                <span>{{ detailText(preset.patch) }}</span>
              </div>
              <span class="ad2-key">{{ preset.key }}</span>
              <div class="ad2-style-actions">
                <button class="ed-btn is-compact" title="编辑" @click="startEdit(preset)">
                  <SvgIcon name="text" :size="14" />
                </button>
                <button class="ed-btn is-compact" title="从草稿移除" @click="removePreset(preset)">
                  <SvgIcon name="trash" :size="14" />
                </button>
              </div>
            </div>
          </div>

          <!-- 新建 / 编辑表单 -->
          <div v-if="editing" class="ad2-form">
            <div class="ad2-form-title">
              {{ editing.key ? `编辑「${editing.name}」` : '新建风格' }}
            </div>
            <div class="ad2-form-grid">
              <label class="ad2-field">
                <span>名称</span>
                <input
                  v-model="editing.name"
                  class="ed-input"
                  maxlength="20"
                  placeholder="如：靛蓝商务"
                />
              </label>
              <label class="ad2-field">
                <span>主色</span>
                <span class="ad2-color-wrap">
                  <input
                    v-model="editing.patch.accent"
                    class="ed-input ad2-color-hex"
                    maxlength="7"
                    spellcheck="false"
                  />
                  <input
                    class="ad2-color-pick"
                    type="color"
                    :value="editing.patch.accent"
                    @input="editing.patch.accent = ($event.target as HTMLInputElement).value"
                  />
                </span>
              </label>
              <label class="ad2-field">
                <span>标题样式</span>
                <BaseSelect v-model="editing.patch.titleStyle" :options="TITLE_STYLES" />
              </label>
              <label class="ad2-field">
                <span>标题标记</span>
                <BaseSelect v-model="editing.patch.titleMarker" :options="TITLE_MARKERS" />
              </label>
              <label class="ad2-field">
                <span>标题底边线</span>
                <BaseSelect v-model="editing.patch.titleBottom" :options="TITLE_BOTTOM_STYLES" />
              </label>
              <label class="ad2-field">
                <span>字体（可选）</span>
                <BaseSelect v-model="editing.patch.fontKey" :options="fontSelectOptions" />
              </label>
            </div>
            <div class="ad2-form-actions">
              <button class="ed-btn ed-btn-primary" @click="saveDraft">
                <SvgIcon name="check" :size="14" />
                <span>加入草稿</span>
              </button>
              <button class="ed-btn" @click="cancelEdit">取消</button>
            </div>
          </div>
        </section>

        <!-- 兼容矩阵 -->
        <section class="ad2-section">
          <div class="ad2-sec-head">
            <h2 class="ad2-sec-title">兼容矩阵</h2>
            <span class="ad2-sec-hint">勾选每套模板允许的一键风格；未勾选的组合在编辑器里置灰</span>
          </div>

          <div class="ad2-matrix-scroll">
            <table class="ad2-matrix">
              <thead>
                <tr>
                  <th class="ad2-matrix-tpl">模板</th>
                  <th v-for="preset in draftPresets" :key="preset.key" class="ad2-matrix-col">
                    {{ preset.name }}
                  </th>
                  <th class="ad2-matrix-ops">行操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tpl in TEMPLATES" :key="tpl.id">
                  <td class="ad2-matrix-tpl">
                    <strong>{{ tpl.name }}</strong>
                  </td>
                  <td v-for="preset in draftPresets" :key="preset.key" class="ad2-matrix-cell">
                    <input
                      class="ed-check"
                      type="checkbox"
                      :checked="(draftMatrix[tpl.id] || []).includes(preset.key)"
                      @change="
                        toggleCell(tpl.id, preset.key, ($event.target as HTMLInputElement).checked)
                      "
                    />
                  </td>
                  <td class="ad2-matrix-ops">
                    <button class="ad2-link-btn" @click="setRowAll(tpl.id, true)">全选</button>
                    <button class="ad2-link-btn" @click="setRowAll(tpl.id, false)">清空</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="ad2-save-bar">
          <button class="ed-btn" @click="resetToBuiltin">恢复内置默认</button>
          <button class="ed-btn ed-btn-primary" :disabled="saving" @click="saveAll">
            <SvgIcon name="check" :size="14" />
            <span>{{ saving ? '保存中…' : '保存全部并发布' }}</span>
          </button>
        </div>
      </template>
    </main>

    <AuthDialog />
  </div>
</template>

<style scoped>
.ad2-page {
  min-height: 100vh;
  background: var(--ed-canvas);
}

.ad2-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--ed-line-soft);
  background: var(--ed-surface);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
}

.ad2-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.ad2-logo.ed-brand-block {
  width: 28px;
  height: 28px;
}

.ad2-name {
  color: var(--ed-ink);
  font-size: 15px;
  font-weight: 700;
}

.ad2-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 12px;
}

.spacer {
  flex: 1 1 auto;
}

.ad2-user {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.ad2-main {
  max-width: 1000px;
  margin: 0 auto;
  padding: 30px 24px 60px;
}

.ad2-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 70px 20px;
  border: 1px dashed var(--ed-line-soft);
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  color: var(--ed-text-3);
  text-align: center;
}

.ad2-state-icon {
  color: var(--ed-text-4);
}

.ad2-state-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 15px;
  font-weight: 600;
}

.ad2-state-hint {
  margin: 0;
  max-width: 360px;
  font-size: 12.5px;
  line-height: 1.7;
}

.ad2-head {
  margin-bottom: 22px;
}

.ad2-title {
  margin: 0 0 6px;
  color: var(--ed-ink);
  font-size: 23px;
  font-weight: 700;
}

.ad2-sub {
  margin: 0;
  color: var(--ed-text-2);
  font-size: 13px;
  line-height: 1.7;
}

.ad2-section {
  margin-bottom: 26px;
  padding: 18px 20px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
}

.ad2-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.ad2-sec-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 15px;
  font-weight: 600;
}

.ad2-sec-hint {
  color: var(--ed-text-4);
  font-size: 12px;
}

.ad2-style-list {
  display: flex;
  flex-direction: column;
}

.ad2-style-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 2px;
  border-bottom: 1px solid var(--ed-fill);
}

.ad2-style-row:last-child {
  border-bottom: 0;
}

.ad2-swatch {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: var(--ed-radius-sm);
  box-shadow: inset 0 0 0 1px rgba(16, 24, 40, 0.12);
}

.ad2-style-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ad2-style-meta strong {
  color: var(--ed-ink);
  font-size: 13px;
}

.ad2-style-meta span {
  color: var(--ed-text-4);
  font-size: 11.5px;
}

.ad2-key {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-4);
  font-family: monospace;
  font-size: 11px;
}

.ad2-style-actions {
  display: flex;
  gap: 6px;
}

.ad2-form {
  margin-top: 14px;
  padding: 14px 16px 16px;
  border: 1px solid var(--ed-brand-border);
  border-radius: var(--ed-radius-lg);
  background: var(--ed-fill-2);
}

.ad2-form-title {
  margin-bottom: 12px;
  color: var(--ed-ink);
  font-size: 13px;
  font-weight: 600;
}

.ad2-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.ad2-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ad2-field > span {
  color: var(--ed-text-2);
  font-size: 12px;
}

.ad2-color-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ad2-color-hex {
  flex: 1 1 auto;
  min-width: 0;
}

.ad2-color-pick {
  width: 34px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--ed-line-2);
  border-radius: var(--ed-radius-sm);
  background: var(--ed-surface);
  cursor: pointer;
}

.ad2-form-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.ad2-matrix-scroll {
  overflow-x: auto;
}

.ad2-matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.ad2-matrix th,
.ad2-matrix td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--ed-fill);
  text-align: center;
  white-space: nowrap;
}

.ad2-matrix th {
  color: var(--ed-text-3);
  font-size: 11.5px;
  font-weight: 600;
}

.ad2-matrix-tpl {
  text-align: left !important;
  color: var(--ed-ink);
  font-weight: 600;
}

.ad2-matrix-ops {
  color: var(--ed-text-4);
}

/*
 * 文字型小按钮（矩阵里的「全选 / 清空」）。
 *
 * 原来 padding 是 2px，盒子只有 36×23 —— 低于 24px 的最小点击目标，
 * 是 /admin 审计报出来的两处之一。改成 4px 上下即可到 24px，
 * 横向同步加到 8px 让命中区更接近方形，视觉上仍是一枚文字按钮。
 */
.ad2-link-btn {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--ed-brand-strong);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

/*
 * 矩阵单元格里的复选框：**必须自己够大**。
 *
 * 它裸放在 <td> 里、没有 <label> 包裹，所以 editor.css 那条
 * `label:has(> .ed-check) { min-height: 24px }` 覆盖不到它 ——
 * 实测只有 15×15（手机 18×18），是 /admin 审计报出的另一处。
 *
 * `<input>` 是替换元素，`::after` 不生效（早先在复选框上实测过），
 * 而它的父级是 <td>：把命中区扩到 <td> 上会让「点空白也算勾选」，
 * 在矩阵表里很容易误操作。所以直接把控件本身做到 24px —— 这是唯一
 * 既满足最小点击目标、又不会误触的改法。
 */
.ad2-matrix-cell .ed-check {
  width: 24px;
  height: 24px;
}

.ad2-link-btn:hover {
  text-decoration: underline;
}

.ad2-save-bar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  position: sticky;
  bottom: 16px;
  padding: 10px 14px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-lg);
  background: var(--ed-surface);
  box-shadow: var(--ed-shadow-lg);
}

@media (max-width: 640px) {
  .ad2-main {
    padding: 20px 14px 44px;
  }

  .ad2-section {
    padding: 14px;
  }
}
</style>
