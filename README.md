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
| `npm run audit:ui`     | **真实浏览器度量**（对比度 / 点击目标 / 文本溢出 / 键盘焦点），需先起服务                                                                            |
| `npm run audit:el`     | 量单个元素的盒子与真实命中区，如 `npm run audit:el -- .ed-check`                                                                                     |

### 界面审计（`tools/`）

静态检查只能查「写法」（`transition: all`、渐变颜色），查不出**渲染结果**。界面真正的毛病 —— 对比度不够、点击目标太小、键盘焦点看不见、换行处拥挤 —— 都得真的渲染出来量。思路来自开源清单 [taste-skill](https://github.com/Leonxlnx/taste-skill) 的 `scripts/inspect.mjs`（真的渲染、真的量、真的截图），但那个脚本是为落地页写的（量 hero 行数、空白屏占比），对编辑器应用不对症，因此按同样思路写了对症版：

- `tools/audit-ui.mjs` —— 桌面 1440 / 窄桌面 1024 / 手机 390 三档各量一轮：文字对比度（按 WCAG AA 的 4.5 / 3.0 判定）、点击目标、文本溢出、以及 Tab 键逐次检查焦点是否可见。
- `tools/probe-el.mjs` —— 量单个元素的盒子、承载它的 label 高度、以及**用 `elementFromPoint` 复核真实命中区**。

两个脚本都只用项目已有的 `playwright-core`（在 `server/node_modules`）与本机 Edge，不额外加依赖。

**踩过的坑，都写进了脚本注释**：

1. `page.evaluate` 的函数体在**浏览器**里求值，拿不到模块作用域的常量，阈值必须作为参数传进去；`eslint.config.js` 里因此给 `tools/**` 同时开 Node 与浏览器两套全局。
2. 只读 `background-color` 会把**渐变背景**判成透明，于是白字配渐变按钮一路找到白底、算出对比度 1.0 —— 一开始就这样误报了两处。现在遇到渐变直接跳过：宁可漏报，不可误报。
3. 只量元素盒子会**稳定误报两类「看着小、其实好点」**：用伪元素扩过命中区的（引导圆点，盒子 7×7 但上下各 6px 仍命中它）、以及包在 `label` 里的复选框（点 label 一样触发）。现在盒子偏小后会再用 `elementFromPoint` 复核一次。

**当前结果（三档视口全部为 0）**：对比度不足 0、点击目标不达标 0、文本溢出 0、键盘焦点 12/12 可见。

**实测查出的问题与改法**（都不是看代码能发现的）：

- **对比度：`--ed-text-4` 有 52 处用法，白底上只有 2.58，远低于 AA 的 4.5。** 想调达标时撞上瓶颈 —— `--ed-text-3` 在白底已是 4.97，而界面最暗的底（`--ed-fill-3`）会把任何颜色再压低约 0.9，所以「比 `--ed-text-3` 更浅」的档在暗底上不可能达标，**层次与可达性在这一档直接冲突**。取舍是可达性优先：`--ed-text-4` 提到与 `--ed-text-3` 同值，弱端收敛成一档；`--ed-text-5` 降为**仅限装饰**（滚动条滑块、隐藏模块的标题占位），任何要读的文字都不用。
- **`.ed-icon-btn` 被 flex 压扁成 18×28。** 它明明写着 `width: 28px`，但默认 `flex-shrink: 1` 让它在拥挤的行里被挤掉 10px。补 `flex: 0 0 auto` —— 图标按钮的尺寸应当固定，宁可让同行其它元素让位。
- **滑杆只有 16px 高**（原生 `<input type=range>`），手机上是主要调节手段却很难抓；改为 24px。
- **引导圆点 7×7**，而它承担着「跳到第 N 步」的实际功能；用伪元素把命中区撑到 24px，视觉仍是 7px。
- **复选框 15–18px**：`<input>` 是替换元素，`::after` **不生效**（实测确认），所以扩在承载它的 `label` 上。注意 `.ed-check` 有 `.ed-toggle` / `.ed-row` / `.sh-check` / AdminPage 裸放 好几种父元素，最后用 `label:has(> .ed-check)` 一次覆盖。

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

**设计令牌（编辑器外壳）**：`src/styles/paper.css` 的 `:root` 是唯一出处 —— 颜色、圆角、阴影都从这里取。做过的收敛：散在各组件里的 **46 种颜色字面量（约 100 处）** 与 **24 种圆角** 归到令牌，`gap` 归到 2px 网格。三条约定：

- **同类角色用同一档**。最容易走样的是圆角：分段控制器 `.panel-tabs` / `.auth-tabs` / `.ed-sub` 都是 9px，而内部按钮曾分别是 7px / 9px / 8px，图标按钮是 7px 而输入框是 8px —— 7 与 8 的差别看不出来，并排就是不齐。现在按角色定档（`--ed-radius-xs/sm/md/lg/xl/pill` + 分段控制器的内外圈）。
- **简历纸张的配色不受这里影响**。模板组件（`src/templates/**`）里的 `#4b5563` / `#d1d5db` 等是**简历内容自身的配色**，跟着 `--accent` 主题走，刻意不接令牌 —— 否则改界面就会改到用户导出的简历。同理 `paper.css` 里 `--ed-brand*` 的 `#000000` 是默认值，运行时由 `applyChromeAccent` 按简历主色重算。
- **语义色给完整梯度，不要随手拍一个**。成功态是四档（`--ed-ok-tint/fill/line/ok`）：底色、已滑过部分、描边、文字。收敛时曾把四档并成一个 tint，结果把验证码完成态的层次压平了 —— 梯度是刻意的，只是原先没有名字。

**「去 AI 味」自查**：按开源清单 [de-ai-ui](https://github.com/marten-osieka/de-ai-ui) 的《AI 特征目录》做过一次机械自查（该目录把常见机器味套路与人的替代做法逐条对照，很值得一读）。结论与本项目的取舍：

- **文案干净**：无 `elevate / unlock / seamlessly` 这类填充词、无「In today's fast-paced…」模板句、无 `Acme / John Doe` 占位名；全文唯一的短横是「1–2 种字体」这种真实数值区间。这一条本来就守住了，自查只是确认。
- **渐变是真选择，不是默认**：主题里的靛蓝是 `#3b5bd9 → #1e3a8a`，不是 `#8b5cf6` 那类紫罗兰默认；所有渐变都从 `--accent` / `--ed-brand-*` 派生，一处定义、随主题联动。
- **已修掉的机器味**：① 同一个「品牌色方块」被复制了 6 份（9 条属性完全相同，只有尺寸漂移成 28/28/28/28/32/52），抽成 `.ed-brand-block`；② 画布背景叠了四层，其中对角两抹品牌色晕光是目录点名的 `floating blurred orbs`，且完全对称，**去掉晕光只留稿纸点阵**（点阵对得上「写简历」这个主题，光晕换成任何产品都成立）；③ 验证码失败抖动曾缺 `prefers-reduced-motion` 兜底。
- **刻意保留的**：`-apple-system` 系统字体。它确实是「默认中的默认」，但这里是对的 —— 简历的排版字体由用户在「设计 → 字体」里选（`FONT_GROUPS`），界面外壳用系统字体才不会与用户所选字体打架。
- **一处待定**：合集页骨架屏的扫光（`cl-shimmer`）目录列为 tell。它是真实的加载状态反馈而非装饰，已补 reduced-motion 兜底；若你觉得仍显套路，可以换成静态灰块。

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
