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
| `semaphore.ts`  | 88   | ✅ 已迁移并标注类型 |
| `imageProxy.ts` | 149  | ✅ 已迁移并标注类型 |
| `captcha.ts`    | 224  | ✅ 已迁移并标注类型 |
| `aiGuard.ts`    | 204  | ✅ 已迁移并标注类型 |
| `sanitize.ts`   | 291  | ✅ 已迁移并标注类型 |
| `auth.ts`       | 330  | ✅ 已迁移并标注类型 |
| `db.js`         | 553  | ⬜ 未开始           |
| `render.js`     | 216  | ⬜ 未开始           |
| `index.js`      | 1090 | ⬜ 未开始           |

已迁移的 6 个模块通过现有单测（72 例），`node server/index.js` 可正常启动，且
`tsconfig.json` 的 `include` **已包含 `server/**/*.ts`** —— 这 6 个模块现在受
`npm run typecheck` 与 CI 保护。

注意：`db.js` / `render.js` / `index.js` 仍是 `.js`，因为 `checkJs` 未开，它们**不在**
类型检查范围内；一旦改名为 `.ts` 而未标注类型，会立刻让 typecheck 失败。

## 怎么继续

1. 把 `db.js` → `db.ts`：`node:sqlite` 的 `DatabaseSync` 自带类型，收益较高。
2. 把 `render.js` → `render.ts`：注意 `page.evaluate` 的回调在浏览器上下文执行，
   类型上要按浏览器环境给（`eslint.config.js` 里已有对应豁免，别删）。
3. 把 `index.js` → `index.ts`（1090 行、无测试，最需要小心）。
4. 每步改完后同步更新这些启动路径里的文件名：
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
