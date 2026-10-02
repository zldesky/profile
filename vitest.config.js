import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * 独立于 vite.config.js：测试跑在 Node 里，不需要 DOM 环境，
 * Vue 插件只负责转换模板注册表等测试用到的 .vue 单文件组件。
 * 只要保证 @ 别名与源码一致（sanitize/db 等纯逻辑模块均可在 Node 下直测）。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
