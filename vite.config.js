import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/** PDF 渲染服务端口，需与 server/index.js 的 PORT 保持一致 */
const PDF_PORT = process.env.PDF_PORT || 3001

/**
 * 给 favicon 的 URL 挂上内容哈希，例如 /favicon.ico?v=1c3a6e1f。
 *
 * 为什么必须这么做：Chromium 把网站图标单独存在 Favicons 数据库里，往往无视
 * HTTP 缓存指令（服务端只发 ETag、nginx 的 no-cache 都不管用），于是「重新打包
 * 部署后浏览器仍是旧图标，普通刷新甚至清缓存都不生效」。让 URL 随内容变化是唯一
 * 可靠的办法：URL 一变，浏览器就当新资源去取，旧记录自然被替换。
 *
 * 这也和 /assets/ 下带哈希指纹的产物是同一个思路，只是 public/ 下的文件不经过
 * Vite 的哈希流程，所以在这里补上。哈希由构建时读取文件内容算出，不需要手工维护版本号。
 */
function faviconCacheBust() {
  return {
    name: 'favicon-cache-bust',
    enforce: 'post',
    transformIndexHtml(html) {
      const iconPath = fileURLToPath(new URL('./public/favicon.ico', import.meta.url))
      let hash
      try {
        hash = createHash('sha256').update(readFileSync(iconPath)).digest('hex').slice(0, 8)
      } catch {
        // 图标缺失不该让构建失败，保持原样即可
        return html
      }
      return html.replace(/(href="\/favicon\.ico)(\?[^"]*)?(")/, `$1?v=${hash}$3`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), faviconCacheBust()],
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
