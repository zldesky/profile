<script setup lang="ts">
/**
 * 登录 / 注册页（独立路由版）。
 *
 * 表单本体抽在 AuthPanel（编辑器内的弹窗交互见 AuthDialog），这里只负责「页面框架」：
 * 左侧讲清登录能得到什么，右侧放表单。
 *
 * 为什么改成左右分栏：原来是一个 380px 的卡片孤零零浮在点阵背景上 —— 干净，但
 * 看不出这是什么产品、登录有什么好处，对「企业级官网」来说偏单薄。首页已经把
 * 产品讲清楚了，登录页应当接着那套说法，而不是退回一个没有上下文的表单。
 *
 * 视觉与首页同一套：白底、细分割线、大量留白、近乎不用色块。
 * 数据留在本机这件事在首页是卖点，在这里更要说 —— 它正是「要不要注册」的答案。
 */
import { watch } from 'vue'
import { useRouter } from 'vue-router'

import AuthPanel from '@/components/AuthPanel.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useAuth } from '@/composables/useAuth'

const router = useRouter()
const auth = useAuth()

watch(
  auth.status,
  (value) => {
    if (value === 'authed') router.replace({ name: 'editor' })
  },
  { immediate: true },
)

/** 登录后才有的能力。写具体的，不写「解锁更多可能」这类空话。 */
const BENEFITS = [
  '简历自动同步到服务端，换设备继续编辑',
  '生成分享链接，可选展示到简历合集',
  '一键导出矢量 PDF（文本可选中、可检索）',
]

/**
 * 明确告知不登录也能用 —— 这是减少注册顾虑的关键一句。
 * 只写「差别在哪」，不复述表单里已经说过的「不登录也能用本地编辑与打印导出」，
 * 否则同一句话在屏幕上出现两次。
 */
const NO_ACCOUNT =
  '上面三项都需要账号；其余功能（本地编辑、模板切换、打印导出）无需注册，数据只存在你自己的浏览器里。'
</script>

<template>
  <div class="auth-page">
    <header class="auth-top">
      <router-link class="auth-top-brand" :to="{ name: 'home' }" title="返回首页">
        <span class="auth-top-logo ed-brand-block"><SvgIcon name="layout" :size="15" /></span>
        <span class="auth-top-name">简历工坊</span>
      </router-link>
    </header>

    <main class="auth-main">
      <!-- 左：为什么登录 -->
      <section class="auth-pitch">
        <p class="auth-eyebrow">账号</p>
        <h1 class="auth-title">登录后简历跟着你走</h1>
        <p class="auth-lede">
          同一个账号在任何设备上继续编辑同一份简历，也可以把满意的作品分享出去。
        </p>

        <ul class="auth-benefits">
          <li v-for="benefit in BENEFITS" :key="benefit">
            <SvgIcon name="check" :size="13" />
            <span>{{ benefit }}</span>
          </li>
        </ul>

        <p class="auth-note">{{ NO_ACCOUNT }}</p>

        <div class="auth-links">
          <router-link :to="{ name: 'editor' }">先去写简历</router-link>
          <span class="auth-dot">·</span>
          <router-link :to="{ name: 'collection' }">看看别人的简历</router-link>
        </div>
      </section>

      <!-- 右：表单 -->
      <section class="auth-form">
        <AuthPanel @authed="router.replace({ name: 'editor' })" />
      </section>
    </main>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--ed-surface);
  color: var(--ed-ink);
}

.auth-top {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--ed-line-soft);
}

.auth-top-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 60px;
  margin-left: 24px;
  color: var(--ed-ink);
  text-decoration: none;
}

.auth-top-logo {
  width: 26px;
  height: 26px;
}

.auth-top-name {
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.auth-main {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr) 400px;
  align-items: center;
  gap: 64px;
  width: 100%;
  max-width: 1020px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

/* ---------------- 左栏 ---------------- */

.auth-eyebrow {
  margin: 0 0 14px;
  color: var(--ed-text-3);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.auth-title {
  margin: 0 0 14px;
  font-size: 32px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.auth-lede {
  max-width: 42ch;
  margin: 0 0 24px;
  color: var(--ed-text-2);
  font-size: 14.5px;
  line-height: 1.75;
}

.auth-benefits {
  margin: 0 0 22px;
  padding: 0;
  list-style: none;
}

.auth-benefits li {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 11px;
  color: var(--ed-text-2);
  font-size: 13.5px;
  line-height: 1.6;
}

.auth-benefits :deep(svg) {
  flex: 0 0 auto;
  margin-top: 3px;
  color: var(--ed-brand-strong);
}

/* 「不登录也能用」用一条细竖线引出，比做成提示框更克制 */
.auth-note {
  max-width: 44ch;
  margin: 0 0 24px;
  padding-left: 12px;
  border-left: 2px solid var(--ed-line-2);
  color: var(--ed-text-3);
  font-size: 12.5px;
  line-height: 1.7;
}

.auth-links {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

/*
 * 两个文字链接的盒子只有 21px 高，低于 24px 的最小点击目标（实测报出）。
 * 直接给链接足够高度，而不是用绝对定位伪元素去扩命中区 ——
 * 后者在首页试过：命中区没扩成，反而因超出盒子把 scrollWidth 撑大、被判成文本溢出。
 */
.auth-links a {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  color: var(--ed-text-2);
  text-decoration: none;
}

.auth-links a:hover {
  color: var(--ed-brand-strong);
}

.auth-dot {
  color: var(--ed-text-4);
}

/* ---------------- 右栏 ---------------- */

/*
 * 表单区用浅底 + 细边框圈出来，而不是浮一个带大阴影的卡片。
 * 分栏布局里再叠重阴影会显得两块内容在争，浅底更安分。
 */
.auth-form {
  padding: 26px 24px 24px;
  border: 1px solid var(--ed-line-soft);
  border-radius: var(--ed-radius-xl);
  background: var(--ed-fill-2);
}

/* ---------------- 窄屏 ---------------- */

@media (max-width: 900px) {
  /* 单列：文案在上、表单在下。表单是主角，所以不再压缩留白 */
  .auth-main {
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
    padding: 28px 20px 48px;
  }

  .auth-top-brand {
    margin-left: 20px;
  }

  .auth-title {
    font-size: 25px;
  }

  .auth-benefits {
    margin-bottom: 18px;
  }
}

@media (max-width: 480px) {
  .auth-title {
    font-size: 22px;
  }

  .auth-form {
    padding: 20px 16px 18px;
  }
}
</style>
