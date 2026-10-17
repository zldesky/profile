# server/ 的 TypeScript 迁移

状态：**已完成（9/9）**。

## 为什么可以不带构建步骤

Node 22.18+ 内置类型剥离（本机实测 `process.features.typescript === 'strip'`），
因此 `node server/index.ts` 可以直接跑，**不需要 tsc 构建、不需要 ts-node**，
systemd 与 Docker 的启动方式只是把文件名换成 `.ts`。代价是两条硬性约束：

1. **相对导入必须写全 `.ts` 扩展名**（`./auth.ts`），否则运行时解析不到；
2. **不能用需要代码生成的语法**：`enum`、`namespace`、构造函数参数属性、
   以及 `import { SomeType }` 这种把类型当值导入的写法——类型导入一律写
   `import type { ... }`，否则剥离后运行时找不到该导出。

TS 侧对应开启 `allowImportingTsExtensions`（仅在 `noEmit` 下可用，正合本项目）。

## 文件与职责

| 文件               | 行数 | 说明                                             |
| ------------------ | ---- | ------------------------------------------------ |
| `index.ts`         | 1030 | 路由与启动：静态站点、账号、云端简历、导出、分享 |
| `db.ts`            | 705  | SQLite 数据层（`node:sqlite`，无原生编译依赖）   |
| `auth.ts`          | 391  | scrypt 口令摘要、会话令牌、两套失败锁定          |
| `sanitize.ts`      | 328  | 入参白名单清洗（安全边界）                       |
| `requestGuards.ts` | 292  | 认证、来源校验、配额（从 index.ts 抽出）         |
| `captcha.ts`       | 256  | 注册滑块验证码（HMAC 签名挑战）                  |
| `render.ts`        | 233  | playwright-core 驱动本机 Edge/Chrome 渲染 PDF    |
| `aiGuard.ts`       | 221  | AI 转发的 SSRF 防线                              |
| `imageProxy.ts`    | 168  | 远程图片代理（逐跳复检的 SSRF 防线）             |
| `semaphore.ts`     | 106  | 渲染并发信号量                                   |

除单测外，端到端链路也实测过：`POST /api/pdf` 用脚本口令通道返回
200、`application/pdf`、约 98KB、以 `%PDF-` 开头。

## 可测性上的两个刻意设计

**1. 依赖注入而非模块级单例。** `requestGuards.ts` 把所有依赖（db、口令守卫、来源
白名单、时钟、日志出口）作为参数传入，因此不必监听端口、不碰真实数据库即可直测；
`index.ts` 只负责把本进程的实例注入进去，不再内联这些逻辑。

**2. `AuthInfo` 是可辨识联合，不是 `{ kind; userId: number | null }`。**

```ts
type AuthInfo =
  | { kind: 'session'; token: string; userId: number; subject: string }
  | { kind: 'bearer'; userId: null; subject: string }
```

「会话通道必有 userId、脚本口令通道必无」本来就是类型已知的事实。写成联合后，
`req.auth.kind === 'session'` 一处判断即可让 `userId` 收窄为 `number`，
路由里手写的收窄判断也才有类型上的意义。

## index.ts 里的两个访问器

`requireAuth` 之后 `req.auth` 一定有值，但声明合并里它是可选的，且本身是可辨识联合，
所以直接用 `req.auth.xxx` 会到处报「可能为 undefined」。为此收敛出两个函数，
把「什么条件下什么字段存在」写成唯一出处：

- `sessionAuth(req)` —— **要求会话通道**，返回 `{ userId, subject }`。用于云端简历、
  分享、管理后台这类必须有用户身份的路由。
- `subjectOf(req)` —— **两条通道都可以**，只返回 `subject`。用于导出、图片代抓、
  AI 转发这三个对脚本口令同样开放的端点。

**踩过的坑**：导出端点一度误用了 `sessionAuth`，脚本口令调用直接 500
（bearer 没有 userId）。单测不会发现它 —— 因为 `/api/pdf` 没有集成测试 ——
是靠真实跑一次脚本口令导出抓到的。这也是为什么每个阶段都要真实启动一次服务。

## 类型化带来的实际约束

这几处是把「注释里写着的约定」变成「编译期检查」的地方：

- `sanitize.ts` 的 `SECTION_TYPES` 标注为 `readonly SectionType[]` —— 模块类型清单与
  `src/types/resume.ts` 的联合类型绑定，写错会编译失败而不是静默放过；各 `*_SPEC`
  标注为 `FieldSpec`，使「键集合即白名单」在类型上成立。
- `auth.ts` 导出 `PasswordVerdict` ——「没带口令」必须与「口令错误」区分
  （前者若计入失败次数，正常轮询会把服务锁死）这条安全语义变成了返回值类型。
- `aiGuard.ts` 与 `imageProxy.ts` 导出 `LookupFn` —— SSRF 防线的 DNS 注入点写明后，
  测试替身与实现不会悄悄走样。
- `db.ts` 的 `PublicUser` 与 `UserRecord` 特意分开 —— 会话查询不该带出密码摘要，
  这一点现在是类型层面的区分而不是靠自觉。

## 依赖变动

- `server/package.json` 新增 `@types/express`（devDependency）：Express 自身不带类型，
  缺了它 `index.ts` 的 20 个路由处理器全是隐式 `any`。
- 根 `package.json` 新增 `typescript-eslint`：此前 flat config 里
  `js.recommended` 与 `vue/essential` 都不匹配 `.ts`，**所有 TS 文件其实没被 lint 过**；
  补上之后立刻查出 3 个此前不可见的问题（详见该次提交）。

## 尚未做的事

`/api` 的集成测试仍然缺失。`requestGuards` 的单测覆盖了认证与配额的判定逻辑，
但路由本身的编排（例如导出端点该用哪个访问器）只能靠真实调用验证 ——
上面那个 500 就是这么发现的。若要继续加固，建议用 `:memory:` 数据库
起一个真实 app 实例跑端到端请求测试。
