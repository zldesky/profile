import { createRouter, createWebHistory } from 'vue-router'

import { routes } from './routes.js'

/**
 * 编辑器本身不强制登录：匿名用户是「纯本地模式」，登录只是解锁
 * 云端同步与一键导出，因此路由层不做登录守卫，只把 /login 挡在已登录者之外。
 *
 * 路由表在 routes.js（纯配置，可在 Node 里直接断言）；本文件只负责把它接到
 * 浏览器 history 上。这样拆是因为 createWebHistory 在模块求值时就读 location，
 * 测试框架的 import 提升会让桩总是晚一步 —— 详见 routes.js 顶部注释。
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
