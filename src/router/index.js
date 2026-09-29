import { createRouter, createWebHistory } from 'vue-router'

/**
 * 编辑器本身不强制登录：匿名用户是「纯本地模式」，登录只是解锁
 * 云端同步与一键导出，因此路由层不做登录守卫，只把 /login 挡在已登录者之外。
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'editor',
      component: () => import('@/pages/EditorPage.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
    },
    // 单页应用没有其他深层链接，未知路径一律回编辑器
    { path: '/:pathMatch(.*)*', redirect: { name: 'editor' } },
  ],
})

export default router
