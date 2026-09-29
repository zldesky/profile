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
USER node

# 数据库（账号/简历/配额）落在 /app/server/.data，compose 里必须挂卷持久化
CMD ["node", "server/index.js"]
