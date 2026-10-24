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
- **AI 补充导入**：编辑器「导入数据 → AI 补充导入」。给一份已有简历文件（PDF / 文本 / Markdown）加上一句提示词，指定要填到哪个位置（基础信息或任一模块），AI 只做搬运与整理。与上面那条是**并列的两条路**：PDF 导入走规则解析、整份重建、**不依赖 AI、离线可用**；这条走 AI、只填指定位置、可带提示词，适合「我只要把这段实习经历补进去」或原件排得乱、规则解析不出来的情形。两条路径共用同一份 pdf.js 文本提取。

  AI 补充导入的两道保险（都因为**错填比不填更糟**）：结果先在弹窗里列出「将写入以下内容」，用户确认后才写回；归一化阶段**丢掉所有空值**，因此模型没提取到时不会把原有内容清空。提示词里反复强调不许编造，返回后也不做任何「合理补全」——简历上的假经历是灾难。写入经由 store，可 Ctrl+Z 撤销。

- **Markdown 是一等内容源**（多种用法）：同一份 `.md`，既能在 Web 编辑器里可视化编辑与出矢量 PDF，也能在 **VSCode / Typora / Obsidian** 里直接写与出 PDF（主题见 [`markdown-hosts/`](./markdown-hosts/)）。编辑器「导出数据 → Markdown 内容源」导出的文件**能精确导回**，「导入数据 → Markdown 简历导入」也接受手写的 LapisCV 式 Markdown。格式与两条规则（键值行加粗、别删类型提示）见 [`markdown-hosts/README.md`](./markdown-hosts/README.md)。

- **分享自动屏蔽个人信息**：分享链接是公开只读的（还可展示到官网简历合集），所以服务端在**存库之前**就替换掉手机号、邮箱、身份证号，以及年龄 / 性别 / 住址等字段 —— 写进要点与段落里的联系方式也一并隐藏。别人看到的是 `138****0000` 这样的形式，分享页上还会说明「联系方式是有意隐藏的」。屏蔽默认开启，弹窗里有一个**显式的**例外开关（默认不勾选），并且会如实回告屏蔽了哪些字段。

- **导出防刷**：渲染并发信号量 + 按用户/全站双层每日配额 + 内容去重缓存。

部署方式（本机自用 / 服务器 / Docker / 纯静态托管）见 [DEPLOY.md](./DEPLOY.md)。

**改这个项目之前，先读 [PITFALLS.md](./PITFALLS.md)。** 那是历次踩坑的合集（症状 → 真因 → 规矩），
共六大类。其中最大的一类是「**验证工具报错、被测对象其实没错**」，**13 条**
（光「落点/距离不对」这一条就栽了 4 次）—— 它导致过两次「去修本来正确的代码」。
所以本仓库的两条硬规矩是：**脚本报错时先怀疑脚本**；
**改代码前先读文件、改完用 `git diff` 核对**。

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

AI 助手默认未配置，不影响其它功能：在编辑器的「AI 设置」里填入任意 OpenAI 兼容服务的 API Key 即可启用（内置 DeepSeek / 智谱 GLM / Kimi / 硅基流动 / OpenCode 等 11 家预设，也可自定义地址）。

### 同一份简历的多种用法

内容的源是 Markdown，渲染交给不同的宿主 —— 这一节说明四条路各自适合什么。

| 方式       | 入口                                                       | 出 PDF 靠什么                               | 适合                           |
| ---------- | ---------------------------------------------------------- | ------------------------------------------- | ------------------------------ |
| Web 编辑器 | `/editor`                                                  | 本机 / 服务端渲染，**矢量 PDF、文本可选中** | 可视化调整模板、配色、布局     |
| VSCode     | [`markdown-hosts/`](./markdown-hosts/) + Markdown PDF 扩展 | 扩展自带的 Chromium                         | 已经在 VSCode 里写东西         |
| Typora     | 同一份 CSS 作为主题                                        | Typora 的导出                               | 习惯所见即所得的 Markdown 编辑 |
| Obsidian   | 同一份 CSS 作为片段                                        | Obsidian 的导出                             | 简历与笔记放在一起维护         |

四条路读的是**同一份 `.md`**。所以「在 VSCode 里改完，导回 Web 编辑器调模板再出矢量 PDF」是通的 ——
反过来也通：编辑器里编完，导出内容源，拿去外编辑器继续维护。

**两条容易踩的规则**（详见 [markdown-hosts/README.md](./markdown-hosts/README.md)）：
键值行的标签必须写成加粗（`- **标签**：值`），否则「带中文冒号的要点」在导入时会被静默当成补充字段；
`<!-- resume:type=… -->` 那几行不能删（渲染时不可见，但导入时靠它确定模块类型）。

**导入只还原内容**：主题 / 模板 / 模块布局 / 头像不在 Markdown 里，导入后取默认值。
即 **Markdown 是「内容的源」，不是「整份文档的源」**；要完全复原请用 JSON 备份。

### 页面结构

| 路径          | 页面        | 说明                                                                                                                          |
| ------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/`           | 产品首页    | 讲清产品是什么：首屏用**真实渲染的纸**当主视觉（与编辑器同一套模板管线，不是插画），下接能力清单与模板一览，两处 CTA 进编辑器 |
| `/editor`     | 编辑器      | 主体功能，**不强制登录**；匿名即纯本地模式                                                                                    |
| `/collection` | 简历合集    | 公开可看，游客见前若干份，登录解锁全部                                                                                        |
| `/login`      | 登录 / 注册 | 左右分栏：左栏讲「登录能得到什么」（云端同步 / 分享链接 / 矢量 PDF），并明说「不登录也能用」；右栏是共用的 `AuthPanel`        |
| `/share/:id`  | 分享只读页  | 拿链接的人无需登录                                                                                                            |
| `/admin`      | 管理后台    | 仅管理员                                                                                                                      |

首页与编辑器分开是一次刻意的取舍：`/` 从「直接进编辑器」变成「先讲产品」，多了一次点击；换来的是陌生人能先知道这是什么。**「打开即编辑」的便利由首页首屏与收尾两个 CTA 承担**，因此入口并没有变难找。未知路径回首页，不再把陌生人直接丢进编辑器。

路由表抽在 `src/router/routes.js`（纯配置，不依赖浏览器）—— 这样「哪条路径对应哪个页面」可以在 Node 里直接断言。`router/index.js` 只负责把它接到浏览器 history 上；拆开的原因是 `createWebHistory()` 在模块求值时就读 `location`，而测试框架会把 import 提升到可执行代码之前，桩永远晚一步。

## 常用脚本

| 命令                          | 说明                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                 | 仅启动前端（Vite，端口 5173）                                                                                                                                                  |
| `npm run dev:all`             | 前端 + 应用服务一起启动，退出时同时结束                                                                                                                                        |
| `npm run build`               | 构建产物到 `dist/`                                                                                                                                                             |
| `npm run pdf`                 | 启动应用服务（托管 `dist/` 静态站点 + `/api`，端口 3001）                                                                                                                      |
| `npm test`                    | 运行 Vitest 测试（498 例：**含 /api 集成测试**，以及鉴权与会话守卫、来源校验、配额、数据清洗、SSRF 防线、导出、简历 store 及其拆解出的持久化/快照/多文档/模块树、AI 客户端等） |
| `npm run lint`                | ESLint 检查（代码质量与 Vue 陷阱）                                                                                                                                             |
| `npm run lint:fix`            | ESLint 自动修复                                                                                                                                                                |
| `npm run format`              | Prettier 格式化 src / server / tests / 根配置                                                                                                                                  |
| `npm run format:check`        | 只校验不改动（CI 用）                                                                                                                                                          |
| `npm run audit:ui`            | **真实浏览器度量**（对比度 / 点击目标 / 文本溢出 / 键盘焦点）。默认审 `/editor`；带 URL 审首页，加 `--shots` 出截图。需先起服务                                                |
| `npm run audit:interaction`   | 交互态：键盘焦点可见性、悬停反馈（真的按 Tab / 真的移鼠标）                                                                                                                    |
| `npm run audit:admin`         | 管理后台（`/admin`）的界面审计：自起临时服务 + 自造管理员，一步跑完                                                                                                            |
| `npm run verify:templates`    | 逐个切换 12 个模板，数纸面可见文字 —— 验证模板组件迁 TS 后没有静默渲染成空白                                                                                                   |
| `npm run verify:dialogs`      | 逐个点开关键弹窗，确认迁 TS 后仍能弹出且有内容                                                                                                                                 |
| `npm run verify:captcha`      | 验证滑块验证码能加载并真的能拖动（注册必经环节）                                                                                                                               |
| `npm run verify:paper`        | 纸面「点文字就地编辑」与「点模块跳转」：真的改值看纸面是否变                                                                                                                   |
| `npm run verify:drag`         | 右侧面板模块卡片拖拽换序：真的拖，看顺序是否改变                                                                                                                               |
| `npm run verify:selects`      | 下拉框统一性：源码级 import 守门 + dist 新鲜度 + 逐页量宽度 + 换值是否生效                                                                                                     |
| `npm run verify:panel`        | 右侧面板宽度拉伸：拖拽位移是否精确、上下限、落盘、刷新保持、键盘、窄屏隐藏                                                                                                     |
| `npm run verify:pdf`          | 服务端导出 PDF（端到端）：取应用自己的简历 JSON → 真发 `/api/pdf` →检查产出的 PDF （A4 纸张、页数、是否画了字）。现有集成测试只断言它匿名返回 401，从没真的生成过一份          |
| `npm run verify:pages`        | 编辑器显示的页数 vs 导出 PDF 的真实页数：构造长度递增的简历逐个对照。两者不一致时用户会看到「编辑器说 2 页、导出是 3 页」                                                      |
| `npm run verify:share`        | 分享的隐私屏蔽（端到端 15 项）：匿名请求拿不到原文、分享页无泄漏、说明条不印进 PDF、弹窗说明与例外开关默认关闭                                                                 |
| `npm run verify:spacing`      | 模块位置与间距：卡片头部「布局」按钮能否直接开面板、四个方向的滑杆是否真的改到纸面（需先 `npm run dev`）                                                                       |
| `npm run verify:toolbar`      | 纸面多选工具条的四向间距按钮，以及 720/390/360/320 四档窄屏下不溢出、按钮命中区仍 ≥24px（需先 `npm run dev`）                                                                  |
| `npm run verify:markdown`     | Markdown 往返（端到端）：真点菜单导出、真上传导入，比对纸面文字是否逐字一致                                                                                                    |
| `npm run build:host-template` | 用应用自己的导出器生成宿主模板 markdown-hosts/templates/resume.md（避免手写模板与格式漂移）                                                                                    |
| `npm run preview:host-theme`  | 渲染宿主主题并断言「完整示例简历恰好一页 A4」，同时产出预览图与外编辑器用的 PDF                                                                                                |
| `npm run audit:el`            | 量单个元素的盒子与真实命中区，如 `npm run audit:el -- .ed-check`                                                                                                               |
| `npm run audit:login`         | 造一个已登录会话令牌，配合 `npm run audit:ui -- --token <令牌>`                                                                                                                |
| `npm run audit:session`       | 诊断会话令牌是否真的生效                                                                                                                                                       |
| `npm run audit:perf`          | 4G 手机档下的加载性能（长任务、启动里程碑、传输量）                                                                                                                            |
| `npm run audit:mobile`        | 移动端布局：顶栏高度、逐行按钮、横向溢出定位                                                                                                                                   |
| `npm run audit:trace`         | 录启动 trace 并按阶段聚合，定位「那 1 秒被谁占了」                                                                                                                             |
| `npm run audit:shot`          | 给公开页面（首页 / 合集 / 登录）截图并量栅格与缩略图缩放比                                                                                                                     |
| `npm run audit:dialog`        | 打开指定弹窗并截图，如 `npm run audit:dialog -- "AI 补充导入"`                                                                                                                 |

### /api 集成测试（`tests/api.test.js`）

起**真实服务进程**、发**真实 HTTP 请求**，而不是在进程内 import app。原因有二：`server/index.ts` 不导出 app（导入即 `listen`），以及真进程会走到同一份 `.env`、中间件顺序、来源校验、会话守卫、SQLite 建表与迁移 —— 把 app 抽出来单测会漏掉这些接缝，而接缝恰恰最容易出问题。

覆盖：健康检查与公开元数据、注册/登录/会话/登出、受保护接口的匿名 401 与无权限 403、简历读写与清洗、**简历按用户隔离（越权读别人的简历是数据泄露）**、分享的创建/匿名读取/删除/归属、CSRF 与请求体上限。

三条自我约束写在 `tests/api/harness.js` 的注释里，都是「测得不真」的常见来源：

1. **必须用临时数据库**：`DB_PATH` 指向 `os.tmpdir()`，绝不碰开发用的 `.data/app.db`；收尾连同 `-wal` / `-shm` 一起删，并挂了退出兜底清扫（启动失败时目录也不会留下）。已验证真实库文件的修改时间在整轮测试前后不变。
2. **必须手工维护 cookie**：Node 的 `fetch` 不像浏览器那样自动保存 cookie。忘了带的话所有受保护接口都返 401，「守卫生效」的断言会**一路假通过**，而真实登录流程根本没被验证。harness 的 client 因此自带 cookie jar。
3. **登录失败次数要克制**：登录锁定阈值是 10 次/IP+用户名，测试用不同用户名把失败次数分散开，避免一条测试把后面全锁死。

为此给服务端补了两个**正当的配置项**（都写进了 `.env.example`，默认值不变）：`CAPTCHA_ENABLED=off` 跳过注册滑块校验、`REGISTER_LIMIT` 调整注册限频（默认 5/小时/IP，下限固定为 1 —— 设成 0 会让所有人都无法注册，那是很难排查的部署故障）。**这两个开关都只影响注册这一步**：默认配置下注册仍被验证码挡住，已单独实测确认。

### 界面审计（`tools/`）

静态检查只能查「写法」（`transition: all`、渐变颜色），查不出**渲染结果**。界面真正的毛病 —— 对比度不够、点击目标太小、键盘焦点看不见、换行处拥挤 —— 都得真的渲染出来量。思路来自开源清单 [taste-skill](https://github.com/Leonxlnx/taste-skill) 的 `scripts/inspect.mjs`（真的渲染、真的量、真的截图），但那个脚本是为落地页写的（量 hero 行数、空白屏占比），对编辑器应用不对症，因此按同样思路写了对症版：

- `tools/audit-ui.mjs` —— 桌面 1440 / 窄桌面 1024 / 手机 390 三档各量一轮：文字对比度（按 WCAG AA 的 4.5 / 3.0 判定）、点击目标、文本溢出、以及 Tab 键逐次检查焦点是否可见。**量之前会先展开所有模块卡片、再切到「设计」页签**：否则量到的只是默认视图，折叠区域里的问题一个都看不到，报出来的 0 是假安心。
- `tools/audit-login.mjs` —— 造一个已登录会话（直接建用户 + 建会话，用的是生产同一套 `hashPassword` / `createUser` / `createSession`，绕开注册的滑块验证码），配合 `audit-ui.mjs --token` 用于需要登录态的界面。
- `tools/probe-el.mjs` —— 量单个元素的盒子、承载它的 label 高度、以及**用 `elementFromPoint` 复核真实命中区**。
- `tools/probe-session.mjs` —— 诊断令牌到底生效没有，避免「以为量了登录后的界面、其实量的是未登录页」。

**一个曾经的误判，值得记下**：起初以为「未登录时编辑器被挡住，所以审计只覆盖公开页面」。实测推翻了它 —— 这个应用**未登录也完整渲染编辑器**（`ed-card=6`、`panel-tabs=1` 两种状态一致），只有云端功能才要求登录，页头把「登录/注册」换成用户名而已（正是 1721 与 1727 那 6 个元素之差）。所以编辑器面板本来就在审计范围内。**推断出来的覆盖面不可信，得实测** —— `probe-session.mjs` 就是为此留下的。

四个脚本都只用项目已有的 `playwright-core`（在 `server/node_modules`）与本机 Edge，不额外加依赖。

### 性能与移动端度量（`tools/`）

- `tools/probe-perf.mjs` —— 在 **4G 手机档**（CPU ×4 降速、1.6 Mbps、150 ms 延迟，走 CDP 限速）下量：导航计时、长任务、资源传输量，以及三个可分辨的启动里程碑（编辑器骨架出现 / 纸面渲染 / 主线程空闲）。在开发机的高速环境里测性能只会得出乐观结论，所以默认就限速。
- `tools/trace-startup.mjs` —— 录一条真实 trace 并按阶段聚合 self time，用来回答「那 1 秒被谁占了」。长任务只说明「有东西阻塞」，不说明是谁。

**当前实测（4G 手机档，4 次取范围）**：

| 指标                     | 数值            |
| ------------------------ | --------------- |
| 资源传输总量             | 440 KB          |
| TTFB                     | 6–18 ms         |
| load 事件                | 2.5–2.6 s       |
| 长任务                   | 约 0.5–0.6 s    |
| **编辑器骨架（可用了）** | **2.97–3.02 s** |
| 主线程空闲               | 3.3 s           |

**结论：瓶颈是「下载的串行等待」，不是「布局」也不是「脚本执行」。**

### 一个被推翻的结论，以及两条测量教训

早先这一节写的是「瓶颈是 Layout，占 743 ms」，并据此认为该去合并那串「测量 → 改样式 → 再测量」。**那个结论是错的**，两点原因都出在测量方法上：

1. **探针自己的开销被算进了页面耗时。** 原来在 load 之后用 16ms 轮询探测「编辑器骨架何时出现」，而在 CPU ×4 降速下轮询回调本身就被拖慢 —— 量出的 3.4s 里很大一部分是探针的开销。改成在页面脚本之前挂 `MutationObserver`（只记录一次就断开）后，数字立刻不一样。**量性能的工具本身也要被质疑。**
2. **trace 的 self time 聚合不能直接当因果。** `Layout 743ms` 是所有布局事件的总和，不代表它们都在关键路径上；真正决定「多久能用」的是**主线程空闲与关键资源到达时间**。

修正后的真实情况：

| 时间   | 事件                                          |
| ------ | --------------------------------------------- |
| 1915ms | `templates.js` 才被请求                       |
| 2820ms | `EditorPage.js`（192 KB）下载完（用了 1.26s） |
| 3860ms | 编辑器骨架出现                                |
| 2350ms | 主线程已空闲                                  |

主线程早早空闲、长任务只有 ~90ms，却在 3.86s 才出现界面 —— 中间是**串行下载**：Vite 只为入口注入 preload，路由这类动态 import 的依赖要等父 chunk 解析完才由 `__vitePreload` 去取。

**改法**：`vite.config.js` 的 `preloadEditorChunks()` 插件，在构建后给编辑器路由的依赖 chunk 注入 `<link rel="modulepreload">`（文件名带哈希，所以从构建产物里读，不能写死）。只预热这一条路由 —— 它是产品主体，也是唯一有这段等待的入口；不做全量预热，避免把用不到的 chunk 也拉下来。

**效果**：`EditorPage.js` 从「起 1264 → 完 2820」（1.26s 串行）变成「起 172 → 完 2506」（与主 bundle 并行），**编辑器骨架 3.86s → 2.97–3.02s，稳定快约 0.9 秒**。代价是 load 事件从 2.2s 推到 2.5s（多几个预加载请求在争带宽）—— 但「界面能用」比「最后一个字节到达」重要。

### 三个次要改动（都不是主因）

- **布局读取合并到每帧一次**：`refreshLayout` 会被挂载、深度 watch、缩放、resize 多处触发，内部有 4 组读布局操作；改用 `requestAnimationFrame` 做闸门，一帧内多次请求只跑一次。语义不变（页数与工具条本来就只在 DOM 稳定后才有意义），实测长任务略有下降。
- **`applySectionTips` 幂等**：title 已是目标值就不写。它是对的（常规路径写操作降到 0），但**单独看没有可测量的改善** —— 因为它从来不是瓶颈。留着是因为它正确，不是因为有用。
- **非首屏弹窗改为异步组件**：`CompletenessDialog` / `JdMatchDialog` / `ShareDialog` / `ResumeManagerDialog` / `AiFillDialog` / `PasswordDialog` 由 `defineAsyncComponent` 加载，代码与依赖不再进关键路径。

  **实测收益：`EditorPage` JS 191 → 160 KB、CSS 42 → 28 KB**（原计划里我估的是「收益递减、建议先不做」，实测证明减少量比我预估的大）。但**面板出现时间没有可测量的改善**（2946–3012 ms vs 2974–3020 ms，落在噪声内）—— 因为那 45 KB 并不是当前条件下的关键路径。留着是因为减少初始负载本身是对的，且实测确认这 5 个弹窗仍能正常打开；不是因为它在 1.6 Mbps 下看得出效果。收益要到更慢的网络或更弱的设备上才体现。

  保留静态导入的两个：`AuthDialog`（最常开）、`ConfirmDialog`（极小且随登录态频繁变化），为它们多一次网络往返不划算。

**若还要提速**，剩下的只有进一步压缩入口那 143 KB（Vue 运行时 + Pinia + Router 的底座）。那已经不是应用代码的优化空间，收益有限。

**已修的移动端问题**：`.editor-panel` 在 900px 以下已是 `flex: 1 1 auto`，但 flex 项默认 `min-width: auto`（不得小于内容固有宽度），面板里那排模块操作按钮合计约 224px 把整栏撑到 **332px** —— 在 320px 设备上就是横向溢出（实测 `editor-panel 332 > 父级 320`）。补 `min-width: 0` + 溢出裁剪后，320 / 360 / 390 三档均无溢出。

**踩过的坑，都写进了脚本注释**：

1. `page.evaluate` 的函数体在**浏览器**里求值，拿不到模块作用域的常量，阈值必须作为参数传进去；`eslint.config.js` 里因此给 `tools/**` 同时开 Node 与浏览器两套全局。
2. 只读 `background-color` 会把**渐变背景**判成透明，于是白字配渐变按钮一路找到白底、算出对比度 1.0 —— 一开始就这样误报了两处。现在遇到渐变直接跳过：宁可漏报，不可误报。
3. 只量元素盒子会**稳定误报两类「看着小、其实好点」**：用伪元素扩过命中区的（引导圆点，盒子 7×7 但上下各 6px 仍命中它）、以及包在 `label` 里的复选框（点 label 一样触发）。现在盒子偏小后会再用 `elementFromPoint` 复核一次。

### 管理后台审计（`tools/audit-admin.mjs`）

`/admin` 是最后一个没有被量过的界面（`audit-ui.mjs` 默认只审编辑器与公开页）。单独一个脚本的原因：`audit-ui.mjs` 需要外部已起服务 + 一个管理员令牌，手工拼这几步容易出错。

**管理员从哪来**：`db.ts` 里首个注册的账号即实例管理员（`role='admin'`，由 `MIN(id)` 那条 UPDATE 保证）。所以在**全新临时库**上注册第一个用户，它就是管理员 —— 不需要改数据，也不需要测试专用旁路。全程临时库 + 随机端口，收尾删除。

**量出并修掉 2 处**（编辑器里同类问题更早就修过，这里是漏改）：

| 元素                  | 问题                | 改法                                                                                                                                                                                                                                                          |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input.ed-check`      | 15×15（手机 18×18） | 它裸放在 `<td>` 里、没有 `<label>` 包裹，所以 `editor.css` 那条 `label:has(> .ed-check)` 覆盖不到。`<input>` 是替换元素、`::after` 不生效，而父级是 `<td>` —— 把命中区扩到 `<td>` 会让「点空白也算勾选」，在矩阵表里很容易误操作。因此**直接把控件做到 24px** |
| `button.ad2-link-btn` | 36×23               | 上下 padding 由 2px 提到 4px                                                                                                                                                                                                                                  |

**一次差点当成「通过」的失败，值得记下**：最早手工跑这一步时，我在 PowerShell 里把承接令牌的变量也命名为 `$cookie`，结果 `--token` 被弄成空值，审计**静默地按未登录跑了一遍**，报出一个漂亮的「0 问题」——而管理后台根本没渲染。所以新脚本在令牌为空时**直接报错退出**，而不是继续跑出一个假通过。这类「工具报绿、覆盖是假的」的失败模式，比代码 bug 更值得防。

**当前结果（三档视口全部为 0）**：对比度不足 0、点击目标不达标 0、文本溢出 0、键盘焦点 12/12 可见。

### 交互态审计（`tools/audit-interaction.mjs`）

上面的审计测的是**静态**状态。但一个控件静止时合规、按 Tab 走到它却看不出在哪，体验照样是坏的 —— 那类问题静态测不出来，必须真的按 Tab 走一遍、真的把鼠标移上去。这个脚本补的就是这个维度，两条规则都能客观验证：

- **焦点可见**：按 Tab 聚焦后计算样式必须与未聚焦时至少有一处不同。**必须用键盘 Tab 而不是 `element.focus()`** —— `:focus-visible` 只在键盘导航下匹配，程序化聚焦测不出真实情况，这是最容易写出「假通过」的地方。
- **悬停有反馈**：鼠标移上去后计算样式必须变化。禁用项排除。

**实测结果（三页）**：

| 页面           | 键盘焦点                      | 悬停反馈             |
| -------------- | ----------------------------- | -------------------- |
| `/editor` 桌面 | 走到 **54 / 54** 个可聚焦元素 | 试过 54 个，无变化 0 |
| `/editor` 手机 | 走到 **50 / 50**              | 试过 50 个，无变化 0 |
| `/` 首页       | 9 / 9                         | 9 个，无变化 0       |
| `/collection`  | 21 / 21                       | 21 个，无变化 0      |

**报告里「走到 N / M」这个分数是刻意设计的**：只报一个孤立的数字时，读者无法判断「是不是所有可聚焦元素都走过了」。这个分数刚加上去就暴露了一个问题 —— 当时是「40 / 54」，而那 14 个差额既可能是漏测、也可能是归并，没人能回答。

查下去发现**是遍历逻辑的错，不是页面问题**：终止条件原来按「可聚焦元素数」硬算 Tab 次数，但 Tab 顺序里还夹着**不在收集列表里**的元素（面板输入框、下拉框、纸面那个 contenteditable 的 DIV）—— 它们没有 `data-ax-index` 却照样吃掉一次 Tab，于是 54 次 Tab 走不完 54 个目标元素。改为「等到**列表内**的元素重复出现（说明绕回一圈）才停」，并排除那些无 index 的占位元素参与绕回判定后，覆盖变成 54/54、50/50。

顺带修掉一个副作用：取「未聚焦基线」原来是在焦点循环里 `blur()` 再 `focus()` 现取 —— 等于每测一个元素就把焦点挪两次，blur 会改变 `:focus-within`、甚至触发「失焦即关闭」的弹窗。改为在收集阶段（任何聚焦之前）一次性取好基线。

**覆盖率补齐后立刻查出一处真问题**：合集页当前选中的分类胶囊「全部 9」鼠标移上去无变化 —— `.cl-cat.is-active` 的边框色与文字色恰好和 `.cl-cat:hover` 设的相同，于是 hover 无效果。与编辑器那几处是同一模式（选中态覆盖悬停态）。修法是 `color-mix` 压暗背景。

**上限不再静默**：焦点与悬停的扫描上限保留（防跑飞），但一旦触发会明确打印警告 —— 一个静默的上限会让报告看起来是全覆盖，实际只走了一部分。

**它查出并促使修掉的 5 处真问题**（全部是「静止合规、交互时无反馈」）：

| 元素                           | 原因                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 「适应窗口」                   | `.editor-tools .ed-btn.is-active`（0,3,0 + scoped）压过了 `.ed-btn:hover`                                               |
| 「1 寸」等尺寸分段             | `.is-active` 的背景把 `.ed-btn:hover` 的浅色盖住                                                                        |
| 面板页签「内容」               | `button:hover` 只改文字色，而选中页签的文字已是最深一档                                                                 |
| 模块锚点（定位到「基本信息」） | `.panel-nav button.is-active` 在组件内，不受全局规则管辖                                                                |
| **「一键导出 PDF」（主按钮）** | `.ed-btn-primary:hover` 换了一套渐变，但默认主题下三档全是 `#000`，**计算出的渐变完全相同**；改用亮度滤镜，不依赖品牌色 |

修法上只压暗背景、不动文字色（选中态的文字与底色是对比度配好的），并用 `color-mix` 而非写死色值，品牌色被 `applyChromeAccent` 换掉后依然成立。选择器特异性高的那几处**只能写在各自组件里**，全局写法压不过 —— 这是逐个实测定位的，不是「写一处覆盖全部」。

**审计自己的三个坑（都比被测代码更值得记）**：

1. **漏了 `background-image`**：渐变按钮的 `background-color` 是 `transparent`，只比较它会把「渐变变了」看成「没变化」—— 主按钮因此躲过了第一版审计。补上 `background-image`；后来主按钮改用滤镜，又补了 `filter`。
2. **报「无变化」前必须先确认鼠标真的在元素上**：第一版不复核 `:hover`，于是没悬停到的元素也被记成「没有悬停反馈」，25 条报告里绝大多数是误报。现在不复核就计入「未能悬停到」并单独报数。
3. **要先滚进视口再悬停**：不滚的话面板下方元素拿不到坐标。第一次有 21–32 个元素「未能悬停到」—— 那种漏测会让报告**看起来干净，其实什么都没测到**。修好后是 0。

**实测查出的问题与改法**（都不是看代码能发现的）：

- **对比度：`--ed-text-4` 有 52 处用法，白底上只有 2.58，远低于 AA 的 4.5。** 想调达标时撞上瓶颈 —— `--ed-text-3` 在白底已是 4.97，而界面最暗的底（`--ed-fill-3`）会把任何颜色再压低约 0.9，所以「比 `--ed-text-3` 更浅」的档在暗底上不可能达标，**层次与可达性在这一档直接冲突**。取舍是可达性优先：`--ed-text-4` 提到与 `--ed-text-3` 同值，弱端收敛成一档；`--ed-text-5` 降为**仅限装饰**（滚动条滑块、隐藏模块的标题占位），任何要读的文字都不用。
- **`.ed-icon-btn` 被 flex 压扁成 18×28。** 它明明写着 `width: 28px`，但默认 `flex-shrink: 1` 让它在拥挤的行里被挤掉 10px。补 `flex: 0 0 auto` —— 图标按钮的尺寸应当固定，宁可让同行其它元素让位。
- **滑杆只有 16px 高**（原生 `<input type=range>`），手机上是主要调节手段却很难抓；改为 24px。
- **引导圆点 7×7**，而它承担着「跳到第 N 步」的实际功能；用伪元素把命中区撑到 24px，视觉仍是 7px。
- **复选框 15–18px**：`<input>` 是替换元素，`::after` **不生效**（实测确认），所以扩在承载它的 `label` 上。注意 `.ed-check` 有 `.ed-toggle` / `.ed-row` / `.sh-check` / AdminPage 裸放 好几种父元素，最后用 `label:has(> .ed-check)` 一次覆盖。

## Agent Skill（AI 无界面产出）

[`skills/resume-workshop/`](./skills/resume-workshop/SKILL.md) 是按 Agent Skills 标准（[anthropics/skills](https://github.com/anthropics/skills) 推广的 SKILL.md 格式）编写的技能包，Claude Code / Claude.ai / ZCode 等代理装载后，不打开编辑器就能产出与本编辑器完全兼容的简历 JSON 并交付：

- `SKILL.md` — 工作流（收集 → 构建 JSON → 校验 → 导出）与硬性约束（不编造经历、一页纸配额、图片规则）；
- `references/data-schema.md` — resume JSON 的结构、枚举与上限，服务端白名单（`server/sanitize.ts`）的忠实转述；
- `references/headless-api.md` — `POST /api/pdf` Bearer 通道的请求格式、响应头与错误处置；
- `scripts/validate_resume.mjs` — 离线校验器，与服务端跑同一份白名单：`node skills/resume-workshop/scripts/validate_resume.mjs resume.json`；
- `assets/resume-template.json` — 可直接填充的简历骨架。

服务端侧只需 `.env` 里配好 `PDF_ACCESS_PASSWORD`（脚本 Bearer 通道），见 `DEPLOY.md` 环境变量参考。

## 工程约定

**踩过的坑单独成文：[PITFALLS.md](./PITFALLS.md)。** 改代码前值得扫一眼 —— 里面按「症状 → 真因 → 规矩」记了六大类，并标出哪些已经用脚本拦住、哪些仍只靠注释（还会重犯）。

**TypeScript 迁移（进行中）**：领域类型在 `src/types/resume.ts`；`src/data`、`src/stores`、核心 `src/utils`、关键 composables 与**整个 `server/`** 已是严格模式 TS，用 `npm run typecheck`（vue-tsc）把关，并由 CI 强制执行（Vite 构建只转译不做类型校验，类型错误不会让 Build 失败，因此 typecheck 必须单独跑）。`server/` 由 Node 内置的类型剥离直接执行 `.ts`，不带构建步骤，细节见 [server/README.md](./server/README.md)。

**一个曾被写错的进度数字**：这里原写「Vue 组件（进行中，18/48）」。「48」这个分母从来没核实过，而那句真正想说的是**从 JS 迁到 TS 的进度**——不是 `<script setup>` 的进度。两者的现状差别很大：

| 维度                  | 现状                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `<script setup>` 写法 | **全部组件**已改用它（`export default`、`defineComponent`、`setup()` 返回对象均为 0 处）                                            |
| `lang="ts"`           | **全部组件**已是 TS（约 15,000 行），已无 JS 组件                                                                                   |
| 这些组件受类型检查吗  | **受**。`include` 收了 `src/**/*.vue`，由 `npm run typecheck` 把关。**但 `src/` 下 22 个 `.js` 不受**（见 `.agent/conventions.md`） |

> 这里原先写的是「64 / 64」，而实际已经是 67 个 `.vue` —— **数字写下的那天是对的，之后新增组件就悄悄过期了**，且没有任何检查发现它。现已把「`.vue` 数量与 README 分数一致」加进 `npm run check:agent-docs`，以后漂移会直接失败。

实测过「打开 `checkJs` 直接检查现有 JS 组件」这条路：会报 **644 处**错误，其中 289 处只是缺参数注解（`TS7006`）—— 说明这条路的前期噪音很大，**逐组件迁 TS 比全局开 `checkJs` 更可控**。所以策略是分批迁，而不是一次性打开开关。

**已迁的层**：`src/templates/**`（12/12）、`src/components/paper/**`（2/2）、`src/components/preview/**`（3/3）、`src/components/collection/**`（1/1）、`src/pages/**` 里除 `AdminPage` / `CollectionPage` / `HomePage` 外的页面（`SharePage` / `LoginPage` / `EditorPage`）与 `App.vue`，以及编辑器面板一层（`SectionList` / `ContentPanel` / `TitleSection` / `TypographySection` / `ImageTemplatePanel`）。

模板层值得优先迁：它在编辑器、分享页、官网合集**三处共用同一份数据**，用具体类型收口后，数据形状漂移会在这里报出来，而不是渲染成空白。

**迁移当场抓到三类真问题**（都不是看代码能发现的，且**都属静默失效**）：

1. **`scrollMode: 'if-needed'` 不是合法属性**（`SectionList.vue`）。标准里只有 `behavior` / `block` / `inline`，浏览器**直接忽略未知属性** —— 注释承诺的「卡片已在视野就完全不动」从来没有生效过，一直是无条件滚动。长期没被发现的原因是：忽略它**不报错也不警告**。已改为自己判可见性，把承诺真正落实。
2. **`sectionLayoutStyle` 返回 `object`**，模板里 `:style="sectionLayoutStyle(section)"` 直接报类型错误。已转 `.ts` 并显式声明返回类型 `SectionLayoutStyle`（含 `--sec-align` 等自定义属性）。
3. **「先建对象再补键」**（`ImageTemplatePanel.vue`）：`const patch = { customLayout }` 之后 `patch.accent = ...`，TS 里 patch 被推断成 `{ customLayout }`，补键那行报错。运行结果一样，但已改成一次构造，更清楚表达「最多改这几项」。

另外三处「能跑但顺序/类型不对」：`ContentPanel` 里 `removeFlash` 在声明前被使用（`let` 的 TDZ，只因 `go()` 只在点击时调用才一直没炸）；`CollectionCard` 的 `resizeObserver` 隐式 `any` 且 `observe(viewportRef.value)` 未判空；`PreviewToolbar` 的 `offset` 标成可选而模板在 `v-if` 内直接读 `offset.x`（类型系统看不到这层相关性，改为如实描述调用方为必填）。

**一处「类型系统看不到的相关性」**（`SharePage.vue`）：模板里直接写 `shared.resume.xxx`，它被 `v-else` 保护着（对应 state 非 error），但类型系统看不到这层相关性，报「possibly null」。加一个按 `state` 收窄的 `readyResume` computed 来表达这个前提，比在模板里到处写 `shared?.` 更准 —— 它同时说明了「就绪」才是这些字段可用的条件。

**一处我凭直觉写错的类型**：给 `ImageAnalysis.ratio` 写 `number`，理由是「百分比是数字」；实际 `nearestRatio` 返回的是离散字符串档位（`'28' | '34' | '40'`），`CustomLayout.ratio` 也声明为 `string`。类型检查当场纠正 —— **凭直觉写类型正是最容易错的地方**。

**模板渲染验证（`npm run verify:templates`）**：模板迁 TS 改的是 props 声明，**编译不报错、类型也通过**，但万一把 prop 名或形状写错，模板会静默渲染成空白——单测（只验注册表）和构建都发现不了。所以逐个切一遍、数一数纸上有多少可见文字（12/12 通过，文字约 890 字、纸高 1123px，各模板 class 互不相同）。

这个脚本自己也踩过一次坑，值得记：第一版想直接改 Pinia store（`#app.__vue_app__` → `$pinia`）来切模板，实测拿不到 pinia 实例，12 个模板全报 `apply=no-store`——**工具坏了，却看起来像 12 个模板都渲染失败**。改成黑盒点真实按钮后 12/12 通过。这与审计脚本那两次教训是同一类：**先怀疑工具，再怀疑被测对象**。

**弹窗一层已迁完（10 个）**：`AISettingsDialog` / `ResumeManagerDialog` / `ShareDialog` / `JdMatchDialog` / `CompletenessDialog` / `AIPolishDialog` / `OnboardingDialog` / `PasswordDialog` / `ShortcutsDialog` / `CaptchaDialog`。

这一批暴露的问题高度重复，都是同一个模式：**`shallowRef(null)` 被推成 `Ref<null>`，读 `.value.x` 就报「`never` 上不存在」**，以及 `catch` 参数是 `unknown` 不能直接取 `.code` / `.message`。处理办法是就近声明形状（这些上游工具函数还在 JS 里，`checkResume` / `parseJdMatchResult` / `fetchMyShares` 等），而不是为了一个返回值去转整个工具文件。

**一处类型检查在「调用方」报错，说明载荷写准的价值**：给 `AIPolishDialog` 的 `apply` 事件一开始漏写了参数（写成 `apply: []`），结果报错出现在**用到它的** `TextSectionEditor`（「(text: string) => void 不能赋给 () => any」）。错在 AIPolishDialog、报在别处 —— 这正是事件载荷该写准的理由。

**新增 `npm run verify:dialogs`**：弹窗迁 TS 改的是类型与收窄，编译不报错、类型也通过，但 props / emit 载荷或 ref 收窄改错会让弹窗**打不开或点了没反应** —— 单测不挂载这些组件、静态审计也看不到（弹窗默认不渲染）。所以真的点开五个（简历体检 / JD 匹配 / 我的简历 / AI 补充导入 / 快捷键），确认弹出且内有文字：5/5 通过，控制台无错误。

**头像与认证一层已迁完**：`AvatarCropDialog` / `AvatarEditor` / `AuthPanel` / `ExperienceEntryEditor`。

这一批有两处值得记：

- **`ExperienceEntryEditor` 用上了可辨识联合**：props 由 `{ type: Object }` 改成 `section: EntriesSection`（`type` 字段是字面量 `'entries'`）。这正是联合类型的用法 —— 若只写宽泛的 `Section`，模板里取 `section.items` 就会报错，提醒「先确定是哪种模块」。另外 `polishTarget` 从 `null` 收成 `Bullet | null`。
- **类型检查报出的多是真实的可空时序**，不是纯噪音：`recentre()` 读 `imgSize.value.width` 而 `applyScale()` 里已有同样的判空 —— 说明这条守卫当初就是漏写的；canvas 的 `getContext('2d')` 可能返回 null；`imgSize` 在图片加载完成前确实是 null。补守卫的同时把注释写清楚「为什么这里会是 null」。

**`TemplatePicker` 已迁完**（540 行）。它只有 8 处问题，其中一处值得记：`isStyleActive` 里 `Object.entries(preset.patch)` 会把键退化回 `string`，于是 `store.theme[key]` 报「不能用 string 索引 Theme」。做法是断言成 `keyof Theme`，而**不是把 `store.theme` 放宽成 `Record`** —— 后者会让整个主题失去类型。

**迁移已全部完成（64 / 64）**。最后两个大件：

- **`TopBar`（778 行）** 与 **`AdminPage`（823 行）** 都迁完了。

**这里推翻了我自己先前的一个建议。** 我原以为「给这两个文件单独开 `checkJs` 比迁 1,600 行划算得多」。实测：`checkJs` 会报 **228 处**，其中 **122 处是缺参数注解**——而 TS 迁移**同样要补这些注解，但迁完还有真类型推断、且代码更统一**。所以这条路并不更便宜，我做的是迁移（`TopBar` 13 处、`AdminPage` 64 处）。

**一处「类型检查在调用方报错」的例子**：`TopBar` 读 `quota.value.remaining` 报「never 上不存在」，根因不在它，而在上游 `usePdfExport.js` 里 `shallowRef(null)` 被推成 `Ref<null>`。用 JSDoc 引用服务端已有的 `QuotaStatus` 类型解决（`import type` 会被擦除，不产生运行时依赖）——与 `bandRect` 是同一处理：**能用标注解决的事，不必把整个文件迁 TS**。

**`AdminPage` 还暴露出一处「只在代码里用、没写进形状」的字段**：`DraftPreset` 上的 `isNew`（本地新加、尚未保存的风格）。类型检查把它点了出来。

同时把**登录页纳入交互态审计**，立刻报出 2 处：`.auth-tab` **连 `:hover` 都没有**，而选中态的文字已是最深一档、边框色又与 hover 设的相同 —— 于是两个页签（登录 / 注册）鼠标移上去都毫无反馈。修法与编辑器面板的页签一致。

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
- **配置分层**：`eslint.config.js` 按目录区分浏览器/Node 全局；`server/render.ts` 的浏览器回调、`server/sanitize.ts` 的控制字符正则都有注明原因的豁免，不让规则静默放过特例；
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
    api.ts           **所有 /api 调用的唯一出口**：端点常量 + 统一错误码 + request/requestBlob
    styleMatrix.ts   模板 × 风格兼容矩阵的语义（空行 = 不限制），读写两端共用
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
markdown-hosts/      在外编辑器里写简历（同一份 .md 的另一种用法）
  resume.css         三宿主共用主题（Typora #write / Obsidian 预览 / VSCode body）
  templates/         起始模板，由应用自己的导出器生成（npm run build:host-template）
tests/               Vitest 测试
  api.test.js         /api 集成测试（起真实服务进程，发真实 HTTP）
  api/harness.js      集成测试宿主：临时数据库 + 随机端口 + cookie jar
```

## 数据与安全要点

- 简历数据在服务端入库前全量过 `server/sanitize.ts` 白名单清洗（分享出去的内容同样如此）；渲染页面禁止访问外部源；
- 密码 scrypt 摘要存储，会话为服务端 Session + httpOnly Cookie，登录失败按「IP+用户名」锁定；注册另设滑块验证码与限频；
- AI API Key 只存用户浏览器本地，`/api/ai/chat` 转发即用即弃，不落库不打日志；AI 转发与图片代理均带 SSRF 防线（`aiGuard.ts` / `imageProxy.ts`）；
- 所有运行时数据集中在 `server/.data/`（SQLite 单文件），备份/迁移拷这一个目录即可。

**`PreviewPane` 已迁完**（420 行，就地编辑 / 框选 / 拖拽的编排）。过程中遇到一个值得记的取舍：它读 `bandRect.value.left` 报「`never` 上不存在该属性」，根因是上游 `usePaperSelection.js` 里 `shallowRef(null)` 被推成 `Ref<null>`。

两条路：把 406 行的指针状态机整体转 TS（一试就引出 46 处错误，改动面远大于收益），或者**只给那个 ref 加 JSDoc 类型标注**。选了后者 —— tsconfig 已开 `allowJs`，TS 会读 JSDoc，调用方拿到真类型，而那份脆弱逻辑一行未动。**能用标注解决的事，不必用重写解决。**
