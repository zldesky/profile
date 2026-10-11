# 无界面 API（Bearer 通道）

应用服务（Express，默认 `127.0.0.1:3001`）提供脚本可用的 HTTP 接口。脚本调用与浏览器
调用的区别只在认证方式：脚本用 `Authorization: Bearer <PDF_ACCESS_PASSWORD>`，
浏览器用登录会话。

## 准备服务端

```sh
# 项目根目录；.env 里至少配置 PDF_ACCESS_PASSWORD（自定强口令）
npm run pdf            # 或 Docker：docker compose up -d --build
```

- `PDF_ACCESS_PASSWORD` 不设置时 Bearer 通道**不存在**，脚本调用一律 401；
- PDF 渲染依赖 Edge/Chrome（裸机）或镜像内置 Chromium（Docker）；
- 口令连续错 10 次锁 15 分钟（按 IP 计），别把错口令写进循环重试。

## GET /api/health — 探活与额度

```bash
curl -s http://127.0.0.1:3001/api/health -H "Authorization: Bearer $PDF_ACCESS_PASSWORD"
```

返回 `ok / authRequired / quota {used, limit, remaining} / globalQuota`。**导出前先查
额度**，`remaining === 0` 时当天别再试，直接改走 JSON 导入或打印导出。

## POST /api/pdf — 导出矢量 PDF

```bash
curl -sS -o 张伟-前端开发.pdf \
  -H "Authorization: Bearer $PDF_ACCESS_PASSWORD" \
  -H "Content-Type: application/json" \
  -d @request.json \
  http://127.0.0.1:3001/api/pdf
```

`request.json` 即 `{"resume": {...}, "filename": "张伟-前端开发"}`：

- `resume`：按 `data-schema.md` 构建并经 `validate_resume.mjs` 校验通过的对象；
- `filename`：≤ 60 字，非法字符（`/ \ : * ? " < > |`）会被替换为下划线。

成功（200）：响应体为 PDF 二进制（矢量、文本可选中）。响应头：

| 响应头              | 含义                               |
| ------------------- | ---------------------------------- |
| `X-Quota-Remaining` | 本主体今日剩余额度                 |
| `X-Pdf-Cache: hit`  | 命中 10 分钟内容缓存，本次不扣额度 |

失败（JSON 错误体，`{ ok: false, message }`）：

| 状态 | 场景与处置                                                          |
| ---- | ------------------------------------------------------------------- |
| 400  | 简历数据不合法——回 `validate_resume.mjs` 修，`message` 会说明缺什么 |
| 401  | 口令缺失/错误（`loginRequired: true` = 服务端没开 Bearer 通道）     |
| 429  | 额度用完（当天 0 点重置）或口令连续错误触发锁定（等锁过期）         |

Node 等价写法：

```js
import { writeFile } from 'node:fs/promises'

const res = await fetch('http://127.0.0.1:3001/api/pdf', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.PDF_ACCESS_PASSWORD}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ resume, filename: '张伟-前端开发' }),
})
if (!res.ok) throw new Error(`${res.status}: ${(await res.json()).message}`)
await writeFile('张伟-前端开发.pdf', Buffer.from(await res.arrayBuffer()))
```

## 脚本调用注意事项

- **不要带 `Origin` 头**。服务端用 Origin 白名单防跨站：无 `Origin` 的脚本请求直接
  放行；伪造白名单外的 Origin 会被 403。curl 与多数 HTTP 库默认不带，别手动加。
- 请求体上限 8MB（含头像 dataURL 时留意）。
- 额度：每主体每日 10 次、全站每日 100 次；同内容 10 分钟内重复导出命中缓存不扣额度。

## 没有服务端时的兜底

1. **JSON 导入**：把 `resume.json` 交给用户，编辑器「导入 JSON」即得完整可编辑简历；
2. **打印导出**：编辑器内置，浏览器打印为 PDF，效果依赖打印机设置；
3. **Markdown**：从 JSON 转写纯文本（`#` 姓名、`##` 模块标题、`-` 要点），ATS 友好。
