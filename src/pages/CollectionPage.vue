<script setup>
/**
 * 简历合集（/collection）：官网公开的简历陈列页。
 *
 * 游客可浏览前若干份（服务端截断，其余条目不下发 id），
 * 列表以「登录查看更多」的锁板收尾；登录后同一页展开全部并支持翻页。
 * 卡片预览复用真实模板（CollectionCard），本页不触碰全局品牌色：
 * 每张卡片的配色由其简历主题自带，外壳保持默认黑。
 */
import { computed, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import AuthDialog from '@/components/AuthDialog.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import CollectionCard from '@/components/collection/CollectionCard.vue'
import { useAuth } from '@/composables/useAuth'
import { useAuthDialog } from '@/composables/useAuthDialog'
import { useToast } from '@/composables/useToast'
import { CATEGORY_LABELS } from '@/data/presets'
import { fetchCollection } from '@/utils/collectionApi'

/** 与服务端 COLLECTION_PAGE_SIZE 的默认值一致 */
const PAGE_SIZE = 12

const year = new Date().getFullYear()

const router = useRouter()
const auth = useAuth()
const authDialog = useAuthDialog()
const { toast } = useToast()

const state = shallowRef('loading') // loading | ready | error
const errorMessage = shallowRef('')
const items = shallowRef([])
const total = shallowRef(0)
const categories = shallowRef([]) // 服务端 facets：[{ key, count }]
const activeCategory = shallowRef('all')
const guestLimited = shallowRef(false)
const loadingMore = shallowRef(false)

/** 筛选条：全部 + 有内容的分类（计数随登录态与分类切换刷新） */
const catOptions = computed(() => [
  { key: 'all', label: '全部', count: total.value },
  ...categories.value.map((item) => ({
    key: item.key,
    label: CATEGORY_LABELS[item.key] || item.key,
    count: item.count,
  })),
])

/** 游客视角被截断的数量：锁板文案用它，不泄露条目本身 */
const lockedCount = computed(() =>
  guestLimited.value ? Math.max(0, total.value - items.value.length) : 0,
)
const hasMore = computed(() => !guestLimited.value && items.value.length < total.value)

/** 请求序号：登录态/分类切换引发的快速重载，慢响应不得覆盖新响应 */
let seq = 0

async function load() {
  const id = ++seq
  state.value = 'loading'
  try {
    const data = await fetchCollection({
      offset: 0,
      limit: PAGE_SIZE,
      category: activeCategory.value,
    })
    if (id !== seq) return
    items.value = data.items
    total.value = data.total
    categories.value = data.categories
    guestLimited.value = data.guestLimited
    state.value = 'ready'
  } catch (error) {
    if (id !== seq) return
    state.value = 'error'
    errorMessage.value = error.message || '合集读取失败'
  }
}

async function loadMore() {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    const data = await fetchCollection({
      offset: items.value.length,
      limit: PAGE_SIZE,
      category: activeCategory.value,
    })
    items.value = items.value.concat(data.items)
    total.value = data.total
  } catch (error) {
    toast(error.message || '加载更多失败')
  } finally {
    loadingMore.value = false
  }
}

/** 切换分类：同键不重拉，切换后从头加载 */
function pickCategory(key) {
  if (key === activeCategory.value) return
  activeCategory.value = key
  load()
}

/** 浏览中登录成功：解锁全部并提示 */
watch(
  () => auth.status.value,
  (value) => {
    if (value === 'authed' && guestLimited.value) {
      load()
      toast('已登录，合集全部简历已解锁')
    }
  },
)

load()

/** 登录入口：默认当前页弹窗完成，配置关闭时回退独立登录页 */
async function openLogin() {
  const opened = await authDialog.open({ mode: 'login' })
  if (!opened) router.push({ name: 'login' })
}
</script>

<template>
  <div class="cl-page">
    <header class="cl-topbar">
      <router-link class="cl-brand" :to="{ name: 'editor' }" title="返回编辑器">
        <span class="cl-logo ed-brand-block"><SvgIcon name="layout" :size="15" /></span>
        <span class="cl-name">简历工坊</span>
      </router-link>
      <span class="cl-chip">简历合集</span>

      <div class="spacer"></div>

      <template v-if="auth.status.value === 'authed'">
        <span class="cl-user" :title="`已登录：${auth.user.value?.username}`">
          <SvgIcon name="user" :size="13" />
          <span>{{ auth.user.value?.username }}</span>
        </span>
        <router-link class="ed-btn ed-btn-primary" :to="{ name: 'editor' }">
          <SvgIcon name="text" :size="14" />
          <span>进入编辑器</span>
        </router-link>
      </template>
      <button v-else class="ed-btn ed-btn-primary" @click="openLogin">
        <SvgIcon name="user" :size="14" />
        <span>登录 / 注册</span>
      </button>
    </header>

    <main class="cl-main">
      <section class="cl-hero">
        <h1 class="cl-title">简历合集</h1>
        <p class="cl-sub">来自用户公开分享的真实简历，点击卡片查看详情、打印或导入为自己的底稿。</p>
        <p v-if="state === 'ready' && total > 0" class="cl-count">共收录 {{ total }} 份</p>
      </section>

      <!-- 分类筛选条：分享入库时已按求职意向自动归类 -->
      <div
        v-if="state === 'ready' && catOptions.length > 1"
        class="cl-cats"
        role="group"
        aria-label="按求职方向筛选"
      >
        <button
          v-for="cat in catOptions"
          :key="cat.key"
          class="cl-cat"
          :class="{ 'is-active': cat.key === activeCategory }"
          :aria-pressed="cat.key === activeCategory"
          @click="pickCategory(cat.key)"
        >
          <span>{{ cat.label }}</span>
          <span class="cl-cat-count">{{ cat.count }}</span>
        </button>
      </div>

      <div v-if="state === 'loading'" class="cl-grid" aria-hidden="true">
        <div v-for="i in 8" :key="i" class="cl-skeleton"></div>
      </div>

      <div v-else-if="state === 'error'" class="cl-state">
        <p class="cl-state-text">{{ errorMessage }}</p>
        <button class="ed-btn" @click="load">
          <SvgIcon name="refresh" :size="14" />
          <span>重试</span>
        </button>
      </div>

      <template v-else>
        <div v-if="total === 0" class="cl-state">
          <SvgIcon class="cl-empty-icon" name="layout" :size="26" />
          <p class="cl-state-text">还没有简历进入合集</p>
          <p class="cl-state-hint">
            在编辑器里点「分享」并勾选「展示到简历合集」，你的简历就会出现在这里。
          </p>
          <router-link class="ed-btn ed-btn-primary" :to="{ name: 'editor' }">
            <SvgIcon name="text" :size="14" />
            <span>去创建我的简历</span>
          </router-link>
        </div>

        <div v-else class="cl-grid">
          <CollectionCard v-for="item in items" :key="item.id" :item="item" />

          <!-- 游客锁板：服务端只下发了前若干条，其余登录后解锁 -->
          <div v-if="lockedCount > 0" class="cl-lock">
            <span class="cl-lock-badge"><SvgIcon name="lock" :size="16" /></span>
            <p class="cl-lock-title">还有 {{ lockedCount }} 份简历未展示</p>
            <p class="cl-lock-desc">登录后即可浏览合集全部内容</p>
            <button class="ed-btn ed-btn-primary" @click="openLogin">
              <SvgIcon name="user" :size="14" />
              <span>登录 / 注册</span>
            </button>
          </div>
        </div>

        <div v-if="hasMore" class="cl-more">
          <button class="ed-btn" :disabled="loadingMore" @click="loadMore">
            <SvgIcon name="down" :size="14" />
            <span>{{ loadingMore ? '加载中…' : '加载更多' }}</span>
          </button>
        </div>

        <p v-if="total > 0" class="cl-foot">
          想把自己的简历放进合集？在编辑器中点「分享」并勾选「展示到简历合集」。
        </p>
      </template>
    </main>

    <footer class="cl-footer">
      <div class="cl-footer-main">
        <div class="cl-footer-brand">
          <div class="cl-footer-logo">
            <span class="cl-logo ed-brand-block"><SvgIcon name="layout" :size="14" /></span>
            <span class="cl-footer-name">简历工坊</span>
          </div>
          <p class="cl-footer-desc">
            本地优先的在线简历编辑器：左侧编辑、右侧实时纸张预览， 支持主题模板定制与多格式导出。
          </p>
        </div>

        <nav class="cl-footer-col" aria-label="快速开始">
          <h4>快速开始</h4>
          <router-link :to="{ name: 'editor' }">在线编辑</router-link>
          <router-link :to="{ name: 'collection' }">简历合集</router-link>
          <router-link :to="{ name: 'login' }">登录 / 注册</router-link>
        </nav>

        <div class="cl-footer-col">
          <h4>导出格式</h4>
          <span>矢量 PDF（文本可选中）</span>
          <span>Markdown / 纯文本（ATS 友好）</span>
          <span>JSON 数据备份</span>
        </div>

        <div class="cl-footer-col">
          <h4>数据与隐私</h4>
          <span>不登录也可完整使用，数据存本机浏览器</span>
          <span>注册后云端同步，跨设备继续编辑</span>
          <span>分享链接 30 天自动失效，可随时撤销</span>
        </div>
      </div>
      <div class="cl-footer-bar">
        <span>© {{ year }} 简历工坊</span>
        <span>本地优先 · 数据存浏览器 · 注册后云端同步</span>
      </div>
    </footer>

    <AuthDialog />
  </div>
</template>

<style scoped>
.cl-page {
  min-height: 100vh;
  /* 官网页面底色与编辑器舞台同一套画布令牌：晕光随主题色联动 */
  background: var(--ed-canvas);
}

.cl-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--ed-line-soft);
  background: var(--ed-surface);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
}

.cl-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.cl-logo.ed-brand-block {
  width: 28px;
  height: 28px;
}

.cl-name {
  color: var(--ed-ink);
  font-size: 15px;
  font-weight: 700;
}

.cl-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ed-fill);
  color: var(--ed-text-2);
  font-size: 12px;
  white-space: nowrap;
}

.spacer {
  flex: 1 1 auto;
}

.cl-user {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  padding: 7px 4px;
  color: var(--ed-text-2);
  font-size: 12.5px;
}

.cl-user span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cl-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 34px 24px 60px;
}

.cl-hero {
  margin-bottom: 24px;
}

.cl-title {
  margin: 0 0 8px;
  color: var(--ed-ink);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.cl-sub {
  margin: 0;
  max-width: 560px;
  color: var(--ed-text-2);
  font-size: 13.5px;
  line-height: 1.7;
}

.cl-count {
  margin: 10px 0 0;
  color: var(--ed-text-4);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

/* 分类筛选条：胶囊按钮，选中态走品牌令牌（默认黑） */
.cl-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.cl-cat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--ed-line-soft);
  border-radius: 999px;
  background: var(--ed-surface);
  color: var(--ed-text-2);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
}

.cl-cat:hover {
  border-color: var(--ed-brand-border);
  color: var(--ed-ink);
}

.cl-cat.is-active {
  border-color: var(--ed-brand-border);
  background: var(--ed-brand-tint);
  color: var(--ed-brand-deep);
  font-weight: 600;
}

.cl-cat-count {
  color: var(--ed-text-4);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.cl-cat.is-active .cl-cat-count {
  color: var(--ed-brand-deep);
}

.cl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px;
}

/* 骨架屏：合集加载期间的占位卡片 */
.cl-skeleton {
  aspect-ratio: 210 / 340;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-xl);
  background: linear-gradient(100deg, var(--ed-fill) 40%, var(--ed-fill-2) 50%, var(--ed-fill) 60%);
  background-size: 200% 100%;
  animation: cl-shimmer 1.2s infinite;
}

/*
 * 骨架屏的扫光是无限动画，属于「动效必须让路」的那一类：
 * 用户明确要求减少动态效果时，静止的灰底已经足够表达「正在加载」，
 * 继续扫光只会让人不适（前庭敏感人群对持续的横向移动尤其敏感）。
 * 编辑器里的卡片闪烁、验证码等各处也遵循同一约定。
 */
@media (prefers-reduced-motion: reduce) {
  .cl-skeleton {
    animation: none;
  }
}

@keyframes cl-shimmer {
  from {
    background-position: 120% 0;
  }

  to {
    background-position: -80% 0;
  }
}

.cl-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 20px;
  border: 1px dashed var(--ed-line-soft);
  border-radius: var(--ed-radius-xl);
  background: var(--ed-surface);
  text-align: center;
}

.cl-empty-icon {
  color: var(--ed-text-4);
}

.cl-state-text {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.cl-state-hint {
  margin: 0;
  max-width: 420px;
  color: var(--ed-text-3);
  font-size: 12.5px;
  line-height: 1.7;
}

/* 游客锁板：与卡片同高，视觉上是「列表在这里被截断」 */
.cl-lock {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 320px;
  padding: 20px;
  border: 1px dashed var(--ed-brand-border);
  border-radius: var(--ed-radius-xl);
  background: var(--ed-fill-2);
  text-align: center;
}

.cl-lock-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--ed-brand-tint);
  color: var(--ed-brand-strong);
}

.cl-lock-title {
  margin: 0;
  color: var(--ed-ink);
  font-size: 14px;
  font-weight: 600;
}

.cl-lock-desc {
  margin: 0 0 10px;
  color: var(--ed-text-3);
  font-size: 12.5px;
}

.cl-more {
  display: flex;
  justify-content: center;
  margin-top: 22px;
}

.cl-foot {
  margin: 34px 0 0;
  color: var(--ed-text-4);
  font-size: 12.5px;
  text-align: center;
}

/* ---------------- 官网式页尾 ---------------- */

.cl-footer {
  margin-top: 64px;
  border-top: 1px solid var(--ed-line-soft);
  background: var(--ed-surface);
}

.cl-footer-main {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1.2fr 1.2fr;
  gap: 28px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 36px 24px 30px;
}

.cl-footer-logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cl-footer-name {
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 700;
}

.cl-footer-desc {
  margin: 12px 0 0;
  max-width: 300px;
  color: var(--ed-text-3);
  font-size: 12.5px;
  line-height: 1.7;
}

.cl-footer-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cl-footer-col h4 {
  margin: 0 0 2px;
  color: var(--ed-ink);
  font-size: 13px;
  font-weight: 600;
}

.cl-footer-col a {
  width: fit-content;
  color: var(--ed-text-2);
  font-size: 12.5px;
  text-decoration: none;
}

.cl-footer-col a:hover {
  color: var(--ed-brand-strong);
}

.cl-footer-col span {
  color: var(--ed-text-3);
  font-size: 12.5px;
  line-height: 1.6;
}

.cl-footer-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 16px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 14px 24px;
  border-top: 1px solid var(--ed-line-soft);
  color: var(--ed-text-4);
  font-size: 12px;
}

@media (max-width: 900px) {
  .cl-footer-main {
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
}

@media (max-width: 640px) {
  .cl-main {
    padding: 24px 14px 44px;
  }

  .cl-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }

  .cl-title {
    font-size: 22px;
  }

  .cl-footer-main {
    grid-template-columns: 1fr;
    gap: 22px;
    padding: 28px 14px 24px;
  }

  .cl-footer-bar {
    padding: 12px 14px;
  }
}
</style>
