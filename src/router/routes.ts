import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表（纯配置，不依赖浏览器）。
 *
 * 刻意与 `router/index.js` 分开：`createRouter(createWebHistory(...))` 在模块求值时
 * 就会读 `location`，于是想对「哪条路径对应哪个页面」写单测时，必须先造浏览器环境，
 * 而测试框架的 import 提升会让桩总是晚一步。把路由表抽出来后，它就是一个普通数组，
 * 测试可以直接断言，浏览器相关的东西留在 index.js 里。
 *
 * 首页（/）是产品介绍，编辑器在 /editor。「打开即编辑」由首页的 CTA 承担，
 * 因此入口并没有变难找；而把编辑器让出来，首页才能讲清产品是什么。
 *
 * 标成 `RouteRecordRaw[]` 之后，`name` 写错、`path` 拼错这类问题会在
 * 类型层面暴露 —— 而它正是 `tests/renderTarget.test.js` 依赖的那个契约
 * （`EDITOR_PATH` 必须命中名为 editor 的路由）。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/HomePage.vue'),
  },
  {
    path: '/editor',
    name: 'editor',
    component: () => import('@/pages/EditorPage.vue'),
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
  },
  {
    // 分享只读页：拿链接的人无需登录
    path: '/share/:id',
    name: 'share',
    component: () => import('@/pages/SharePage.vue'),
  },
  {
    // 简历合集：游客可见前若干份，登录后解锁全部
    path: '/collection',
    name: 'collection',
    component: () => import('@/pages/CollectionPage.vue'),
  },
  {
    // 管理后台：仅管理员（页面内做登录与权限门卫）
    path: '/admin',
    name: 'admin',
    component: () => import('@/pages/AdminPage.vue'),
  },
  // 单页应用没有其他深层链接：未知路径回首页，而不是把陌生人直接丢进编辑器
  { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
]
