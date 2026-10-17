# 简历工坊

基于 Vue 3 的本地优先简历编辑器：左侧编辑、右侧实时纸张预览，支持主题/模板定制、图片模板与自由布局、头像拖放与裁剪、纸面框选、撤销/重做；导出路径覆盖**矢量 PDF**（文本可选中）、浏览器打印、**Markdown / 纯文本**（ATS 友好）与 JSON 备份。

- **本地优先**：不登录也能完整使用，数据保存在浏览器（localStorage），随时导出 JSON 备份；
- **可选云端**：注册账号后简历自动同步到服务端（SQLite），换设备继续编辑；
- **AI 助手（自带 Key）**：一句话润色、简历体检、JD 匹配度分析；API Key 只存浏览器本地，经本机服务转发即用即弃，服务端不存储；
- **Agent Skill（无界面产出）**：`skills/resume-workshop/` 按 Agent Skills 标准打包，AI 代理不开编辑器即可完成「写简历 → 白名单校验 → 导出矢量 PDF / Markdown」；
- **简历分享**：一键生成 30 天有效的公开只读链接，随时可撤销；弹窗内「我的分享」集中管理历史分享（打开 / 撤销，撤销合集分享同步从官网移除）；
- **官网简历合集**（`/collection`）：分享时勾选「展示到简历合集」即进入官网陈列页，卡片用真实模板实时渲染迷你预览，按求职方向自动分类并提供筛选（技术 / 产品 / 设计等，关键词推导自求职意向）；游客可看前 6 份，登录后浏览全部（`COLLECTION_GUEST_VISIBLE` 可调）；页面带官网式页尾。
- **模板 × 风格 SKU 矩阵 + 管理后台**（`/admin`，仅管理员）：12 套布局模板叠加一键风格预设，不搭的组合在选择器里置灰禁用；风格与兼容矩阵存服务端（`app_config`），管理员在后台增删改风格、勾选模板兼容白名单，保存后全站编辑器立即生效。实例首个注册账号自动成为管理员。
- **PDF 简历导入**：编辑器「导入数据 → PDF 简历导入」，浏览器端 pdf.js 解析文字版 PDF，按模块标题 / 时间段 / 联系方式启发式还原为可编辑简历（扫描件不支持，导入后请核对）。
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

| 命令                   | 说明                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | 仅启动前端（Vite，端口 5173）                                                                                                                        |
| `npm run dev:all`      | 前端 + 应用服务一起启动，退出时同时结束                                                                                                              |
| `npm run build`        | 构建产物到 `dist/`                                                                                                                                   |
| `npm run pdf`          | 启动应用服务（托管 `dist/` 静态站点 + `/api`，端口 3001）                                                                                            |
| `npm test`             | 运行 Vitest 单测（389 例：鉴权与会话守卫、来源校验、配额、数据清洗、SSRF 防线、导出、简历 store 及其拆解出的持久化/快照/多文档/模块树、AI 客户端等） |
| `npm run lint`         | ESLint 检查（代码质量与 Vue 陷阱）                                                                                                                   |
| `npm run lint:fix`     | ESLint 自动修复                                                                                                                                      |
| `npm run format`       | Prettier 格式化 src / server / tests / 根配置                                                                                                        |
| `npm run format:check` | 只校验不改动（CI 用）                                                                                                                                |

## Agent Skill（AI 无界面产出）

[`skills/resume-workshop/`](./skills/resume-workshop/SKILL.md) 是按 Agent Skills 标准（[anthropics/skills](https://github.com/anthropics/skills) 推广的 SKILL.md 格式）编写的技能包，Claude Code / Claude.ai / ZCode 等代理装载后，不打开编辑器就能产出与本编辑器完全兼容的简历 JSON 并交付：

- `SKILL.md` — 工作流（收集 → 构建 JSON → 校验 → 导出）与硬性约束（不编造经历、一页纸配额、图片规则）；
- `references/data-schema.md` — resume JSON 的结构、枚举与上限，服务端白名单（`server/sanitize.js`）的忠实转述；
- `references/headless-api.md` — `POST /api/pdf` Bearer 通道的请求格式、响应头与错误处置；
- `scripts/validate_resume.mjs` — 离线校验器，与服务端跑同一份白名单：`node skills/resume-workshop/scripts/validate_resume.mjs resume.json`；
- `assets/resume-template.json` — 可直接填充的简历骨架。

服务端侧只需 `.env` 里配好 `PDF_ACCESS_PASSWORD`（脚本 Bearer 通道），见 `DEPLOY.md` 环境变量参考。

## 工程约定

**TypeScript 迁移（进行中）**：领域类型在 `src/types/resume.ts`；`src/data`、`src/stores`、核心 `src/utils`、关键 composables 与**整个 `server/`** 已是严格模式 TS，用 `npm run typecheck`（vue-tsc）把关，并由 CI 强制执行（Vite 构建只转译不做类型校验，类型错误不会让 Build 失败，因此 typecheck 必须单独跑）。`server/` 由 Node 内置的类型剥离直接执行 `.ts`，不带构建步骤，细节见 [server/README.md](./server/README.md)。

**Vue 组件（进行中，18/48）**：已迁的是编辑器面板与分段编辑器那一层（`src/components/editor/**` 与若干通用弹窗），尚未迁的是体量最大的几个页面与弹窗（`AdminPage` / `TopBar` / `CollectionPage` / `TemplatePicker` 等）。组件迁 TS 的主要机械成本是**模板内联处理器的 DOM 收窄**：`$event.target` 是 `EventTarget`，取 `.value` / `.checked` 需要写成 `($event.target as HTMLInputElement)`。另外分段编辑器的 `section` prop 应按可辨识联合收窄成 `EntriesSection` / `GridSection` / `SkillsSection` / `TextSection`，否则模板里取 `section.items` 会报错 —— 那正是联合类型在提醒「先确定是哪种模块」。

`stores/resume` 是本地优先的落盘中心（多文档槽位、历史快照、头像引用、超容量降级），迁移前先用 `tests/resumeStore.test.js` 立起不变量再改类型；该测试需要 `localStorage` 与 `window`/`document`，由 `tests/setup/browser-globals.js` 按需安装（**刻意不放进 vitest 的 setupFiles**：全局安装 `document` 会让 pdf.js 误判运行环境，导致 PDF 导入端到端测试失败）。

`stores/resume` 已按职责拆成五个文件（见下方目录结构），`resume.ts` 只保留响应式状态与编排，不再直接读写 `localStorage`。拆出的模块都是「纯读写传入数据」的形态，因此 `resumeMutations` / `resumePersistence` / `resumeHistory` / `resumeDocuments` 各有独立单测，不必再经由 store 间接验证。

- **格式与质量分工**：Prettier 管一切格式（无分号、单引号、100 列），ESLint 只管代码质量与 Vue 特有陷阱（响应性丢失、`v-html` 禁用、`key` 缺失等），风格规则由 `eslint-config-prettier` 关闭避免打架；
- **提交门禁**：husky + lint-staged 在 commit 时对暂存文件自动格式化并修复 lint（首次克隆后跑一次 `npm install` 即自动启用）；
- **配置分层**：`eslint.config.js` 按目录区分浏览器/Node 全局；`server/render.js` 的浏览器回调、`server/sanitize.js` 的控制字符正则都有注明原因的豁免，不让规则静默放过特例；
- **编辑器一致性**：`.editorconfig` 统一缩进与换行，装上 EditorConfig 插件即生效；
- **CI**：GitHub Actions 在 push/PR 时跑 lint → typecheck → test → build，绿了才能合。typecheck 必须单独跑：Vite 构建只转译不做类型校验，类型错误不会让 Build 失败。

## 目录结构

```
src/                 前端（Vue 3 + Pinia + Vue Router）
  pages/             页面（编辑器 / 登录）
  components/        组件（顶栏、预览纸张、编辑面板）
  composables/       组合式函数（认证、云端同步、PDF 导出、拖放…）
  stores/            Pinia
    resume.ts        本机数据总入口：响应式状态 + 编排（不含具体持久化与树操作）
    resumePersistence.ts  localStorage 键名 / 紧凑序列化 / 配额保护 / 自动保存调度
    resumeHistory.ts      历史版本快照：采样节流、内容去重与 LRU
    resumeDocuments.ts    多文档登记表与各文档槽位
    resumeMutations.ts    模块树操作（纯函数，不碰存储、不认识 store）
  utils/             纯逻辑（历史栈、数据清洗、AI 客户端、多格式导出、备份）
server/              应用服务（Express，全部为 .ts，由 node 类型剥离直接执行）
  index.ts           路由与启动：账号、云端简历、PDF 导出、分享、AI 转发
  requestGuards.ts   认证、来源校验与配额（依赖注入，可直测）
  db.ts              SQLite 数据层（node:sqlite）
  auth.ts            scrypt 口令摘要 / 会话令牌 / 失败锁定
  render.ts          playwright-core 驱动本机 Edge/Chrome 渲染 PDF
  sanitize.ts        入参白名单清洗（安全边界）
  aiGuard.ts         AI 转发的 SSRF 防线（协议 / 内网 / 变体地址校验）
  imageProxy.ts      远程图片代理（重定向逐跳复检的 SSRF 防线）
  captcha.ts         注册滑块验证码（HMAC 签名挑战）
  semaphore.ts       渲染并发信号量
skills/              Agent Skill（AI 无界面操作）
  resume-workshop/   SKILL.md + 数据结构/API 参考 + 校验脚本 + 简历骨架
tests/               Vitest 单测
```

## 数据与安全要点

- 简历数据在服务端入库前全量过 `server/sanitize.js` 白名单清洗（分享出去的内容同样如此）；渲染页面禁止访问外部源；
- 密码 scrypt 摘要存储，会话为服务端 Session + httpOnly Cookie，登录失败按「IP+用户名」锁定；注册另设滑块验证码与限频；
- AI API Key 只存用户浏览器本地，`/api/ai/chat` 转发即用即弃，不落库不打日志；AI 转发与图片代理均带 SSRF 防线（`aiGuard.js` / `imageProxy.js`）；
- 所有运行时数据集中在 `server/.data/`（SQLite 单文件），备份/迁移拷这一个目录即可。
