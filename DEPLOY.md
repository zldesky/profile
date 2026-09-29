# 部署文档

项目由两部分组成，部署形态取决于两者是否都在线：

| 部分 | 内容 | 端口 | 必需性 |
| --- | --- | --- | --- |
| 前端（`src/`） | Vue 3 单页编辑器，构建产物为纯静态文件 | 开发 5173 | 必需 |
| PDF 服务（`server/`） | Express + playwright-core，驱动本机 Edge/Chrome 生成矢量 PDF | 3001 | 可选 |

PDF 服务只影响「一键导出」。没有它，编辑、自动保存、JSON 导入导出、「打印导出」全部照常工作。

## 环境要求

- Node.js `^22.18.0` 或 `>= 24.12.0`（根 `package.json` 的 engines 约束；`--env-file-if-exists` 需要 Node 22+）
- 「一键导出」额外要求：机器上装有 Edge 或 Chrome（服务按 msedge → chrome → msedge-beta → chrome-beta 顺序探测，也可用 `BROWSER_PATH` 指定）
- Linux/Docker 部署时：Chromium + 中文字体（否则 PDF 中文会变方框），见「形态三」

## 本地开发

```sh
# 1. 前端依赖
npm install

# 2. PDF 服务依赖（独立 package.json，必须单独装；
#    npm run pdf 以 server/index.js 为入口，模块从 server/node_modules 解析）
cd server && npm install && cd ..

# 3. 可选：配置。复制模板为 .env，按需修改（端口、口令、每日额度）
cp .env.example .env

# 4. 两个终端分别启动
npm run dev    # 前端 http://localhost:5173
npm run pdf    # PDF 服务 http://127.0.0.1:3001
```

开发态无需任何代理配置：Vite 已把 `/api` 代理到 3001（`vite.config.js`）。

## 形态一：本机自用（默认形态，零配置）

```sh
npm run build  # 产出 dist/
npm run pdf    # 同一进程托管 dist/ 静态站点 + /api，访问 http://127.0.0.1:3001
```

只跑 `npm run build && npm run pdf` 即可，不需要常驻 Vite。服务启动时会自动探测渲染源：先试 5173（开发服务器，保证「所见即所得」），不通则回退到自身端口托管的构建产物。想强制指定时设 `RENDER_URL`。

## 形态二：局域网 / 服务器单进程部署

仍是一个 Node 进程：`npm run build && npm run pdf`，但把服务暴露出去。

### 必做的三件事

1. **设置口令**：`.env` 里写 `PDF_ACCESS_PASSWORD=<强口令>`。不设的话，服务检测到非回环 `HOST` 会**拒绝启动**（设计如此：该进程能启动浏览器、能读本机文件）。
2. **声明监听地址**：`HOST=0.0.0.0`（或内网 IP），`PORT=3001`。
3. **放行来源（易踩坑）**：`server/index.js` 的来源白名单默认只含 localhost 端口。一旦用户从域名访问，浏览器请求带 `Origin: https://你的域名`，会被 403。解法是把公网地址告诉服务——设 `RENDER_URL=https://你的域名/`，代码会把该来源自动加入白名单（同时固定渲染源）。

### 反向代理终止 TLS（推荐）

口令在 HTTP 上是明文传输的，公网部署必须套 TLS。以 Caddy 为例（自动签证书）：

```caddy
resume.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Nginx 等价配置：

```nginx
server {
    listen 443 ssl;
    server_name resume.example.com;
    # ssl_certificate ...;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Node 服务本身继续监听 `127.0.0.1:3001`，不直接暴露。

### 常驻运行

Linux（systemd，`/etc/systemd/system/resume.service`）：

```ini
[Unit]
Description=Resume editor + PDF service
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/vue-project
ExecStart=/usr/bin/node --env-file-if-exists=.env server/index.js
Restart=on-failure
Environment=HOST=127.0.0.1
Environment=PDF_ACCESS_PASSWORD=change-me
Environment=RENDER_URL=https://resume.example.com/

[Install]
WantedBy=multi-user.target
```

Windows：任务计划程序开机运行，或 `nssm install resume "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=.env server\index.js"`（工作目录设为项目根），或 `pm2 start npm --name resume -- run pdf`。

## 形态三：Docker 部署

PDF 渲染依赖浏览器二进制与中文字体，镜像里必须装齐；以非 root 运行可避免 Chromium 的 sandbox 限制。

```dockerfile
FROM node:24-bookworm-slim

# Chromium 渲染内核 + Noto CJK 中文字体（缺字体则 PDF 中文全部变成方框）
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV BROWSER_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=1

WORKDIR /app

# 先装依赖再拷代码，充分利用构建缓存
COPY package.json package-lock.json ./
RUN npm ci
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY . .
RUN npm run build

ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001

USER node
CMD ["node", "server/index.js"]
```

```sh
docker build -t resume-studio .
docker run -d --name resume \
  -p 127.0.0.1:3001:3001 \
  -e PDF_ACCESS_PASSWORD=change-me \
  -e RENDER_URL=https://resume.example.com/ \
  resume-studio
```

对外仍建议前置 Caddy/Nginx 终止 TLS（同形态二）。`server/.data/quota.json` 是运行时状态，需要保留额度记录时挂载卷：`-v resume-data:/app/server/.data`。

## 形态四：纯静态托管（GitHub Pages / Vercel / Netlify / 对象存储 + CDN）

```sh
npm run build   # 上传/托管 dist/ 即可
```

- 部署到子路径（如 GitHub Pages 的 `用户名.github.io/仓库名/`）时：`npm run build -- --base=/仓库名/`。
- 可用能力：编辑、自动保存、JSON 导入导出、**打印导出**——全部纯前端。
- 不可用：「一键导出」走 `/api/pdf`，静态托管上不存在，前端会提示改用打印导出（现有降级逻辑已覆盖，无需改动）。
- 路由说明：`src/router/index.js` 路由表为空，单页应用没有深层链接，因此不需要服务端 SPA fallback 配置。

## 环境变量参考

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 服务监听端口，需与 `vite.config.js` 的 `PDF_PORT` 一致 |
| `HOST` | `127.0.0.1` | 监听地址；非回环地址必须配 `PDF_ACCESS_PASSWORD`，否则拒绝启动 |
| `DEV_PORT` | `5173` | 渲染源自动探测的开发服务器端口 |
| `PDF_ACCESS_PASSWORD` | 空（不校验） | `/api` 访问口令；Bearer 认证，错误 10 次锁定 15 分钟 |
| `PDF_DAILY_LIMIT` | `20` | 每自然日导出上限，计数落盘 `server/.data/quota.json`，次日 0 点重置 |
| `RENDER_URL` | 自动探测 | 渲染源；显式设置时其来源同时加入 Origin 白名单 |
| `BROWSER_PATH` | 自动探测 | Chromium 内核浏览器可执行文件路径 |

配置统一写在项目根 `.env`（已 gitignore，模板见 `.env.example`），由 `npm run pdf` 的 `--env-file-if-exists` 自动加载。

## 安全检查清单（对外暴露前逐项确认）

- [ ] 已设置 `PDF_ACCESS_PASSWORD`（强口令），或保持 `HOST=127.0.0.1` 仅本机访问
- [ ] 公网部署时前面有 TLS（Caddy / Nginx 证书），口令不裸奔在 HTTP 上
- [ ] 公网域名已通过 `RENDER_URL` 加入来源白名单，否则浏览器请求全部 403
- [ ] `.env` 未入库（gitignore 已覆盖，提交前 `git status` 复查）
- [ ] 知道每日额度限制的存在与重置时间（次日 0 点），避免误判为故障

## 常见问题

**一键导出提示「未找到可用的浏览器」** — 服务器没装 Edge/Chrome。装一个，或设 `BROWSER_PATH` 指向已有的 Chromium 可执行文件。服务启动日志会打出实际使用的渲染内核。

**导出的 PDF 中文是方框 / 字体不对** — Linux 容器/服务器缺中文字体。Docker 里装 `fonts-noto-cjk`；裸机安装 `fonts-noto-cjk` 或 Windows 字体包，重启服务。

**请求被 403（请求来源不被允许）** — 见形态二第 3 条：把访问域名写入 `RENDER_URL`。

**额度用完但明明是新的一天** — 按自然日、以服务进程所在时区 0 点重置；`server/.data/quota.json` 可查看已用次数，删除该文件即立即清零。

**口令被锁定** — 连续错误 10 次锁 15 分钟，等待即可；本地缓存的错误口令会在下次失败时自动清除（前端已处理）。
