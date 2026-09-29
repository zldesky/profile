import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * 独立于 vite.config.js：测试跑在 Node 里，不需要 Vue 插件，
 * 只要保证 @ 别名与源码一致（sanitize/db 等纯逻辑模块均可在 Node 下直测）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
