import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/** PDF 渲染服务端口，需与 server/index.js 的 PORT 保持一致 */
const PDF_PORT = process.env.PDF_PORT || 3001

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 前端与 PDF 服务在本地分开跑，走代理避免跨域配置
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${PDF_PORT}`,
    },
  },
  preview: {
    proxy: {
      '/api': `http://127.0.0.1:${PDF_PORT}`,
    },
  },
})
