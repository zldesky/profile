# 常见任务的标准做法

每条都是「改哪些文件 → 怎么验」。**照顺序做，别跳验证那一步。**

---

## 1. 加一个简历模块字段

以「给 links 模块加一个 `note` 字段」为例。

```
1. src/types/resume.ts                    加到对应 Section 接口
2. src/data/normalizeResume.ts            normalizeXxxSection() 里补默认值
3. server/sanitize.ts                     在两处登记：
                                            - *_SPEC 里加清洗规则（数值用 clampNumber）
                                            - 若是枚举，先进 ALLOW 白名单
4. src/data/defaultResume.ts              默认简历里给值（否则新字段空着）
5. skills/resume-workshop/references/data-schema.md   同步（它声明"与服务端一一对应"）
6. 用到它的模板组件                         src/templates/** 与 src/components/paper/SectionBody.vue
7. 编辑面板                                src/components/editor/sections/**
```

验证：`npx vitest run tests/sanitize.test.js` + `npm run typecheck`，
再真填一次值看纸面与导出的 PDF 都在。

**跳过第 3 步的后果是静默的** —— 前端看着正常，保存到云端后字段消失。

---

## 2. 改界面样式 / 加控件

```
1. src/styles/paper.css 的 :root      确认有没有现成令牌，没有就加
2. 组件 <style scoped>                只写这个组件独有的
3. 检查点击目标 ≥24px                 图标按钮、复选框、滑杆都要看
4. 检查 hover / focus 反馈            见下方第 4 条
5. 检查 prefers-reduced-motion        有动画就加
```

验证：

```sh
npm run dev
npm run audit:ui            # 需另开终端跑 npm run build && npm run pdf
npm run audit:interaction   # 同上
```

**改完一定截图看一眼。** `tools/shoot-pages.mjs` 批量截主要页面，
`tools/shoot-dialog.mjs` 截弹窗；`verify-share-privacy.mjs` 支持 `SHOT_DIR` 指定输出目录。
这条对应 `PITFALLS.md` 的 **D4（样式写了不生效）**：数字全对但看起来是坏的，
那就是坏的 —— 静态审计量不出"丑"。

---

## 3. 加一个 API 端点

```
1. server/index.ts                     app.get/post(...)，按现有顺序放
2. 权限：
   - 必须有用户身份 → guards.requireAuth + sessionAuth(req)
   - 脚本口令也要能用 → guards.requireAuth + subjectOf(req)
   ⚠ 用错会 500：bearer 通道没有 userId
3. 入参清洗                            走 server/sanitize.ts，别直接信 req.body
4. 若是重出网端点                      加限频（参照 aiLimiter / imageLimiter）
5. 返回                                { ok: true, ... } / 失败统一 { ok:false, message }
6. tests/api.test.js                   加集成用例
7. src/utils/api.ts                    路径加进 API 常量（前端调用点不拼字符串）
```

**前端调用一律走 `src/utils/api.ts` 的 `request()`，不要再写 `fetch`。**
这一层统一了 `{ ok, message }` 的读取、非 JSON 响应的兜底与 401/404/429 的分流；
调用方按 `isAuthExpired(error)` 或 `error.code` 判断，**不要匹配中文文案**
（文案会改，码不会）。细节见 [`conventions.md`](./conventions.md) 的「调接口」一节。

验证：`npm test` **并且** `npm run pdf` 真启动一次，用 curl 打一遍。
`/api/pdf` 当年就是靠真跑一次才发现的 500。

> 新增端点**不需要**改 `tests/apiClient.test.js`（那测的是客户端本身），
> 但要确认服务端失败时回的是 `{ ok:false, message }` —— 否则前端拿不到可读提示。

---

## 4. 加交互控件（按钮 / 下拉 / 弹窗）

这个项目的可达性要求是**可验证**的，不是"看起来还行"：

- **焦点可见**：按 Tab 走到它，计算样式必须与未聚焦时至少有一处不同。
- **悬停有反馈**：鼠标移上去，样式必须变化。禁用态除外。
- **选中态不能吃掉悬停态**：`.is-active` 的特异性若高于 `:hover`，
  且两者设了相同的颜色，hover 就完全看不出 —— 这是本项目**查出 5 次**的模式。
  修法是压暗背景（用 `color-mix`，不要写死色值，否则换主题就失效）。
- 组件内的选中态只能写在**该组件自己的** `<style>` 里，全局规则压不过它的特异性。

验证：`npm run audit:interaction`（它按 Tab 真走一遍，并真的移动鼠标）。

---

## 5. 改 PDF 导出 / 分页

```
1. server/render.ts        浏览器探测与页面等待
2. server/renderTarget.ts  EDITOR_PATH（改错 → 静默导出空白页）
3. src/utils/sectionStyle.ts 模块间距 → 内联样式
4. 打印样式                body > *:not(#app) { display: none }（非应用节点不能占分页）
```

验证（三个都要跑，覆盖不同层面）：

```sh
npm run verify:pdf      # 真导出：A4、页数、有没有画字
npm run verify:pages    # 编辑器显示的页数 vs 真实导出页数
npm run verify:templates # 12 个模板逐个看纸面文字
```

---

## 6. 加到拖拽列表里

```
1. 用 DraggableList（别自己接 VueDraggable）
2. 手柄必须有 .ed-drag（条目级）或 .ed-drag-sub（嵌套级）类名
   ⚠ 两层同名会让外层把内层手柄认成自己的 → 拖要点变成拖整段经历
3. 重排走 emit('reorder', ids) → store.reorderXByIds
4. store 侧会校验"传入顺序必须是现有 id 的一个排列"，
   残缺数组会被安静忽略（拖拽组件在增删中间态偶尔给不完整数组）
```

验证：`npm run verify:drag`（真拖），必要时 `verify:drag-ux`（体感：门槛、指示线）。

---

## 7. AI 相关的改动

- Key **只存用户浏览器本地**（`src/utils/aiKeyStore.js`），`/api/ai/chat` 转发即用即弃，
  **不落库、不打日志**。改动时不要把它写进日志或数据库。
- `server/aiGuard.ts` 是 SSRF 防线（协议 / 内网 / 变体地址），
  `server/imageProxy.ts` 对**重定向逐跳复检**。两者都 `redirect: 'error'`。
  **不要为了方便把 redirect 改回 follow** —— 那会绕过地址校验。

---

## 8. 调试一个"用户说坏了"的问题

按这个顺序，别跳：

1. **先复现**。用 `npm run dev:all` 起全套，手动走一遍。
2. **看是不是环境问题**：3001 上是不是旧 `dist`？后端起了吗？是不是缓存？
3. **再怀疑验证工具**（如果用户是拿脚本报的）。
4. 控制台 / 网络面板 / `tools/probe-el.mjs` 量盒子。
5. 才去读代码。

**不要一上来就改代码。** `PITFALLS.md` E 类记的就是这个：凭症状下结论，
然后去修一段本来正确的代码。
