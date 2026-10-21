# 工程约定与类型策略

`README.md` 的「工程约定」一节讲了**为什么**；这里只列 AI 动手时**该照着做**的。

---

## 类型检查的真实覆盖范围

这是本仓库最容易误判的一件事，先讲清楚。

`tsconfig.json` 里 `checkJs: false`，且 `include` 只收了 `src/**/*.ts`、`src/**/*.vue`、
`server/**/*.ts`、`vite.config.js`。

**结论：`src/` 下 26 个 `.js` 文件完全不受类型检查。** 它们能通过 `npm run typecheck`
不代表它们是对的 —— 只是根本没被看。分布：

```
src/composables/  9 个   useAvatarDrag useCloudSync useMediaQuery usePageMetrics
                         usePaperSelection usePaperZoom usePdfExport usePdfPassword useResumeFile
src/utils/        15 个  aiClient aiKeyStore avatarStore backup cloudResume completeness
                         exporters history imageCrop imageTemplate selection serverPdf validators
                         + 已迁移的 .ts（aiFill helpers markdownSource pdfImport resumeStyle
                           sectionStyle shareApi collectionApi）
src/router/       2 个   index routes
src/templates/    1 个   index
src/main.js       1 个
```

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

## 新增一个简历字段：三处都要动

服务端是白名单制，**未登记的键会被静默丢弃**，不报错。所以只改前端会「保存后没了」。

| 顺序 | 文件                                               | 做什么                                                     |
| ---- | -------------------------------------------------- | ---------------------------------------------------------- |
| 1    | `src/types/resume.ts`                              | 加类型                                                     |
| 2    | `src/data/normalizeResume.ts`                      | 旧数据补齐默认值（导入路径也走这里）                       |
| 3    | `server/sanitize.ts`                               | 登记字段与取值范围；数值要 `clampNumber`，枚举要进 `ALLOW` |
| 4    | `src/data/defaultResume.ts`                        | 默认简历里给初始值（可选但通常需要）                       |
| 5    | `skills/resume-workshop/references/data-schema.md` | 与 `sanitize.ts` 一一对应，必须同步                        |

第 5 步容易被忘：那个文档写的是「服务端会接受什么」，不同步就是**文档在说谎**。

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
