# 简历工坊应用服务镜像。
# 构建：docker build -t resume-studio .
# 运行：docker compose up -d（推荐，见 docker-compose.yml）
FROM node:24-bookworm-slim

# Chromium 渲染内核 + Noto CJK 中文字体。
# 缺中文字体的后果是导出 PDF 里中文全部变成方框，所以字体和浏览器同样必需。
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV BROWSER_PATH=/usr/bin/chromium

WORKDIR /app

# 国内网络可选加速：部署脚本传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com 才生效。
# 不传（默认空）时与不带这个参数的行为完全一致。
# 写进 /root/.npmrc，下面的两次 npm ci 都会走它；npm 会把 lockfile 里指向默认源的
# resolved 地址替换成这里配置的源，所以 package-lock.json 无需改动。
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

# 先只拷依赖清单装依赖，代码变动不再触发整层重装
COPY package.json package-lock.json ./
RUN npm ci
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY . .
RUN npm run build

# 非 root 运行：配合 Chromium 的隔离机制，进程被打穿也拿不到 root 权限
ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001

# 数据库挂载点必须在镜像里预建并归 node 所有：.data 被 .dockerignore 排除，
# 镜像里没有这个目录，Docker 就会以 root 创建挂载点，node 用户在其中
# 建不了 SQLite 文件（errcode 14: unable to open database file）。
# 挂载空数据卷时 Docker 会把这个目录连同属主拷进卷，卷也随之变为 node 所有。
RUN mkdir -p /app/server/.data && chown node:node /app/server/.data

USER node

# 数据库（账号/简历/配额）落在 /app/server/.data，compose 里必须挂卷持久化
CMD ["node", "server/index.js"]
