# 部署文档

项目由两部分组成，部署形态取决于两者是否都在线：

| 部分                  | 内容                                                        | 端口      | 必需性 |
| --------------------- | ----------------------------------------------------------- | --------- | ------ |
| 前端（`src/`）        | Vue 3 单页编辑器，构建产物为纯静态文件                      | 开发 5173 | 必需   |
| 应用服务（`server/`） | Express：账号 + 云端简历 + PDF 渲染（驱动本机 Edge/Chrome） | 3001      | 可选   |

服务承载三件事：**账号与会话**（SQLite）、**云端简历同步**、**一键导出 PDF**。没有它，编辑、自动保存（localStorage）、JSON 导入导出、「打印导出」全部照常工作——编辑器不强制登录，匿名用户是「纯本地模式」。

## 环境要求

- Node.js `^22.18.0` 或 `>= 24.12.0`（`node:sqlite` 需要 22.13+，服务端零原生编译依赖）
- 「一键导出」额外要求：机器上装有 Edge 或 Chrome（按 msedge → chrome → msedge-beta → chrome-beta 顺序探测，可用 `BROWSER_PATH` 指定）
- Linux/Docker 部署时：Chromium + 中文字体（否则 PDF 中文变方框），见「形态三」

## 本地开发

```sh
# 1. 前端依赖
npm install

# 2. 应用服务依赖（独立 package.json，必须单独装；
#    npm run pdf 以 server/index.js 为入口，模块从 server/node_modules 解析）
cd server && npm install && cd ..

# 3. 可选：配置。复制模板为 .env，按需修改
cp .env.example .env

# 4. 两个终端分别启动
npm run dev    # 前端 http://localhost:5173
npm run pdf    # 应用服务 http://127.0.0.1:3001
```

开发态无需代理配置：Vite 已把 `/api` 代理到 3001（`vite.config.js`）。

## 形态一：本机自用（默认形态，零配置）

```sh
npm run build  # 产出 dist/
npm run pdf    # 同一进程托管 dist/ + /api，访问 http://127.0.0.1:3001
```

只跑 `npm run build && npm run pdf` 即可，不需要常驻 Vite。服务启动时自动探测渲染源：先试 5173（保证「所见即所得」），不通则回退到自身端口托管的构建产物。

账号系统在本机形态同样可用：注册一个账号即可获得云端简历同步（数据在 `server/.data/app.db`），一键导出按用户计每日额度。

## 形态二：局域网 / 服务器部署

仍是一个 Node 进程：`npm run build && npm run pdf`，把服务暴露出去。

### 一键脚本（推荐）

```sh
git clone <你的仓库地址> /opt/resume && cd /opt/resume
bash deploy.sh
```

`deploy.sh` 会自动完成：swap 检查与创建（2G 以下内存机器）、安装 Node 22 / Chromium / 中文字体、双份 `npm ci`、构建、生成 `.env`、注册并启动 systemd 服务（`resume`）、健康检查。重复执行即更新部署（自动 `git pull` → 重建 → 重启）。执行完的「必做的四件事」（公网域名时）仍需手动补 `.env` 并重启。

### 手动步骤（理解脚本在做什么，或脚本不适用时）

```sh
# 1. Node.js 22（需要 22.18+，node:sqlite 是内置能力）
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 应 >= 22.18

# 2. 渲染内核 + 中文字体（一键导出 PDF 依赖；缺字体的后果是 PDF 中文全变方框）
sudo apt install -y chromium fonts-noto-cjk

# 3. 代码（需要先配好 git 远端并推送；没配就用 tar/scp 拷源码，见前文）
sudo mkdir -p /opt/resume && sudo chown $USER /opt/resume
git clone <你的仓库地址> /opt/resume && cd /opt/resume

# 4. 依赖与构建（server 依赖必须单独装）
npm ci
npm ci --prefix server
npm run build

# 5. 配置
cp .env.example .env
# 编辑 .env，至少设置：
#   HOST=127.0.0.1                （配合反代；直接暴露改 0.0.0.0）
#   BROWSER_PATH=/usr/bin/chromium （Linux 上必须指定，自动探测的 msedge/chrome 渠道在服务器上不存在）
#   公网域名部署再加：ALLOWED_ORIGINS=https://你的域名 和 TRUST_PROXY=1

# 6. 试跑，浏览器确认后再转常驻
npm run pdf
```

2G 内存机器：先加 2G swap（命令见形态三末尾），`RENDER_CONCURRENCY` 保持默认 1。裸机相比 Docker 的好处：省掉 Docker 守护进程的一两百 MB、没有镜像构建的内存峰值，且普通用户运行时 Chromium 沙箱正常生效，**不需要** `--no-sandbox`。

### 必做的四件事

1. **声明监听地址**：`.env` 里 `HOST=0.0.0.0`（或内网 IP）、`PORT=3001`。对外暴露时 `/api` 一律要求登录，匿名请求返回 401——不再像旧版本那样拒绝启动，但安全依赖下面的配置。
2. **放行来源（易踩坑）**：`ALLOWED_ORIGINS=https://你的域名`。服务端来源白名单默认只含 localhost，公网域名的浏览器请求会被 403；此项就是为公网域名准备的。
3. **反向代理终止 TLS**：口令与 Cookie 在 HTTP 上是明文的，公网必须套 TLS。
4. **启用代理头解析**：`TRUST_PROXY=1`。登录锁定、注册限频按 `req.ip` 计数，不设此项在代理后所有请求看起来都来自 127.0.0.1；反过来直接暴露时**不要**设置，否则客户端可伪造头绕过限流。

### 反向代理终止 TLS（推荐）

以 Caddy 为例（自动签证书）：

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Node 服务本身继续监听 `127.0.0.1:3001`，不直接暴露。

### 常驻运行

Linux（systemd，`/etc/systemd/system/resume.service`）：

```ini
[Unit]
Description=Resume editor + app service
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/vue-project
ExecStart=/usr/bin/node --env-file-if-exists=.env server/index.js
Restart=on-failure
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=1
Environment=ALLOWED_ORIGINS=https://resume.example.com

[Install]
WantedBy=multi-user.target
```

Windows：任务计划程序开机运行，或 `nssm install resume "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=.env server\index.js"`（工作目录设为项目根），或 `pm2 start npm --name resume -- run pdf`。

## 形态三：Docker 部署（一键）

前置要求：服务器装 Docker 与 compose 插件（`docker compose version` 能出版本号即可）。

```sh
# 在项目根目录
docker compose up -d --build
# 查看状态与健康检查
docker compose ps
docker compose logs -f resume
```

`docker-compose.yml` 已按安全默认配置好：

- 端口只绑宿主机回环（`127.0.0.1:3001`），供反代使用；直接 `IP:3001` 访问需自行改映射（不推荐公网裸跑）；
- `resume-data` 卷持久化 `server/.data/`（SQLite：账号、简历、配额），容器重建数据不丢；
- 镜像内置 Chromium + Noto CJK 中文字体（缺字体的后果是 PDF 中文全变方框）；
- `shm_size: 256m` + 应用默认 `--disable-dev-shm-usage`，解决容器 `/dev/shm` 默认 64MB 导致的渲染崩溃；
- 容器内没有 user namespace，Chromium 沙箱起不来，compose 里通过 `BROWSER_EXTRA_ARGS: --no-sandbox` 放行——风险已被收窄（渲染只加载应用自身源、外联全断、入参全量清洗），物理机部署时不要带这个参数；
- 内置 healthcheck（探活 `/api/health`）。

公网域名 + TLS 的完整形态：取消 compose 中 `caddy` 服务的注释，把 `Caddyfile.example` 复制为 `Caddyfile` 并填入域名，`resume` 的端口映射改为 `"3001:3001"`（仅 compose 内网），80/443 对外——Caddy 自动签发续期证书，同时按「形态二」的说明设置 `TRUST_PROXY=1` 与 `ALLOWED_ORIGINS`。

不用 compose 时的等价手动操作：

```sh
docker build -t resume-studio .
docker run -d --name resume \
  -p 127.0.0.1:3001:3001 \
  -v resume-data:/app/server/.data \
  --shm-size 256m \
  -e BROWSER_EXTRA_ARGS=--no-sandbox \
  -e TRUST_PROXY=1 \
  -e ALLOWED_ORIGINS=https://resume.example.com \
  resume-studio
```

### 服务器上已有自己的 nginx（80/443 已被占用）

常驻反代容器已经占着宿主机 80/443 时，compose 自带的 nginx 起不来，也不该起。加 `--no-nginx`：

```sh
# TLS 在你自己的 nginx 上终止，Origin 必须与实际访问地址逐字一致，用 --origin 而不是 --domain
bash deploy-docker.sh --no-nginx --origin https://你的域名
```

脚本只构建并启动 `resume` 应用容器，把 3001 发布到宿主机的 `127.0.0.1` 与 `172.17.0.1`（docker0 网关）——`172.17.0.1:3001` 与旧版宿主机部署的访问路径一致，已有 nginx 的 `proxy_pass` 不用改。等价手动命令：

```sh
docker compose -p resume -f docker-compose.yml -f docker-compose.shared-nginx.yml up -d --build resume
```

（服务名 `resume` 必须带上，否则 compose 会把自带 nginx 也拉起来撞死在 80 上；`docker0` 网段被自定义过时，把 `172.17.0.1` 换成 `ip addr show docker0` 里的网关地址。两个发布地址都只在本机与 docker 网络内可达，不经云安全组对公网开放。）

不跑 compose 的纯 `docker build` + `docker run` 等价形态：

```sh
docker build -t resume-studio .   # 国内网络慢可加 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
docker run -d --name resume-studio --restart unless-stopped \
  -p 127.0.0.1:3001:3001 -p 172.17.0.1:3001:3001 \
  -v resume-data:/app/server/.data --shm-size 256m \
  -e BROWSER_EXTRA_ARGS=--no-sandbox -e TRUST_PROXY=1 \
  -e ALLOWED_ORIGINS=https://你的域名 \
  resume-studio
```

更新部署：`git pull && docker build -t resume-studio . && docker rm -f resume-studio`，再重跑上面那条 `docker run`（数据在 `resume-data` 卷里，删容器不丢）。

已有 nginx 的 server 块需要核对（模板见 `nginx/default.conf`）：`client_max_body_size 8m`（缺了保存带图简历被 413）、`proxy_read_timeout 300s`（缺了导出 PDF 504）、`X-Forwarded-For` / `X-Forwarded-Proto`（compose 已设 `TRUST_PROXY=1`，nginx 不带这两个头的话登录锁定会按 nginx 的 IP 计数，误锁全站）、入口 HTML 与 `/api` 不缓存（缺了发版后白屏）。

**从旧版宿主机部署（deploy.sh / systemd）迁移**：先 `sudo systemctl disable --now resume` 停掉旧服务（否则 3001 端口冲突），再执行上面的命令。要保留旧账号与简历，容器起来后把旧库拷进去（路径按实际部署目录）：

```sh
sudo docker cp /opt/vue-project/server/.data/app.db resume-studio:/app/server/.data/app.db
sudo docker exec -u root resume-studio chown node:node /app/server/.data/app.db
docker compose -p resume restart resume
```

### 小内存机器（2G）能跑，但要按这个来

| 部分                             | 大致占用         |
| -------------------------------- | ---------------- |
| 系统 + Docker 守护进程           | 300–500MB        |
| Node 服务（账号/简历/PDF 接口）  | 80–150MB         |
| Chromium 常驻实例（空闲）        | 150–250MB        |
| 单次渲染峰值（大头像、多页简历） | +200–400MB       |
| **渲染时峰值合计**               | **约 0.9–1.2GB** |

结论：**单用户/小流量够用，但没有任何余量跑别的东西**。必须遵守四条：

1. **先加 swap（2G）**：`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`，并写入 `/etc/fstab`。这是把「OOM 杀进程」降级为「变慢」的关键；
2. **`RENDER_CONCURRENCY` 保持 1**（compose 默认即 1）——渲染并发在 2G 机器上没有上调空间；
3. **放开 compose 里的 `mem_limit: 1536m`**：给容器封顶，渲染峰值越界只影响导出（429/失败并自动退还额度），不会拖死宿主机；
4. **同机不要再跑 MySQL/Redis 等其他服务**，也**不要在低峰以外的时间在 2G 机器上重建镜像**——`npm ci` + `vite build` 本身也有几百 MB 峰值，构建期同样吃 swap；稳妥做法是本地（或 CI）构建好镜像推上去，服务器只 `docker compose up -d --no-build`。

另外注意：Cloudflare 等免费的 2G 套餐云主机通常还限制 CPU，渲染耗时的主要来源是 Chromium 单页渲染（约 1–3 秒），CPU 限频会直接放大这个时间，选型时优先保证内存而不是核数。

## 形态四：纯静态托管（GitHub Pages / Vercel / Netlify / 对象存储 + CDN）

```sh
npm run build   # 上传/托管 dist/ 即可
```

- 部署到子路径（如 GitHub Pages 的 `用户名.github.io/仓库名/`）时：`npm run build -- --base=/仓库名/`。
- 可用能力：编辑、自动保存、JSON 导入导出、**打印导出**——全部纯前端。
- 不可用：登录、云端同步、一键导出（走 `/api`，静态托管上不存在），前端会提示改用打印导出（现有降级逻辑已覆盖）。
- SPA 路由说明：`/login` 等深层链接由前端路由接管，主流静态托管默认带 SPA fallback，无需额外配置；自建对象存储需加「全部回退到 index.html」规则。

## 环境变量参考

| 变量                   | 默认值                | 说明                                                   |
| ---------------------- | --------------------- | ------------------------------------------------------ |
| `PORT`                 | `3001`                | 服务监听端口，需与 `vite.config.js` 的 `PDF_PORT` 一致 |
| `HOST`                 | `127.0.0.1`           | 监听地址；对外暴露时 `/api` 仅限登录用户               |
| `DEV_PORT`             | `5173`                | 渲染源自动探测的开发服务器端口                         |
| `DB_PATH`              | `server/.data/app.db` | SQLite 数据库路径（账号/会话/简历/配额）               |
| `PDF_USER_DAILY_LIMIT` | `10`                  | 每用户每日导出上限                                     |
| `PDF_DAILY_LIMIT`      | `100`                 | 全站每日导出总额度（成本兜底）                         |
| `RENDER_CONCURRENCY`   | `1`                   | 同时渲染的浏览器页面上限，小内存机器保持 1             |
| `RENDER_QUEUE_MAX`     | `3`                   | 渲染排队上限，超过直接 429                             |
| `BROWSER_EXTRA_ARGS`   | 空                    | 追加浏览器启动参数（容器内 `--no-sandbox` 从这里进）   |
| `PDF_ACCESS_PASSWORD`  | 空（通道关闭）        | 脚本 Bearer 通道口令；连续错 10 次锁 15 分钟           |
| `ALLOWED_ORIGINS`      | 空                    | 公网域名 Origin 白名单（逗号分隔）                     |
| `TRUST_PROXY`          | 空                    | 前置反向代理时设 `1`，解析 X-Forwarded-*               |
| `RENDER_URL`           | 自动探测              | 渲染源；显式设置时其来源同时加入白名单                 |
| `BROWSER_PATH`         | 自动探测              | Chromium 内核浏览器可执行文件路径                      |

配置统一写在项目根 `.env`（已 gitignore，模板见 `.env.example`），由 `npm run pdf` 的 `--env-file-if-exists` 自动加载。

## 安全模型速览

- **认证**：服务端 Session（SQLite）+ httpOnly SameSite=Lax Cookie，令牌 256 位随机；密码 scrypt 摘要（N=2^15）；登录失败按「IP+用户名」锁定 15 分钟；注册限每小时 5 次/IP。会话过期自动降级为本地编辑，不丢数据。
- **导出防刷**：渲染并发信号量（默认 1 并发 3 排队，队满 429）→ 每用户每日额度 → 全站每日额度 → 同内容 10 分钟缓存命中不扣额度。四层叠加，任何一层被绕过都不会造成实质伤害。
- **输入**：所有简历数据入库/渲染前过 `sanitize.js` 白名单清洗（枚举、颜色、数值、长度、数量），文本剥标签，图片仅限 dataURL 白名单格式。
- **渲染隔离**：渲染页面只允许访问应用自身源，注入内容无法外联；请求体上限 8MB；静态站点带 CSP。
- **日志**：`/api` 请求按一行 JSON 记录（方法、路径、状态、耗时），健康检查除外。

## 检查清单（对外暴露前逐项确认）

- [ ] `ALLOWED_ORIGINS` 已设置公网域名，否则登录与导出全部 403
- [ ] 前面有 TLS（Caddy / Nginx 证书），Cookie 与口令不裸奔在 HTTP 上
- [ ] `TRUST_PROXY=1` 已设置（且服务不直接暴露公网）
- [ ] `server/.data/` 已纳入备份/挂卷策略——丢了它等于丢了所有账号与简历
- [ ] 明确开放注册的口径：如需收紧，可在反代层给 `/api/auth/register` 加访问控制
- [ ] 额度参数符合预期（每用户 10/日、全站 100/日），避免误判为故障
- [ ] 2G 内存机器：swap 已加、`RENDER_CONCURRENCY=1`、`mem_limit` 已放开（见形态三）

## 常见问题

**一键导出提示「未找到可用的浏览器」** — 服务器没装 Edge/Chrome。装一个，或设 `BROWSER_PATH` 指向已有的 Chromium 可执行文件。服务启动日志会打出实际使用的渲染内核。

**导出的 PDF 中文是方框 / 字体不对** — Linux 容器/服务器缺中文字体。Docker 里装 `fonts-noto-cjk`；裸机安装 `fonts-noto-cjk` 或 Windows 字体包，重启服务。

**容器里导出报「Target closed」或渲染内核起不来** — 两个容器专属原因：`/dev/shm` 太小（compose 已配 `shm_size: 256m`，应用也默认带 `--disable-dev-shm-usage`）和 Chromium 沙箱无法在容器内启动（compose 默认带 `BROWSER_EXTRA_ARGS: --no-sandbox`）。手动 `docker run` 时别漏了这两个参数。

**登录/导出被 403（请求来源不被允许）** — 把访问域名写入 `ALLOWED_ORIGINS`。

**额度用完但明明是新的一天** — 按自然日、以服务进程所在时区 0 点重置；同内容重复导出命中缓存不扣额度。删除 `server/.data/app.db` 会连同账号一起清掉，别用它来「清额度」。

**口令被锁定** — 登录连续失败 10 次锁 15 分钟（按 IP+用户名）；脚本口令连续错误锁 15 分钟，等待即可。

**想迁移到另一台机器** — 停服后拷贝整个 `server/.data/` 目录即可，账号、简历、配额都在这一个 SQLite 文件里。
