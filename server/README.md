# server/ 的 TypeScript 迁移

状态：**进行中（6/9 文件已迁完并标注类型，`db` / `render` / `index` 尚未开始）**。

## 为什么可以不带构建步骤

Node 22.18+ 内置类型剥离（本机实测 `process.features.typescript === 'strip'`），
因此 `node server/index.js` 这类启动方式可以直接换成 `.ts`，**不需要 tsc 构建、不需要 ts-node**。
代价是两条硬性约束：

1. **相对导入必须写全 `.ts` 扩展名**（`./auth.ts`），否则运行时解析不到；
2. **不能用需要代码生成的语法**：`enum`、`namespace`、构造函数参数属性、
   以及 `import { SomeType }` 这种把类型当值导入的写法——类型导入一律写
   `import type { ... }`，否则剥离后运行时找不到该导出。

TS 侧对应开启 `allowImportingTsExtensions`（仅在 `noEmit` 下可用，正好符合本项目）。

## 进度

| 文件            | 行数 | 状态                |
| --------------- | ---- | ------------------- |
| `semaphore.ts`  | 106  | ✅ 已迁移并标注类型 |
| `imageProxy.ts` | 168  | ✅ 已迁移并标注类型 |
| `aiGuard.ts`    | 221  | ✅ 已迁移并标注类型 |
| `captcha.ts`    | 256  | ✅ 已迁移并标注类型 |
| `render.ts`     | 233  | ✅ 已迁移并标注类型 |
| `sanitize.ts`   | 328  | ✅ 已迁移并标注类型 |
| `auth.ts`       | 390  | ✅ 已迁移并标注类型 |
| `db.ts`         | 705  | ✅ 已迁移并标注类型 |
| `index.js`      | 1090 | ⬜ 未开始           |

已迁移的 8 个模块通过现有单测（98 例），`node server/index.js` 可正常启动，且
`tsconfig.json` 的 `include` **已包含 `server/**/*.ts`** —— 它们受 `npm run typecheck`
与 CI 保护；`eslint.config.js` 也已接入 typescript-eslint，`.ts` 同样受 lint 覆盖。

除单测外，还真实跑通过一次端到端导出：`POST /api/pdf` 返回 200、`application/pdf`、
约 100KB、以 `%PDF-` 开头，该链路依次经过 render → sanitize → semaphore → db。

注意：`index.js` 仍是 `.js`，因为 `checkJs` 未开，它**不在**类型检查范围内；
一旦改名为 `.ts` 而未标注类型，会立刻让 typecheck 失败。

## 怎么继续

只剩 `index.js` → `index.ts`（1090 行、**零测试**，路由与配额、分享、AI 转发、
图片代理的汇聚点）。建议**先补测试再迁类型**，理由与当初处理 `stores/resume`
一致：它现在既没有类型也没有测试，任何改动都没有安全网。

改完后同步更新这些启动路径里的文件名：

- `package.json` 的 `pdf` / `dev:all` 脚本
- `deploy.sh` 里 systemd 的 `ExecStart`
  - `Dockerfile` 的 `CMD`
  - 各 `tests/*.test.js` 的 `../server/xxx.js` 导入

## 类型化带来的实际约束

这几处是把「注释里写着的约定」变成「编译期检查」的地方，也是这次迁移真正的收益：

- `sanitize.ts` 的 `SECTION_TYPES` 标注为 `readonly SectionType[]` —— 模块类型清单与
  `src/types/resume.ts` 的联合类型绑定，写错会编译失败而不是静默放过；各 `*_SPEC`
  标注为 `FieldSpec`，使「键集合即白名单」在类型上成立。
- `auth.ts` 导出 `PasswordVerdict` / `PasswordGuard` / `LoginGuard` ——
  「没带口令」必须与「口令错误」区分（前者若计入失败次数，正常轮询会把服务锁死）
  这条安全语义从注释变成了返回值类型。
- `aiGuard.ts` 与 `imageProxy.ts` 导出 `LookupFn` —— SSRF 防线的 DNS 注入点写明后，
  测试替身与实现不会悄悄走样。
