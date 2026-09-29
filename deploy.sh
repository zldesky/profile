#!/usr/bin/env bash
#
# 简历工坊裸机一键部署（Debian/Ubuntu）。
#
# 用法：
#   git clone <仓库地址> /opt/resume && cd /opt/resume && bash deploy.sh
#   重复执行即更新部署：自动 git pull → 重装依赖 → 重新构建 → 重启服务。
#
# 脚本做的事：
#   1. 检查/创建 swap（2G 以下内存机器跑 Chromium 的保命项）；
#   2. 安装 Node 22、Chromium、中文字体（已装则跳过）；
#   3. npm ci（前端与 server 各自的依赖）并构建 dist；
#   4. 生成 .env（已存在则不动，公网域名的 ALLOWED_ORIGINS / TRUST_PROXY 需手动加）；
#   5. 注册 systemd 服务并启动，最后做健康检查。
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

log()  { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

IS_ROOT=0
[ "$(id -u)" -eq 0 ] && IS_ROOT=1
SUDO=""
if [ "$IS_ROOT" -eq 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "需要 sudo 权限安装系统依赖，或直接用 root 执行"
  SUDO="sudo"
fi
# systemd 服务以哪个用户运行：root 执行脚本时优先取原来的登录用户
RUN_USER="${SUDO_USER:-$(id -un)}"

command -v apt-get >/dev/null 2>&1 || die "本脚本只支持 Debian/Ubuntu（依赖 apt）；其他发行版请按 DEPLOY.md 手动部署"

# ---------------- 1. swap（2G 内存机器跑 Chromium 的保命项） ----------------

# set -e 下命令替换失败会中止脚本；free 在极简环境可能缺失，兜底为 0
MEM_MB=$(free -m | awk '/^Mem:/{print $2}' || true)
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}' || true)
MEM_MB=${MEM_MB:-0}
SWAP_MB=${SWAP_MB:-0}

if [ "$SWAP_MB" -lt 2000 ] && [ "$MEM_MB" -le 2500 ]; then
  warn "内存 ${MEM_MB}MB、swap ${SWAP_MB}MB：Chromium 渲染峰值可能触发 OOM"
  if [ -t 0 ]; then
    read -r -p "现在创建 2G swap？（推荐 y，需要 sudo）[y/N] " answer || answer=""
  else
    answer=""
    warn "非交互环境跳过创建；强烈建议手动执行：见 DEPLOY.md「小内存机器」"
  fi
  if [ "${answer:-n}" = "y" ] || [ "${answer:-n}" = "Y" ]; then
    $SUDO fallocate -l 2G /swapfile 2>/dev/null || \
      $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    $SUDO chmod 600 /swapfile
    $SUDO mkswap /swapfile >/dev/null
    $SUDO swapon /swapfile
    grep -qs '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
    log "swap 已启用（重启后仍生效）"
  fi
fi

# ---------------- 2. 系统依赖：Node 22 / Chromium / 中文字体 ----------------

NEED_APT=0

# Node 版本换算成可比较的整数（22.18 -> 22018），需 22.18+ 或 24.12+
NODE_VER=0
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -p 'process.versions.node.split(".").slice(0,2).map(Number).reduce((a,b)=>a*1000+b,0)')
fi
NODE_OK=0
if [ "$NODE_VER" -ge 22018 ] && [ "$NODE_VER" -lt 23000 ]; then NODE_OK=1; fi
if [ "$NODE_VER" -ge 24012 ]; then NODE_OK=1; fi

if [ "$NODE_OK" -eq 0 ]; then
  NEED_APT=1
  log "安装 Node.js 22（当前 ${NODE_VER} 不满足 22.18+ / 24.12+）"
  $SUDO apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | ${SUDO:+$SUDO -E} bash - >/dev/null
fi

# Chromium：Debian 的 chromium 是真包；Ubuntu 22+ 的 chromium-browser 走 snap，
# 安装会慢一些但同样可用（playwright 会通过 BROWSER_PATH 调起）
BROWSER_BIN=""
for candidate in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable /snap/bin/chromium; do
  [ -x "$candidate" ] && BROWSER_BIN="$candidate" && break
done
if [ -z "$BROWSER_BIN" ]; then
  NEED_APT=1
  log "安装 Chromium"
  $SUDO apt-get install -y chromium 2>/dev/null || $SUDO apt-get install -y chromium-browser
fi

# 中文字体：缺了它导出的 PDF 中文全是方框
if ! dpkg -s fonts-noto-cjk >/dev/null 2>&1; then
  NEED_APT=1
  log "安装 Noto CJK 中文字体"
fi

if [ "$NEED_APT" -eq 1 ]; then
  $SUDO apt-get update
  $SUDO apt-get install -y nodejs chromium chromium-browser fonts-noto-cjk 2>/dev/null || \
    $SUDO apt-get install -y nodejs chromium fonts-noto-cjk 2>/dev/null || \
    $SUDO apt-get install -y nodejs fonts-noto-cjk
fi

# 重新探测浏览器路径（上面刚装完的情形）
if [ -z "$BROWSER_BIN" ]; then
  for candidate in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable /snap/bin/chromium; do
    [ -x "$candidate" ] && BROWSER_BIN="$candidate" && break
  done
fi
[ -n "$BROWSER_BIN" ] || die "未找到 Chromium/Chrome 可执行文件，请手动安装后重跑"
log "渲染内核：$BROWSER_BIN"

# ---------------- 3. 更新代码 → 依赖 → 构建 ----------------

if [ -d .git ] && [ -n "${1:-}" ] && [ "$1" != "--no-pull" ]; then
  log "拉取最新代码（git pull --ff-only）"
  git pull --ff-only || warn "git pull 失败（本地有改动？），继续用当前代码部署"
fi

log "安装前端依赖（npm ci）"
npm ci --silent

log "安装应用服务依赖（server）"
npm ci --prefix server --silent

log "构建前端（npm run build）"
npm run build --silent

# ---------------- 4. .env（已存在则不动） ----------------

if [ ! -f .env ]; then
  log "生成 .env"
  {
    echo "# 由 deploy.sh 生成；公网域名部署时补两行："
    echo "#   ALLOWED_ORIGINS=https://你的域名"
    echo "#   TRUST_PROXY=1"
    echo "HOST=127.0.0.1"
    echo "PORT=3001"
    echo "BROWSER_PATH=$BROWSER_BIN"
  } > .env
  if [ "$IS_ROOT" -eq 1 ]; then
    warn "当前以 root 运行：Chromium 沙箱在 root 下不可用，.env 已追加 --no-sandbox（建议改用普通用户重跑）"
    echo "BROWSER_EXTRA_ARGS=--no-sandbox" >> .env
  fi
fi

# root 执行过脚本时，把文件所有权还给登录用户，避免 systemd 用户进程写不了 .data
if [ "$IS_ROOT" -eq 1 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  $SUDO chown -R "$SUDO_USER":"$SUDO_USER" "$APP_DIR"
fi

# ---------------- 5. 常驻：systemd 服务 ----------------

PORT=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]')
PORT=${PORT:-3001}
NODE_BIN=$(command -v node)

if [ -d /run/systemd/system ]; then
  log "注册并启动 systemd 服务（resume）"
  $SUDO tee /etc/systemd/system/resume.service >/dev/null <<EOF
[Unit]
Description=Resume Studio (简历工坊)
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --env-file-if-exists=.env server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable resume >/dev/null 2>&1
  $SUDO systemctl restart resume

  log "等待服务就绪…"
  READY=0
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then READY=1; break; fi
    sleep 1
  done

  if [ "$READY" -eq 1 ]; then
    log "部署完成 ✔  访问地址：http://127.0.0.1:$PORT"
    log "本机监听 127.0.0.1，公网访问请按 DEPLOY.md 配 Caddy/Nginx 反代 + ALLOWED_ORIGINS + TRUST_PROXY"
    log "常用命令：systemctl status resume ｜ journalctl -u resume -f ｜ 重跑本脚本即更新部署"
  else
    warn "健康检查未通过，查看日志定位：journalctl -u resume -n 50"
    exit 1
  fi
else
  warn "未检测到 systemd，服务无法常驻；手动启动：npm run pdf（建议放进 tmux/screen）"
  log "构建已完成，随时可启动"
fi
