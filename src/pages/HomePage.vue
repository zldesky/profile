<script setup lang="ts">
/**
 * 产品首页（官网）。
 *
 * 视觉走「克制文档型」：白底、细分割线、大量留白、近乎不用色块，
 * 靠排版层级建立专业感，与编辑器本身的克制风格一致 —— 首页和产品不该是两种气质。
 *
 * 关于首屏那个「纸」：它用的是与编辑器、分享页完全相同的渲染管线
 * （同一份模板组件 + paper.css），不是插画也不是截图。让产品自己当主视觉，
 * 比任何示意图都诚实，改动模板时首页也跟着更新。
 *
 * 文案只写能兑现的事（12 个模板、4 类模块、矢量 PDF 等都有对应实现），
 * 不写「赋能 / 一键提升 / 智能化」这类无法验收的话。
 */
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { MM_TO_PX, PAGE, TEMPLATES } from '@/data/presets'
import { resolveTemplate } from '@/templates'
import { computePageStyle } from '@/utils/resumeStyle'
import { createResume } from '@/data/defaultResume'

/** 首屏与模板区都用真实模板渲染，这里只做缩放适配 */
const HEIGHT_PX = 470
const previewRef = useTemplateRef('previewRef')
const zoom = shallowRef(0)

const demo = shallowRef(createResume())
const templateComponent = computed(() => resolveTemplate(demo.value.template))
const pageStyle = computed(() => ({ ...computePageStyle(demo.value), '--zoom': zoom.value }))

const TEMPLATE_NAMES = ['经典单栏', '左侧色栏', '双栏紧凑', '时间轴', '极简留白', '通栏色带']

/** 按目标高度反算缩放，避免首屏那块纸跟着视口宽度乱跳 */
function fit() {
  const el = previewRef.value
  if (!el) return
  const byHeight = HEIGHT_PX / (PAGE.height * MM_TO_PX)
  const byWidth = el.clientWidth / (PAGE.width * MM_TO_PX)
  zoom.value = Math.max(0.1, Math.min(byHeight, byWidth))
}

/*
 * 显式标类型 + 判空：`let observer = null` 在 TS 下推成 any，
 * 且 previewRef.value 在挂载前是 null（observe 会抛）。
 */
let observer: ResizeObserver | null = null
onMounted(() => {
  const el = previewRef.value
  if (!el) return
  observer = new ResizeObserver(fit)
  observer.observe(el)
  fit()
})
onBeforeUnmount(() => observer?.disconnect())

const CAPABILITIES = [
  {
    icon: 'text',
    title: '纸上所见即所得',
    body: '所有改动立刻反映在右侧 A4 纸上，排版、分页、边距都在同一处呈现，不必导出后才发现问题。',
  },
  {
    icon: 'layout',
    title: '12 个模板与自由布局',
    body: '单栏、左右分栏、时间轴、色带等 12 套版式；也能自己调模块顺序、左右缩进与纵向间距。',
  },
  {
    icon: 'print',
    title: '矢量 PDF 与 ATS 文本',
    body: '导出的 PDF 是矢量、文字可选中可检索；另有 Markdown 与纯文本输出，便于投递到招聘系统。',
  },
  {
    icon: 'lock',
    title: '本地优先，不登录也能用',
    body: '简历存在你自己的浏览器里，随时导出 JSON 备份；注册后可选云端同步，换设备继续编辑。',
  },
  {
    icon: 'download',
    title: 'PDF 简历反向导入',
    body: '把已有的文字版 PDF 拖进来，按模块标题与时间段还原成可编辑内容，不必从头重录。',
  },
  {
    icon: 'sparkles',
    title: '自带模型 Key 的 AI 助手',
    body: '接你自己的 OpenAI 兼容服务，用于润色措辞与对照 JD 找差距；Key 只存本机，不经服务器留存。',
  },
]
</script>

<template>
  <div class="home">
    <header class="hm-header">
      <div class="hm-wrap hm-header-inner">
        <router-link class="hm-brand" :to="{ name: 'home' }" title="简历工坊首页">
          <span class="hm-logo ed-brand-block"><SvgIcon name="layout" :size="16" /></span>
          <span class="hm-brand-name">简历工坊</span>
        </router-link>

        <nav class="hm-nav">
          <a class="hm-nav-link" href="#capabilities">功能</a>
          <a class="hm-nav-link" href="#templates">模板</a>
          <router-link class="hm-nav-link" :to="{ name: 'collection' }">简历合集</router-link>
          <router-link class="ed-btn hm-cta" :to="{ name: 'editor' }">开始写简历</router-link>
        </nav>
      </div>
    </header>

    <main>
      <!-- 首屏：左文案右真实纸面 -->
      <section class="hm-wrap hm-hero">
        <div class="hm-hero-copy">
          <p class="hm-eyebrow">浏览器内运行 · 无需安装</p>
          <h1 class="hm-title">把简历当成文档来写</h1>
          <p class="hm-lede">
            左侧编辑，右侧就是最终的那张 A4 纸。改一个字、换一套模板、调一次间距，
            分页与观感当场可见，导出的 PDF 与你看到的一致。
          </p>

          <div class="hm-actions">
            <router-link class="ed-btn ed-btn-primary hm-btn-lg" :to="{ name: 'editor' }">
              开始写简历
            </router-link>
            <router-link class="ed-btn hm-btn-lg" :to="{ name: 'collection' }">
              看别人的简历
            </router-link>
          </div>

          <dl class="hm-facts">
            <div>
              <dt>12</dt>
              <dd>套版式模板</dd>
            </div>
            <div>
              <dt>4</dt>
              <dd>类内容模块</dd>
            </div>
            <div>
              <dt>0</dt>
              <dd>必需注册</dd>
            </div>
          </dl>
        </div>

        <div ref="previewRef" class="hm-hero-paper">
          <div
            class="paper hm-paper"
            :style="pageStyle"
            :data-tstyle="demo.theme.titleStyle"
            :data-marker="demo.theme.titleMarker"
            :data-line="demo.theme.titleBottom"
            :data-shape="demo.basics.avatarShape"
          >
            <component :is="templateComponent" :resume="demo" :selected-ids="[]" />
          </div>
        </div>
      </section>

      <!-- 能力 -->
      <section id="capabilities" class="hm-wrap hm-section">
        <h2 class="hm-h2">它具体做什么</h2>
        <p class="hm-sub">每条都对应编辑器里可操作的功能，不是规划中的设想。</p>

        <ul class="hm-caps">
          <li v-for="cap in CAPABILITIES" :key="cap.title" class="hm-cap">
            <span class="hm-cap-icon"><SvgIcon :name="cap.icon" :size="15" /></span>
            <h3 class="hm-cap-title">{{ cap.title }}</h3>
            <p class="hm-cap-body">{{ cap.body }}</p>
          </li>
        </ul>
      </section>

      <!-- 模板 -->
      <section id="templates" class="hm-wrap hm-section">
        <h2 class="hm-h2">换模板不用重排内容</h2>
        <p class="hm-sub">
          版式只决定「怎么排」，内容与结构始终是同一份数据，切换后不用重新调整格式。
        </p>

        <ul class="hm-templates">
          <li v-for="name in TEMPLATE_NAMES" :key="name" class="hm-template">
            <span class="hm-template-name">{{ name }}</span>
          </li>
          <li class="hm-template is-more">
            <router-link :to="{ name: 'editor' }"
              >其余 {{ TEMPLATES.length - 6 }} 套在编辑器里 →</router-link
            >
          </li>
        </ul>
      </section>

      <!-- 收尾 CTA -->
      <section class="hm-closing">
        <div class="hm-wrap hm-closing-inner">
          <h2 class="hm-h2">现在就能开始</h2>
          <p class="hm-sub">打开即用，不登录也能写完整份简历并导出。</p>
          <router-link class="ed-btn ed-btn-primary hm-btn-lg" :to="{ name: 'editor' }">
            打开编辑器
          </router-link>
        </div>
      </section>
    </main>

    <footer class="hm-footer">
      <div class="hm-wrap hm-footer-inner">
        <span class="hm-footer-brand">简历工坊</span>
        <span class="hm-footer-note">本地优先的简历编辑器 · 数据留在你自己的浏览器里</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/*
 * 克制文档型：单列阅读宽度、细线分隔、几乎不着色。
 * 版式参数集中在这里，改一处就能整体收紧或放宽。
 */
.home {
  --hm-max: 1080px;
  --hm-line: var(--ed-line-soft);

  min-height: 100vh;
  background: var(--ed-surface);
  color: var(--ed-ink);
}

.hm-wrap {
  max-width: var(--hm-max);
  margin: 0 auto;
  padding: 0 24px;
}

/* ---------------- 顶栏 ---------------- */

.hm-header {
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--hm-line);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(8px);
}

.hm-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 60px;
}

.hm-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ed-ink);
  text-decoration: none;
}

.hm-logo {
  width: 28px;
  height: 28px;
}

.hm-brand-name {
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.hm-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.hm-nav-link {
  padding: 6px 10px;
  border-radius: var(--ed-radius-sm);
  color: var(--ed-text-2);
  font-size: 13px;
  text-decoration: none;
}

.hm-nav-link:hover {
  background: var(--ed-fill);
  color: var(--ed-ink);
}

.hm-cta {
  margin-left: 6px;
}

/* ---------------- 首屏 ---------------- */

.hm-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  align-items: center;
  gap: 56px;
  padding-top: 72px;
  padding-bottom: 72px;
}

/* 小号大写标签：文档型版式的常见处理，比彩色徽章克制得多 */
.hm-eyebrow {
  margin: 0 0 14px;
  color: var(--ed-text-3);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hm-title {
  margin: 0 0 16px;
  color: var(--ed-ink);
  font-size: 42px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.hm-lede {
  max-width: 46ch;
  margin: 0 0 28px;
  color: var(--ed-text-2);
  font-size: 15px;
  line-height: 1.75;
}

.hm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 36px;
}

.hm-btn-lg {
  padding: 9px 18px;
  font-size: 13.5px;
}

.hm-facts {
  display: flex;
  gap: 32px;
  margin: 0;
  padding-top: 22px;
  border-top: 1px solid var(--hm-line);
}

.hm-facts dt {
  color: var(--ed-ink);
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.hm-facts dd {
  margin: 2px 0 0;
  color: var(--ed-text-3);
  font-size: 12px;
}

/* 首屏那张纸：与分享页同一套阴影，让它读起来是「一张纸」而不是一张图 */
.hm-hero-paper {
  display: flex;
  justify-content: center;
  overflow: hidden;
  padding: 22px;
  border: 1px solid var(--hm-line);
  border-radius: var(--ed-radius-lg);
  background: var(--ed-fill-2);
}

.hm-paper {
  flex: 0 0 auto;
  box-shadow: var(--ed-paper-shadow);
}

.hm-paper :deep(*) {
  pointer-events: none;
}

/* 首页的纸只当主视觉，不做交互，也不需要编辑态的那些外框 */

/* ---------------- 区块 ---------------- */

.hm-section {
  padding-top: 64px;
  padding-bottom: 64px;
  border-top: 1px solid var(--hm-line);
}

.hm-h2 {
  margin: 0 0 8px;
  color: var(--ed-ink);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.hm-sub {
  max-width: 60ch;
  margin: 0 0 32px;
  color: var(--ed-text-2);
  font-size: 14px;
  line-height: 1.7;
}

/* ---------------- 能力 ---------------- */

.hm-caps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1px;
  /* 用 1px 间隙 + 背景色画分隔线，比每个格子各加边框更不容易错位 */
  margin: 0;
  padding: 0;
  border: 1px solid var(--hm-line);
  background: var(--hm-line);
  list-style: none;
}

.hm-cap {
  padding: 22px 22px 24px;
  background: var(--ed-surface);
}

.hm-cap-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-bottom: 12px;
  border: 1px solid var(--ed-line-2);
  border-radius: var(--ed-radius-sm);
  color: var(--ed-text-2);
}

.hm-cap-title {
  margin: 0 0 6px;
  color: var(--ed-ink);
  font-size: 14.5px;
  font-weight: 600;
}

.hm-cap-body {
  margin: 0;
  color: var(--ed-text-2);
  font-size: 13px;
  line-height: 1.7;
}

/* ---------------- 模板 ---------------- */

.hm-templates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hm-template {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--ed-line);
  border-radius: var(--ed-radius-md);
  background: var(--ed-surface);
  font-size: 13.5px;
}

.hm-template.is-more {
  border-style: dashed;
  color: var(--ed-text-3);
}

/*
 * 文字链接的可点区域只有 22px 高，低于 24px 的最小点击目标（实测报出）。
 * 不用绝对定位的透明伪元素去「扩命中区」—— 试过，它没被算进可点区域，
 * 反而因为超出盒子把 scrollWidth 撑大，被审计当成文本溢出。
 * 直接让链接自己成为 flex 项并给足最小高度，命中区与观感同时成立。
 */
.hm-template.is-more a {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  color: inherit;
  text-decoration: none;
}

.hm-template.is-more a:hover {
  color: var(--ed-brand-strong);
}

/* ---------------- 收尾 ---------------- */

.hm-closing {
  border-top: 1px solid var(--hm-line);
  background: var(--ed-fill-2);
}

.hm-closing-inner {
  padding-top: 56px;
  padding-bottom: 56px;
}

/* ---------------- 页脚 ---------------- */

.hm-footer {
  border-top: 1px solid var(--hm-line);
}

.hm-footer-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 22px;
  padding-bottom: 22px;
}

.hm-footer-brand {
  color: var(--ed-text-2);
  font-size: 13px;
  font-weight: 600;
}

.hm-footer-note {
  color: var(--ed-text-3);
  font-size: 12.5px;
}

/* ---------------- 窄屏 ---------------- */

@media (max-width: 900px) {
  /* 首屏改为单列：纸放在文案下方，保证标题不被压窄到折行难看 */
  .hm-hero {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
    padding-top: 44px;
    padding-bottom: 48px;
  }

  .hm-title {
    font-size: 32px;
  }

  .hm-hero-paper {
    padding: 16px;
  }

  /* 顶栏导航在手机上只留主 CTA，其余收进页脚 */
  .hm-nav-link {
    display: none;
  }

  .hm-section {
    padding-top: 44px;
    padding-bottom: 44px;
  }

  .hm-h2 {
    font-size: 21px;
  }
}

@media (max-width: 480px) {
  .hm-title {
    font-size: 27px;
  }

  .hm-actions .ed-btn {
    flex: 1 1 auto;
    justify-content: center;
  }
}
</style>
