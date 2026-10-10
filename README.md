# 简历工坊

基于 Vue 3 的本地优先简历编辑器：左侧编辑、右侧实时纸张预览，支持主题/模板定制、图片模板与自由布局、头像拖放与裁剪、纸面框选、撤销/重做；导出路径覆盖**矢量 PDF**（文本可选中）、浏览器打印、**Markdown / 纯文本**（ATS 友好）与 JSON 备份。

- **本地优先**：不登录也能完整使用，数据保存在浏览器（localStorage），随时导出 JSON 备份；
- **可选云端**：注册账号后简历自动同步到服务端（SQLite），换设备继续编辑；
- **AI 助手（自带 Key）**：一句话润色、简历体检、JD 匹配度分析；API Key 只存浏览器本地，经本机服务转发即用即弃，服务端不存储；
- **简历分享**：一键生成 30 天有效的公开只读链接，随时可撤销；
- **导出防刷**：渲染并发信号量 + 按用户/全站双层每日配额 + 内容去重缓存。

部署方式（本机自用 / 服务器 / Docker / 纯静态托管）见 [DEPLOY.md](./DEPLOY.md)。

## 快速开始

环境要求：Node.js `^22.18.0` 或 `>= 24.12.0`（服务端用内置 `node:sqlite`，无原生编译依赖）。

```sh
npm install             # 前端依赖
npm install --prefix server   # 应用服务依赖

npm run dev:all         # 一键起前端(5173) + 应用服务(3001)，开发推荐
# 或分终端：
npm run dev             # 仅前端
npm run pdf             # 仅应用服务（账号 / 云端简历 / PDF 导出）
```

一键导出 PDF 需要机器上有 Edge 或 Chrome（自动探测）。

AI 助手默认未配置，不影响其它功能：在编辑器的「AI 设置」里填入任意 OpenAI 兼容服务的 API Key 即可启用（内置 DeepSeek / 智谱 GLM / Kimi 预设，也可自定义地址）。

## 常用脚本

| 命令                   | 说明                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run dev`          | 仅启动前端（Vite，端口 5173）                                            |
| `npm run dev:all`      | 前端 + 应用服务一起启动，退出时同时结束                                  |
| `npm run build`        | 构建产物到 `dist/`                                                       |
| `npm run pdf`          | 启动应用服务（托管 `dist/` 静态站点 + `/api`，端口 3001）                |
| `npm test`             | 运行 Vitest 单测（176 例：鉴权、数据清洗、SSRF 防线、导出、AI 客户端等） |
| `npm run lint`         | ESLint 检查（代码质量与 Vue 陷阱）                                       |
| `npm run lint:fix`     | ESLint 自动修复                                                          |
| `npm run format`       | Prettier 格式化 src / server / tests / 根配置                            |
| `npm run format:check` | 只校验不改动（CI 用）                                                    |

## 工程约定

- **格式与质量分工**：Prettier 管一切格式（无分号、单引号、100 列），ESLint 只管代码质量与 Vue 特有陷阱（响应性丢失、`v-html` 禁用、`key` 缺失等），风格规则由 `eslint-config-prettier` 关闭避免打架；
- **提交门禁**：husky + lint-staged 在 commit 时对暂存文件自动格式化并修复 lint（首次克隆后跑一次 `npm install` 即自动启用）；
- **配置分层**：`eslint.config.js` 按目录区分浏览器/Node 全局；`server/render.js` 的浏览器回调、`server/sanitize.js` 的控制字符正则都有注明原因的豁免，不让规则静默放过特例；
- **编辑器一致性**：`.editorconfig` 统一缩进与换行，装上 EditorConfig 插件即生效；
- **CI**：GitHub Actions 在 push/PR 时跑 lint → test → build，绿了才能合。

## 目录结构

```
src/                 前端（Vue 3 + Pinia + Vue Router）
  pages/             页面（编辑器 / 登录）
  components/        组件（顶栏、预览纸张、编辑面板）
  composables/       组合式函数（认证、云端同步、PDF 导出、拖放…）
  stores/            Pinia（简历数据、撤销/重做、自动保存）
  utils/             纯逻辑（历史栈、数据清洗、AI 客户端、多格式导出、备份）
server/              应用服务（Express）
  db.js              SQLite 数据层（node:sqlite）
  auth.js            scrypt 口令摘要 / 会话令牌 / 失败锁定
  index.js           路由：账号、云端简历、PDF 导出、分享、AI 转发
  render.js          playwright-core 驱动本机 Edge/Chrome 渲染 PDF
  sanitize.js        入参白名单清洗（安全边界）
  aiGuard.js         AI 转发的 SSRF 防线（协议 / 内网 / 变体地址校验）
  imageProxy.js      远程图片代理（重定向逐跳复检的 SSRF 防线）
  captcha.js         注册滑块验证码（HMAC 签名挑战）
  semaphore.js       渲染并发信号量
tests/               Vitest 单测
```

## 数据与安全要点

- 简历数据在服务端入库前全量过 `server/sanitize.js` 白名单清洗（分享出去的内容同样如此）；渲染页面禁止访问外部源；
- 密码 scrypt 摘要存储，会话为服务端 Session + httpOnly Cookie，登录失败按「IP+用户名」锁定；注册另设滑块验证码与限频；
- AI API Key 只存用户浏览器本地，`/api/ai/chat` 转发即用即弃，不落库不打日志；AI 转发与图片代理均带 SSRF 防线（`aiGuard.js` / `imageProxy.js`）；
- 所有运行时数据集中在 `server/.data/`（SQLite 单文件），备份/迁移拷这一个目录即可。
