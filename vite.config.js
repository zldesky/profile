import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/** PDF 渲染服务端口，需与 server/index.ts 的 PORT 保持一致 */
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

/**
 * 给编辑器路由的依赖 chunk 提前注入 modulepreload。
 *
 * 起因是 4G 手机档的启动实测（CPU ×4、1.6 Mbps、150 ms 延迟）：主 bundle 2.8s 到位、
 * 编辑器骨架 3.86s 才出现，而主线程 2.35s 就空闲了 —— 中间的等待不是 CPU 忙，是**串行下载**：
 *
 *   2820 ms  EditorPage.js (192 KB)
 *   1915 ms  templates.js        ┐
 *   1818 ms  shareApi.js         │ 这些小 chunk 都在 EditorPage 之后才被请求
 *   1749 ms  AuthDialog.js       ┘ → 白白多等约 1 秒
 *
 * 原因：Vite 只为**入口**注入 preload；路由这类动态 import 的依赖，要等父 chunk 解析完
 * 才由 `__vitePreload` 在运行时去取。用 <link rel="modulepreload"> 提前声明，浏览器就能
 * 与主 bundle 并行下载。
 *
 * 只预热编辑器这一条路由：它是产品主体，也是唯一有这段等待的入口。其余页面（合集 / 登录 /
 * 分享）首屏本来就轻，不值得为它们多付请求；不做「全量预热」也是同一理由 —— 那会把
 * 用不到的 chunk 也拉下来。
 *
 * 文件名带内容哈希，所以必须**从构建产物里读**真实文件名，不能写死。
 */
function preloadEditorChunks() {
  return {
    name: 'preload-editor-chunks',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (!html || typeof html.source !== 'string') return

      const editorName = Object.keys(bundle).find((name) => /(^|\/)EditorPage-.*\.js$/.test(name))
      if (!editorName) return

      const chunk = bundle[editorName]
      // 只取静态导入的依赖（imports）；动态 import 的是按需加载的弹窗，不该预热
      const deps = (chunk.imports || []).map((name) => bundle[name]).filter(Boolean)

      const links = [
        `<link rel="modulepreload" crossorigin href="/${editorName}">`,
        ...deps.map((d) => `<link rel="modulepreload" crossorigin href="/${d.fileName}">`),
        // 路由自身的样式同样提前声明，避免样式到位前先闪一下无样式内容
        ...Object.keys(bundle)
          .filter((name) => /(^|\/)EditorPage-.*\.css$/.test(name))
          .map((name) => `<link rel="stylesheet" crossorigin href="/${name}">`),
      ]
      if (!links.length) return

      html.source = html.source.replace(
        '</head>',
        `  <!-- 编辑器路由的依赖 chunk，提前与主 bundle 并行下载（见 vite.config.js 注释） -->\n  ${links.join('\n  ')}\n  </head>`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), faviconCacheBust(), preloadEditorChunks()],
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
