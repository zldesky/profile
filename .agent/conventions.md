# 工程约定与类型策略

`README.md` 的「工程约定」一节讲了**为什么**；这里只列 AI 动手时**该照着做**的。

---

## 类型检查的真实覆盖范围

这是本仓库最容易误判的一件事，先讲清楚。

`tsconfig.json` 里 `checkJs: false`，且 `include` 只收了 `src/**/*.ts`、`src/**/*.vue`、
`server/**/*.ts`、`vite.config.js`。

**结论：`src/` 下 19 个 `.js` 文件完全不受类型检查。** 它们能通过 `npm run typecheck`
不代表它们是对的 —— 只是根本没被看。分布：

```
src/composables/  8 个   useAvatarDrag useMediaQuery usePageMetrics usePaperSelection
                         usePaperZoom usePdfExport usePdfPassword useResumeFile
src/utils/        8 个   aiKeyStore avatarStore backup exporters
                         history imageCrop imageTemplate selection
src/router/       1 个   index
src/templates/    1 个   index
src/main.js       1 个
                  ────
                  19 个
```

**每一行都要能自己数对上**：点名文件名个数 = 该行声明的数量，各行之和 = 底部总数。
这条之所以单列：曾经总数写 22、`utils` 行却列了 11 个名字（多写了 `selection`，
少写了 `history`），总数对、分布错，读者看到总数正确就会信整张表。
`npm run check:agent-docs` 只比对**总数**，**名单要人自己数** —— 这是它明确的覆盖边界。

注意 `src/utils/` 里还有 16 个**已经迁完的 `.ts`**（`aiClient` `aiFill` `api` `cloudResume`
`collectionApi` `completeness` `entryTime` `exportFlow` `fieldLayout` `filename` `helpers`
`markdownSource` `pageFill` `pdfImport` `resumeStyle` `sectionStyle` `serverPdf` `shareApi`
`styleMatrix` `textNormalize` `validators` `zip`）—— 它们受类型检查，
不要算进上面那 19 个。同一个目录里 `.ts` 与 `.js` 混住，是这个项目迁移到一半的现状。

**迁移进度**：上一轮把 26 降到 22，方法是先动**网络边界** —— `aiClient` `cloudResume`
`serverPdf`（`src/utils/`）与 `useCloudSync`（`src/composables/`）四个文件转 `.ts`。
选它们的理由是类型在这里最值钱（响应体形状、错误码），而且它们的手写 `fetch`
正好一并收进了 `utils/api.ts`。

此后 `fieldLayout` 与 `styleMatrix` 等新增文件直接以 `.ts` 起步，
所以基线仍是 **22 个 `.js`**、`src/utils/` 下 13 个 `.ts`。
下一步迁什么要按「出事代价」排，不要按文件大小排 —— 见 `guards.md` 的诚实清单。

**这对 AI 的直接影响**：你要用的函数如果来自上面那些 `.js`，它的参数与返回值
**没有任何类型保证**。读实现确认形状，不要照着直觉写。

典型翻车：`AIPolishDialog` 的 `apply` 事件一开始漏写参数，错误报在**用到它的**别处组件里。
**错在 A，报在 B** 是常态 —— 报错位置不等于真因位置。

### 想改类型时要守的规矩

- 新写的 `.ts` / `.vue` 一律带类型，别退回 `any`。
- 只在**入口处**允许 `any`，且要写清理由 —— 参考 `src/data/normalizeResume.ts`，
  `RawRecord = Record<string, any>` 是刻意的（职责就是收窄完全不可信的数据），
  eslint 对此有单点豁免。
- 能用标注解决就别整文件迁 TS。`import type` 会被擦除，不产生运行时依赖，
  跨文件引用服务端已有类型（如 `QuotaStatus`）是推荐做法。
- **不要为了让类型通过而把类型放宽**。`TemplatePicker` 里 `store.theme[key]` 的正确修法是
  断言成 `keyof Theme`，而不是把 `store.theme` 退化成 `Record` —— 后者会让整个主题失去类型。

---

## 调接口一律走 `src/utils/api.ts`

**不要在组件或 util 里直接写 `fetch('/api/...')`。**

这一层是后加的，起因是审计时发现 **20 处手写 `fetch`** 散在 10 个文件里，每处各写一套
「怎么读错误、401 怎么办、非 JSON 怎么兜底」：有的抛带 `.code` 的 `Error`、有的返回
`null`、有的静默返回空数组。同一个语义四五种实现，**新增一个端点就要再选一次错误语义**。

现在只有两个出口：`request()`（JSON）与 `requestBlob()`（PDF 下载）。它们负责：

- 统一 `{ ok, message }` 协议：HTTP 非 2xx **或** 响应体 `ok === false` 都算失败；
- 非 JSON 响应（网关 HTML 错误页、空 body）不抛解析异常，回退成「请求失败（500）」；
- 网络层失败包成 `NETWORK`，界面不会拿到裸 `TypeError`；
- 把状态码翻译成固定错误码，**调用方按 `code` 分流，绝不匹配中文文案**。

```ts
import { API, API_ERROR, ApiError, request } from '@/utils/api'

const data = await request<{ resume: Resume | null }>(API.resume)
```

约定：

1. **路径写进 `API` 常量**，不要在调用点拼字符串（拼错了只有运行时才知道）。
2. **分流用 `isAuthExpired(error)` 或 `error.code`**，不要 `error.code === 'AUTH_EXPIRED'`
   直接比 —— 那个 `code` 以前是各模块手搓挂在 `Error` 上的，类型上没有任何保证。
3. **降级要显式**。读配置失败回退内置、读健康检查失败返回 `null` 都是对的，
   但要写注释说明这是刻意降级，不要写成空 `catch`。
4. **`ApiError.code` 的类型收窄**：`/api/pdf` 会挂 PDF 专用细分码（`AUTH_FAILED` 等），
   它们不在 `ApiErrorCode` 联合里，比较时用 `String(code)` 收口（见 `serverPdf.ts` 的注释）。

改这一层时注意：`tests/apiClient.test.js` 覆盖了非 JSON、`ok:false`、401/404/429、
网络失败几条分支，**新增端点不需要改测试，改动语义一定要改**。

---

## 服务端（`server/`）的三条硬约束

`server/` 由 Node 内置类型剥离**直接执行 `.ts`，不带构建步骤**。由此：

1. **相对导入必须写全 `.ts`**：`import { x } from './auth.ts'`。
   写 `./auth` 或 `./auth.js` 运行时都解析不到。
2. **不能用需要代码生成的语法**：`enum`、`namespace`、构造函数参数属性。
3. **类型导入必须 `import type`**：写成 `import { SomeType }` 会保留在运行时，
   剥掉类型后找不到该导出，直接报错。

改动前读 [`../server/README.md`](../server/README.md)，那里还讲了
`AuthInfo` 为什么是可辨识联合、`sessionAuth` 与 `subjectOf` 的区别（用错会 500）。

---

## 新增一个简历字段：先判断是不是「枚举字段」

服务端是白名单制，**未登记的键会被静默丢弃**，不报错。所以只改前端会「保存后没了」。

### 若是枚举字段（取值来自固定选项表），`presets.ts` 也要动

这一条最容易漏：`server/sanitize.ts` 的枚举**不是自己写的字面量**，而是从
`src/data/presets.ts` 跨端 import 进来的（`sanitize.ts` 顶部第 22 行
`from '../src/data/presets.ts'`，注释写明「保证与服务端白名单永不脱节」）。

所以加枚举值时顺序是：

1. `src/data/presets.ts` 加选项（`SECTION_ALIGN_OPTIONS` / `TITLE_STYLES` 这类导出）
2. `src/types/resume.ts` 把联合类型同步
3. `server/sanitize.ts` **不用手改枚举** —— `valuesOf()` 会自动从 presets 取值；
   但若这个字段是**新键**，仍要在对应 `*_SPEC` 里登记
4. 其余同下表

**只改 `sanitize.ts` 的 `ALLOW` 而不动 `presets.ts` 是无效的** —— `ALLOW` 本身就是
从 presets 算出来的（`valuesOf(...)`），改它反而是改错了地方。

### 完整清单

| 顺序 | 文件                                               | 做什么                                   |
| ---- | -------------------------------------------------- | ---------------------------------------- |
| 1    | `src/data/presets.ts`                              | **仅枚举字段需要**：加选项               |
| 2    | `src/types/resume.ts`                              | 加类型 / 同步联合                        |
| 3    | `src/data/normalizeResume.ts`                      | 旧数据补齐默认值（导入路径也走这里）     |
| 4    | `server/sanitize.ts`                               | 登记字段与取值范围；数值要 `clampNumber` |
| 5    | `src/data/defaultResume.ts`                        | 默认简历里给初始值（可选但通常需要）     |
| 6    | `skills/resume-workshop/references/data-schema.md` | 与 `sanitize.ts` 一一对应，必须同步      |

第 6 步容易被忘：那个文档写的是「服务端会接受什么」，不同步就是**文档在说谎**。

**验证**：`npm test` 里 `tests/sanitize.test.js` 覆盖白名单行为，加用例比手测可靠。

---

## 样式

- 界面外壳的颜色 / 圆角 / 阴影**只从 `src/styles/paper.css` 的 `:root` 取**。
  这个项目做过一次收敛：46 种颜色字面量、24 种圆角归到令牌，别再散回去。
- **`src/templates/**` 是例外**：那里的 `#4b5563` / `#d1d5db` 是**简历内容自身的配色**，
  跟着 `--accent` 走，刻意不接令牌 —— 否则改界面会改到用户导出的简历。
- 同类角色用同一档。分段控制器内外圈、图标按钮与输入框的圆角差 1px 看不出来，
  并排就是不齐。
- 点击目标 **≥ 24px**（静态审计门槛）。`<input>` 是替换元素，`::after` 不生效，
  要靠包住它的 `label` 扩命中区。
- 动画要配 `prefers-reduced-motion` 兜底。

---

## 模板里的事件处理器只写单条语句

```vue
<!-- 可以 -->
<button @click="store.undo">

<!-- 不可以：多语句会被 Prettier 折行，Vue 编译器解析失败 -->
<button @click="a(); b()">
```

多动作一律包成 script 里的函数。**这条 lint 和 typecheck 都不报，只有 `npm run build` 会炸**
（`eslint.config.js` 顶部注释记了这件事）。所以改完 `.vue` 别只跑 lint。

---

## 提交

- Conventional Commits：`feat(editor):` / `fix(drag):` / `docs:` / `test(pdf):`。
- husky + lint-staged 会在 commit 时对暂存文件跑 prettier 与 eslint --fix。
  **提交后看一眼 `git diff HEAD~1 --stat`**，确认它没顺手改到你没打算改的地方。
- `npm run check`（typecheck + lint + test）过了再提交；CI 还多一步 build。
