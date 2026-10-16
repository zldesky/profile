import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * 独立于 vite.config.js：测试跑在 Node 里，不需要完整 DOM 环境，
 * Vue 插件只负责转换模板注册表等测试用到的 .vue 单文件组件。
 * 只要保证 @ 别名与源码一致（sanitize/db 等纯逻辑模块均可在 Node 下直测）。
 *
 * 注意：这里刻意不配 setupFiles 去全局安装 document —— pdf.js 会据此判定自己跑在
 * 浏览器里，进而按 URL 解析 worker 文件，让 tests/pdfImportE2E.test.js 失败。
 * 需要浏览器 API 的测试（stores/resume）自己用 tests/setup/browser-globals.js
 * 成对开关，见该文件说明。
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
