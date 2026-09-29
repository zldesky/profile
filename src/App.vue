<script setup>
/**
 * 应用外壳：路由出口 + 全局轻提示。
 *
 * 编辑器页面与登录页都挂在 router 上；toast 是模块级单例，
 * 放在壳层保证任何页面都能弹。
 * 应用启动时先向服务端确认一次会话（useAuth.init），登录态影响
 * 编辑器的云端同步与顶栏账号区。
 */
import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'

const { message, visible } = useToast()
useAuth().init()
</script>

<template>
  <router-view />

  <div class="editor-toast" :class="{ 'is-visible': visible }">{{ message }}</div>
</template>
