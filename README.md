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

AI 助手默认未配置，不影响其它功能：在编辑器的「AI 设置」里填入任意 OpenAI 兼容服务的 API Key 即可启用（内置 DeepSeek / 智谱 GLM / Kimi / 硅基流动 / OpenCode 等 11 家预设，也可自定义地址）。

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

| 命令                        | 说明                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`               | 仅启动前端（Vite，端口 5173）                                                                                                                        |
| `npm run dev:all`           | 前端 + 应用服务一起启动，退出时同时结束                                                                                                              |
| `npm run build`             | 构建产物到 `dist/`                                                                                                                                   |
| `npm run pdf`               | 启动应用服务（托管 `dist/` 静态站点 + `/api`，端口 3001）                                                                                            |
| `npm test`                  | 运行 Vitest 单测（389 例：鉴权与会话守卫、来源校验、配额、数据清洗、SSRF 防线、导出、简历 store 及其拆解出的持久化/快照/多文档/模块树、AI 客户端等） |
| `npm run lint`              | ESLint 检查（代码质量与 Vue 陷阱）                                                                                                                   |
| `npm run lint:fix`          | ESLint 自动修复                                                                                                                                      |
| `npm run format`            | Prettier 格式化 src / server / tests / 根配置                                                                                                        |
| `npm run format:check`      | 只校验不改动（CI 用）                                                                                                                                |
| `npm run audit:ui`          | **真实浏览器度量**（对比度 / 点击目标 / 文本溢出 / 键盘焦点）。默认审 `/editor`；带 URL 审首页，加 `--shots` 出截图。需先起服务                      |
| `npm run audit:interaction` | 交互态：键盘焦点可见性、悬停反馈（真的按 Tab / 真的移鼠标）                                                                                          |
| `npm run audit:el`          | 量单个元素的盒子与真实命中区，如 `npm run audit:el -- .ed-check`                                                                                     |
| `npm run audit:login`       | 造一个已登录会话令牌，配合 `npm run audit:ui -- --token <令牌>`                                                                                      |
| `npm run audit:session`     | 诊断会话令牌是否真的生效                                                                                                                             |
| `npm run audit:perf`        | 4G 手机档下的加载性能（长任务、启动里程碑、传输量）                                                                                                  |
| `npm run audit:mobile`      | 移动端布局：顶栏高度、逐行按钮、横向溢出定位                                                                                                         |
| `npm run audit:trace`       | 录启动 trace 并按阶段聚合，定位「那 1 秒被谁占了」                                                                                                   |
| `npm run audit:shot`        | 给公开页面（首页 / 合集 / 登录）截图并量栅格与缩略图缩放比                                                                                           |
| `npm run audit:dialog`      | 打开指定弹窗并截图，如 `npm run audit:dialog -- "AI 补充导入"`                                                                                       |

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

**当前结果（三档视口全部为 0）**：对比度不足 0、点击目标不达标 0、文本溢出 0、键盘焦点 12/12 可见。

### 交互态审计（`tools/audit-interaction.mjs`）

上面的审计测的是**静态**状态。但一个控件静止时合规、按 Tab 走到它却看不出在哪，体验照样是坏的 —— 那类问题静态测不出来，必须真的按 Tab 走一遍、真的把鼠标移上去。这个脚本补的就是这个维度，两条规则都能客观验证：

- **焦点可见**：按 Tab 聚焦后计算样式必须与未聚焦时至少有一处不同。**必须用键盘 Tab 而不是 `element.focus()`** —— `:focus-visible` 只在键盘导航下匹配，程序化聚焦测不出真实情况，这是最容易写出「假通过」的地方。
- **悬停有反馈**：鼠标移上去后计算样式必须变化。禁用项排除。

**实测结果**：桌面走过 35 个元素、手机 33 个，**无可见反馈 0 个**；悬停试过 54 / 50 个元素，**完全无变化 0 个，未能悬停到 0 个**。

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
