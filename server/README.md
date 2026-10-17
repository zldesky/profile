# server/ 的 TypeScript 迁移

状态：**进行中（3/9 文件已迁完并标注类型，6 个尚未开始）**。

## 为什么可以不带构建步骤

Node 22.18+ 内置类型剥离（本机实测 `process.features.typescript === 'strip'`），
因此 `node server/index.js` 这类启动方式可以直接换成 `.ts`，**不需要 tsc 构建、不需要 ts-node**。
代价是两条硬性约束：

1. **相对导入必须写全 `.ts` 扩展名**（`./auth.ts`），否则运行时解析不到；
2. **不能用需要代码生成的语法**：`enum`、`namespace`、构造函数参数属性、
   以及 `import { SomeType }` 这种把类型当值导入的写法——类型导入一律写
   `import type { ... }`，否则剥离后运行时会找不到该导出。

TS 侧对应开启 `allowImportingTsExtensions`（仅在 `noEmit` 下可用，正好符合本项目）。

## 进度

| 文件            | 行数 | 状态                              |
| --------------- | ---- | --------------------------------- |
| `semaphore.ts`  | 88   | ✅ 已迁移并标注类型               |
| `imageProxy.ts` | 149  | ✅ 已迁移并标注类型               |
| `captcha.ts`    | 224  | ✅ 已迁移并标注类型               |
| `auth.ts`       | 343  | ⬜ 已改名，类型未标注（约 32 处） |
| `sanitize.ts`   | 291  | ⬜ 已改名，类型未标注（约 35 处） |
| `aiGuard.ts`    | 204  | ⬜ 已改名，类型未标注（约 14 处） |
| `db.js`         | 553  | ⬜ 未开始                         |
| `render.js`     | 216  | ⬜ 未开始                         |
| `index.js`      | 1090 | ⬜ 未开始                         |

已迁移的 6 个模块全部通过现有单测（`tests/semaphore|imageProxy|captcha|auth|sanitize|aiGuard.test.js`），
且 `node server/index.js` 可正常启动——**运行时是好的，缺的只是类型标注**。

## 怎么继续

1. 给 `auth.ts` / `sanitize.ts` / `aiGuard.ts` 补参数与返回值类型（错误基本都是 TS7006，
   即隐式 `any` 参数）；其中 `sanitize.ts` 的白名单清洗是安全边界，建议顺手把
   `ALLOW` / `ICON_OPTIONS` 之类改成 `as const`，让枚举值从「注释里写着的约定」变成类型约束。
2. 把 `db.js` → `db.ts`：`node:sqlite` 的 `DatabaseSync` 自带类型，收益较高。
3. 把 `render.js` → `render.ts`：注意 `page.evaluate` 的回调在浏览器上下文执行，
   类型上要按浏览器环境给（`eslint.config.js` 里已有对应豁免，别删）。
4. 把 `index.js` → `index.ts`（1090 行、无测试，最需要小心）。
5. 每步改完后同步更新这些启动路径里的文件名：
   - `package.json` 的 `pdf` / `dev:all` 脚本
   - `deploy.sh` 里 systemd 的 `ExecStart`
   - `Dockerfile` 的 `CMD`
   - 各 `tests/*.test.js` 的 `../server/xxx.js` 导入
6. 全部标注完成后，把 `tsconfig.json` 的 `include` 加回 `"server/**/*.ts"`，
   `npm run typecheck` 即会覆盖服务端。

## 刻意不做的事

`tsconfig.json` 目前**没有**包含 `server/**/*.ts`，这是有意的：只剩一个文件没标注时，
typecheck 就会失败并挡住 CI。与其让流水线长期红着，不如先把未标注的文件排除在外，
迁移完成后再加回来。因此服务端类型**现在还不受 CI 保护**，这是当前已知的缺口。
