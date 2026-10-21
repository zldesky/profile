# 测试与验证：怎么选、怎么写

这个项目有 **39 个测试文件（558 例）** 和 **30+ 个浏览器验证脚本**。选错了要么白跑，
要么得到假通过。这一页讲怎么选。

---

## 一、先选对层

| 你要验的东西                                 | 用什么                                     | 为什么不能用别的                                          |
| -------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| 纯函数、数据变换、清洗、配额                 | `tests/*.test.js`（Vitest）                | 快，且在 Node 里就能真跑                                  |
| 真实 HTTP 行为、中间件顺序、cookie、建表迁移 | `tests/api.test.js`                        | 它起**真服务进程 + 临时库 + 随机端口**，不走进程内 import |
| 组件真的渲染出来、点了有反应                 | `tools/verify-*.mjs`（真浏览器）           | 单测不挂载这些组件；静态审计看不到交互                    |
| 对比度 / 点击目标 / 溢出                     | `tools/audit-ui.mjs`                       | 需要真实布局计算                                          |
| 键盘焦点 / 悬停反馈                          | `tools/audit-interaction.mjs`              | 必须真按 Tab，`:focus-visible` 程序化聚焦测不出           |
| 性能                                         | `tools/probe-perf.mjs` `trace-startup.mjs` | 默认 4G 手机档限速；开发机上测只会得到乐观结论            |

### 为什么 `/api` 测试要起真进程

`server/index.ts` **不导出 app，导入即 `listen`**。把 app 抽出来单测会漏掉这些接缝：
同一份 `.env`、中间件顺序（来源校验在 body 解析之前）、会话守卫、SQLite 建表与迁移。
**接缝恰恰最容易出问题。**

代价是：`/api/pdf` 至今没有集成测试 —— 它有个 500 的 bug 是靠真跑一次脚本口令导出才发现的
（导出端点误用了只支持会话通道的访问器）。

---

## 二、写验证脚本的六条硬规矩

这些都是这个仓库**真实栽过**的，不是理论。

### 1. 拿不到元素就判 FAIL，不要判跳过

```js
// 错：看起来是"通过"
if (await toolbar.isVisible()) {
  /* 断言 */
} else {
  log(true, '未出现工具条（跳过）')
}

// 对：没出现就是失败，说明前提没满足
log(await toolbar.isVisible(), '工具条出现')
```

真实案例：窄屏下纸面被 `v-if` 隐藏，脚本报「跳过并 PASS」，实际什么都没测。

### 2. 断言必须能失败

写完问自己：**「如果功能是坏的，这条会红吗？」**

典型反例：

- 只比 `background-color` → 渐变按钮的底色是 `transparent`，永远判「无变化」。
  必须同时比 `background-image` 与 `filter`。
- 只断言「元素存在」→ 存在 ≠ 可见 ≠ 可点。
- 报告「0 问题」但分母也是 0 → 必须打印**分母**。

### 3. 多选不是 click

`usePaperSelection` 在 **`pointerdown`** 里做加选/去选，而 `onPaperClick` 里
Ctrl 分支是**直接 return** 的。用 `locator.click()` + modifiers 会以为选中了，实际是空的。

用真实指针序列，并落在模块的边角空白处（避开文字热点，否则会触发就地编辑的 `.ie-layer` 浮层）。

### 4. 滚动会让坐标失效

`getBoundingClientRect()` 拿到坐标后如果中间发生了滚动，那个坐标就废了。
要么一次取完两点再动手，要么滚完重新取。

### 5. 层级判定用 `closest('.dl-list')`

嵌套拖拽列表里「手柄属于哪一层」不能靠类名猜（内层经常没类名）。
`DraggableList` 固定给根元素加 `dl-list`，判定一律走它。

### 6. 别对着旧 `dist` 验证

改完源码没 `npm run build`，`127.0.0.1:3001` 上跑的还是旧产物 —— 你会得出
「改动没生效」的错误结论。`verify-selects.mjs` 有 `assertDistFresh()` 就是为此。

---

## 三、某些"陷阱"其实是测试环境问题

写测试时先排除这些，别急着改产品代码：

| 症状                               | 真因                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| `spawn EPERM`（Vitest 启动即失败） | 沙箱不允许管道捕获子进程输出，不是代码问题                    |
| `ERR_CONNECTION_REFUSED`           | 该脚本连 3001，但你没 `npm run build` + `npm run pdf`         |
| pdf.js 相关测试失败                | 有人全局装了 `document` —— 它会误判自己跑在浏览器里           |
| 导出的 PDF 是空白                  | 渲染源没起来，或 `/editor` 路由/等待选择器被改了              |
| 页数对不上                         | 编辑器的估算与真实分页本来就可能差 1，`verify:pages` 专测这个 |

### 关于 `document`

**不要**往 `vitest.config.js` 的 `setupFiles` 里塞全局 DOM 桩。
需要浏览器 API 的测试自己用 `tests/setup/browser-globals.js` **成对开关**：
先 `installBrowserGlobals()`，测完 `uninstallBrowserGlobals()`，否则会污染同文件后续用例。

---

## 四、测试自己的坑

`tests/api.test.js` 的原则值得抄：**必须用临时数据库**（`DB_PATH` 指向 `os.tmpdir()`），
绝不碰开发用的 `.data/app.db`；收尾连同 `-wal` / `-shm` 一起删，并挂退出兜底清扫。
已验证真实库文件的修改时间在整轮测试前后不变。

`tools/pdf-harness.mjs` 与 `admin-harness.mjs` 同理：起**独立实例**（随机端口 + 放宽额度 +
随机口令），并区分「量不到」与「不一致」两种失败 —— 前者是环境问题，后者才是产品问题。

**验证不要吃掉产品额度。** 导出有双层配额，验证脚本连生产实例跑几次就会把当天额度耗光。

---

## 五、跑之前

```sh
npm test                 # 全部单测（含 /api 集成测试，约 5 秒）
npx vitest run tests/sanitize.test.js   # 单个文件

# 浏览器验证（注意默认端口不同，见 AGENTS.md）
npm run dev              # 然后跑连 5173 的那些
npm run build && npm run pdf   # 然后跑连 3001 的那些
```

失败时**先怀疑脚本**（见 `../PITFALLS.md` A 类 18 条），再怀疑被测对象。
