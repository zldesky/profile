# 护栏：哪些约定已经被机器兜住了

这份文档只回答一个问题：**「这条规矩我写进文档了」和「这条规矩破不了」之间差多少。**

`.agent/AGENTS.md` 与 `conventions.md` 里大量约定是**口头**的（「调接口一律走
`src/utils/api.ts`」「模板只负责渲染」）。文档会被读一次，代码会被改一百次 ——
约定必须有机器版本，否则它只是建议。

本文件登记**已经落地成可失败断言**的约定，以及它们的**证明方式**。
新增护栏时按同样格式追加：规则 → 拦什么 → 怎么证明它真的会拦。

> 判定标准只有一条：**如果功能/约定是坏的，这条会红吗？**
> 不确定的护栏一律按「没这条护栏」算。

---

## 一、ESLint 分层依赖（`eslint.config.js`）

| 规则                                                                          | 拦什么                    | 为什么                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/templates/**` 禁止 import `@/stores/*`、`@/composables/*`、`@/utils/api` | 模板里注入状态机或发请求  | 同一套模板被编辑器、分享页 `/share/:id`、PDF 渲染服务三处复用。模板一旦拿到 store，公开分享页会连带加载整个编辑器状态机 |
| `src/utils/**` 禁止 import `@/components/*`、`@/stores/*`、`vue`              | 纯逻辑层被拖进 Vue 运行时 | `src/utils` 在 Node 里被 `tests/` 直接 import；引了组件就必须装 DOM 桩                                                  |
| `src/components/**`、`src/pages/**`、`src/composables/**` 禁止裸 `fetch`      | 手写网络请求              | 本项目曾有 20 处手写 fetch，演变成四五种错误语义（有的抛 `.code`、有的返回 null、有的静默返回空数组）                   |
| `src/**` 禁止 `console.log` / `console.error`（只允许 `console.warn`）        | 调试输出留在线上          | 浏览器控制台没有任何采集，用户看不到也没人看得到。需要提示用户的走 `useToast`                                           |

**两处具名豁免**（`src/templates/index.js`、`src/utils/avatarStore.js`）：
那里的 `console.error` 是**降级路径的信号** —— 模板 chunk 加载失败回退经典单栏、
IndexedDB 不可用回退内联存储。两者在界面上都没有任何变化，只有控制台能说明原因。
豁免是具名的、有注释的，不是「整目录关掉」。

### 证明它会拦（改动护栏后必须重做一次）

```sh
# 1. 模板不该引 store
#    在 src/templates/ClassicTemplate.vue 的 import 段加一行：
#      import { useResumeStore } from '@/stores/resume'
#    期望：npm run lint 报 no-restricted-imports → 删除该行后恢复通过

# 2. 组件不该裸 fetch
#    在 src/composables/useMediaQuery.js 末尾加：
#      const probeNet = () => fetch('/api/health')
#      export { probeNet }
#    期望：npm run lint 报 no-restricted-globals → 删除后恢复通过
```

两条都**实际执行过**（2026-10-23，结果分别为 1 error / 1 error，恢复后 exit 0）。

---

## 二、文档漂移（`tools/check-agent-docs.mjs`）

它把 `.agent/` 四份文档里**可机械核对**的断言抽出来跑：内部链接可达、提到的
`npm run X` 脚本存在、`conventions.md` 声称的「N 个 `.js` 不受类型检查」与工作区实际数量一致。

**它自己就是一次踩坑的产物**：曾经用 `git ls-tree HEAD` 数已提交的 `.js`，
于是「迁完 TS 但还没提交」时脚本照样报一致，CI 才红。

**本次发现它没覆盖到的一类漂移：数字被校验了，但分布表里点名的文件名不会。**
`conventions.md` 声称分布是 `composables 8 + utils 10 + router 2 + templates 1 + main 1 = 22`，
而工作区实际是 23 —— 新迁出来的 `src/utils/selection.js` 不在任何一行的名单里。
总数与分布表**同时**错误时，光靠「总数字符串比对」能抓到；但若总数恰好对、
名单漏了一个、另一行多写了一个，就会漏。

规矩：**分布表里的每个目录都要点名到文件**，数一遍名字应当等于该目录的 `.js` 数量。

---

## 三、还没被机器兜住的（诚实清单）

写下来，免得后来者以为「文档写了就等于做了」：

| 约定                         | 现状                                    | 缺口                                                                     |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| 新增简历字段要动四处         | `tests/sanitize.test.js` 覆盖白名单行为 | 没有断言「`src/types/resume.ts` 的字段 ⊆ `server/sanitize.ts` 的白名单」 |
| 模板内联事件只写单条语句     | 只有 `npm run build` 会炸               | CI 有 build，算半兜住；但本地 `npm run check` 不含 build                 |
| 界面样式只消费 `--ed-*` 令牌 | `tools/audit-ui.mjs` 量对比度           | 不检查「是否写了颜色字面量」                                             |
| `format:check` 必须是绿的    | 本地可跑                                | **CI 尚未包含该步**（P0-2 待办）                                         |
| 服务端能真启动               | 单测覆盖 `/api` 大量路径                | 没有「启动后打一次 `/api/health`」的 CI 步骤（P0-2 待办）                |
