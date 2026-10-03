<script setup>
/**
 * 应用外壳：路由出口 + 全局轻提示。
 *
 * 编辑器页面与登录页都挂在 router 上；toast 是模块级单例，
 * 放在壳层保证任何页面都能弹。
 * 应用启动时先向服务端确认一次会话（useAuth.init），登录态影响
 * 编辑器的云端同步与顶栏账号区。
 */
import { watch } from 'vue'

import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'
import { useResumeStore } from '@/stores/resume'
import { applyChromeAccent } from '@/utils/helpers'

const { message, visible } = useToast()
useAuth().init()

// 界面主题与简历配色联动：设计面板换主色，外壳的品牌色令牌随之整体重算。
// 挂在壳层（而不是编辑器页）是为了让登录页也跟随同一主题。
const store = useResumeStore()
watch(
  () => store.resume.theme.accent,
  (accent) => applyChromeAccent(accent),
  { immediate: true },
)
</script>

<template>
  <router-view />

  <div class="editor-toast" :class="{ 'is-visible': visible }">{{ message }}</div>
</template>
