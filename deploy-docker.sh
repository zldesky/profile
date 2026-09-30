#!/usr/bin/env bash
#
# 简历工坊 · CentOS / RHEL 一键部署到 Docker（nginx 容器对外，应用容器只在 compose 内网）
#
# 用法（clone 到任意目录都能跑：脚本以自身所在目录为工作目录）：
#   git clone <仓库地址> /opt/resume && cd /opt/resume && bash deploy-docker.sh
#   重复执行即更新部署：git pull → 重建镜像 → 重启容器。
#
# 脚本做的事：
#   1. 检查/创建 swap（2.5G 以下内存机器跑 Chromium 的保命项）；
#   2. 装 Docker CE + compose 插件（已装则跳过），顺手摘掉 podman-docker 的假 docker；
#   3. 写 /etc/docker/daemon.json（日志轮转，可选镜像加速）并启动 docker；
#   4. 探测公网 IP 或取你传的域名，算好 ALLOWED_ORIGINS（不设则登录与导出全 403）；
#   5. docker compose up -d --build 起 nginx + resume，等健康检查通过；
#   6. 从宿主机端口打一次 /api/health，端到端验证 nginx → 应用这条链路。
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# ---------------- 默认参数（命令行可覆盖） ----------------

PORT=80                 # nginx 对外端口
DOMAINS=""              # 访问域名，逗号分隔（用于算 ALLOWED_ORIGINS）
ORIGIN_OVERRIDE=""      # 直接指定 ALLOWED_ORIGINS，优先级最高
DOCKER_MIRROR="official" # docker-ce 安装源：official | aliyun | tuna
REGISTRY_MIRROR=""      # Docker Hub 加速地址，逗号分隔
NPM_MIRROR=""           # 构建期 npm 源，空 = 用官方源
DO_PULL=1               # 是否 git pull
DO_BUILD=1              # 是否重建镜像
SWAP_MODE="auto"        # auto | yes | no
SKIP_DOCKER_INSTALL=0
FIX_EOL_REPOS=0
WROTE_DAEMON_JSON=0

log()  { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法：bash deploy-docker.sh [选项]

  --port N               nginx 对外端口，默认 80
  --domain a.com,b.com   访问域名（不要带 http://），用于放行 ALLOWED_ORIGINS
  --origin URL[,URL]     直接指定 ALLOWED_ORIGINS，优先级高于 --domain
  --npm-mirror [URL]     构建期 npm 加速，不带 URL 时用 https://registry.npmmirror.com
  --registry-mirror URL  Docker Hub 加速（拉基础镜像慢时用，逗号分隔可给多个）
  --docker-mirror M      docker-ce 安装源：official | aliyun | tuna，默认 official
  --with-swap            内存不足时直接创建 swap，不再询问
  --without-swap         完全不碰 swap
  --fix-eol-repos        CentOS 7 已 EOL 时把 yum 源切到 vault.centos.org（自动备份原文件）
  --skip-docker-install  跳过 Docker 安装（已装好，或不是 RHEL 系）
  --no-build             只重启容器，不重新构建镜像
  --no-pull              不执行 git pull
  -h, --help             显示本帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port)   [ $# -ge 2 ] || die "--port 需要参数"; PORT="$2"; shift 2 ;;
    --domain) [ $# -ge 2 ] || die "--domain 需要参数"; DOMAINS="$2"; shift 2 ;;
    --origin) [ $# -ge 2 ] || die "--origin 需要参数"; ORIGIN_OVERRIDE="$2"; shift 2 ;;
    --npm-mirror)
      if [ $# -ge 2 ] && [ "${2#--}" = "$2" ]; then NPM_MIRROR="$2"; shift 2
      else NPM_MIRROR="https://registry.npmmirror.com"; shift; fi ;;
    --registry-mirror) [ $# -ge 2 ] || die "--registry-mirror 需要参数"; REGISTRY_MIRROR="$2"; shift 2 ;;
    --docker-mirror)   [ $# -ge 2 ] || die "--docker-mirror 需要参数"; DOCKER_MIRROR="$2"; shift 2 ;;
    --with-swap)   SWAP_MODE="yes"; shift ;;
    --without-swap) SWAP_MODE="no"; shift ;;
    --fix-eol-repos) FIX_EOL_REPOS=1; shift ;;
    --skip-docker-install) SKIP_DOCKER_INSTALL=1; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    --no-pull)  DO_PULL=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（-h 查看用法）" ;;
  esac
done

case "$PORT" in
  ''|*[!0-9]*) die "--port 必须是数字，收到：$PORT" ;;
esac

# ---------------- 0. 前置检查 ----------------

[ -f docker-compose.yml ] || die "当前目录没有 docker-compose.yml，请在本仓库根目录执行（或用 bash $APP_DIR/deploy-docker.sh）"
[ -f nginx/default.conf ] || die "缺少 nginx/default.conf，仓库内容不完整"
command -v curl >/dev/null 2>&1 || die "缺少 curl，无法下载安装源；先装 curl 再重跑"

IS_ROOT=0
[ "$(id -u)" -eq 0 ] && IS_ROOT=1
SUDO=""
if [ "$IS_ROOT" -eq 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "需要 root 或 sudo 权限执行本脚本"
  SUDO="sudo"
fi
# systemd 服务/文件归属用哪个用户：root 执行时优先取原来的登录用户
RUN_USER="${SUDO_USER:-$(id -un)}"

cd "$APP_DIR"
log "项目目录：$APP_DIR"

# 已经是 docker 组成员就不必裹 sudo（避免无谓的密码提示）
DOCKER_SUDO="$SUDO"
if [ -n "$DOCKER_SUDO" ] && id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  DOCKER_SUDO=""
fi
dk() { if [ -n "$DOCKER_SUDO" ]; then $DOCKER_SUDO docker "$@"; else docker "$@"; fi; }

# ---------------- 1. 系统识别 ----------------

DISTRO_ID=""
DISTRO_VER=""
DISTRO_NAME="未知"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-}"
  DISTRO_VER="${VERSION_ID:-}"
  DISTRO_NAME="${PRETTY_NAME:-$DISTRO_ID $DISTRO_VER}"
fi
log "系统：$DISTRO_NAME"

PKG=""
if command -v dnf >/dev/null 2>&1; then PKG="dnf"
elif command -v yum >/dev/null 2>&1; then PKG="yum"
fi

IS_EL7=0
case "${DISTRO_ID}-${DISTRO_VER}" in
  centos-7*|rhel-7*|ol-7*) IS_EL7=1 ;;
esac

# ---------------- 2. swap（小内存机器跑 Chromium 的保命项） ----------------

MEM_MB=$(free -m | awk '/^Mem:/{print $2}' || true)
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}' || true)
MEM_MB=${MEM_MB:-0}
SWAP_MB=${SWAP_MB:-0}

if [ "$SWAP_MODE" != "no" ] && [ "$SWAP_MB" -lt 2000 ] && [ "$MEM_MB" -le 2500 ]; then
  warn "内存 ${MEM_MB}MB、swap ${SWAP_MB}MB：镜像构建与 Chromium 渲染的峰值可能触发 OOM"
  ANSWER="n"
  if [ "$SWAP_MODE" = "yes" ]; then
    ANSWER="y"
  elif [ -t 0 ]; then
    read -r -p "现在创建 2G swap？（推荐 y，需要 sudo）[y/N] " ANSWER || ANSWER="n"
  else
    warn "非交互环境未创建；强烈建议按 DEPLOY.md「小内存机器」手动加，或加 --with-swap 重跑"
  fi

  if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
    if swapon --show 2>/dev/null | grep -q '/swapfile'; then
      log "swap 已在用，跳过创建"
    else
      $SUDO fallocate -l 2G /swapfile 2>/dev/null || \
        $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
      $SUDO chmod 600 /swapfile
      $SUDO mkswap /swapfile >/dev/null
      $SUDO swapon /swapfile
      grep -qs '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
      log "swap 已启用（重启后仍生效）。撤销：swapoff /swapfile && rm /swapfile，并删掉 /etc/fstab 里那行"
    fi
  fi
fi

# ---------------- 3. Docker CE + compose 插件 ----------------

install_docker() {
  [ -n "$PKG" ] || die "未找到 yum/dnf：本步骤面向 CentOS/RHEL。
其他发行版请按 DEPLOY.md 手动装好 Docker 后，加 --skip-docker-install 重跑"

  if [ "$FIX_EOL_REPOS" -eq 1 ] && [ "$IS_EL7" -eq 1 ]; then
    log "把 CentOS 7 的 yum 源切到 vault.centos.org（原文件备份为 *.repo.bak）"
    $SUDO sed -i.bak -e 's|^mirrorlist=|#mirrorlist=|' \
      -e 's|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|' \
      /etc/yum.repos.d/CentOS-*.repo
  fi

  # CentOS 8+ 自带 podman-docker，它提供的 /usr/bin/docker 是个转发壳，
  # 不摘掉后面 docker compose 必然报奇怪的错；另有自带 docker 1.13 的 docker 包也会抢占命令
  if ! rpm -q docker-ce >/dev/null 2>&1; then
    for p in podman-docker docker docker-client docker-common docker-latest; do
      if rpm -q "$p" >/dev/null 2>&1; then
        warn "移除与 docker-ce 冲突的软件包：$p"
        $SUDO $PKG remove -y "$p" >/dev/null 2>&1 || true
      fi
    done
  fi

  REPO_URL="https://download.docker.com/linux/centos/docker-ce.repo"
  case "$DOCKER_MIRROR" in
    official|"") : ;;
    aliyun) REPO_URL="https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo" ;;
    tuna)   REPO_URL="https://mirrors.tuna.tsinghua.edu.cn/docker-ce/linux/centos/docker-ce.repo" ;;
    *) die "--docker-mirror 只支持 official / aliyun / tuna，收到：$DOCKER_MIRROR" ;;
  esac

  log "写入 docker-ce 安装源：$REPO_URL"
  $SUDO curl -fsSL "$REPO_URL" -o /etc/yum.repos.d/docker-ce.repo \
    || die "下载 docker-ce.repo 失败（网络不通？可加 --docker-mirror aliyun 换源）"

  log "安装 Docker CE 与 compose 插件（首次约几分钟）"
  EXTRA_ARGS=""
  # el7 的 yum 不认 --allowerasing，只有 dnf 才有
  [ "$PKG" = "dnf" ] && EXTRA_ARGS="--allowerasing"
  if ! $SUDO $PKG install -y $EXTRA_ARGS \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
    warn "docker-ce 安装失败，可能原因与对策："
    warn "  · 基础源不可达（CentOS 7 已 EOL，mirror.centos.org 已下线）→ 加 --fix-eol-repos 重跑"
    warn "  · docker-ce 源慢或不通 → 加 --docker-mirror aliyun 重跑"
    [ "$IS_EL7" -eq 1 ] && warn "  · Docker 对 CentOS 7 的支持已停止，可能已无可用包 → 换 CentOS Stream 9 / Rocky / AlmaLinux"
    die "请按上面提示处理后重跑"
  fi
}

if [ "$SKIP_DOCKER_INSTALL" -eq 1 ]; then
  warn "按 --skip-docker-install 跳过 Docker 安装"
elif rpm -q docker-ce >/dev/null 2>&1; then
  log "已装 docker-ce（$(dk --version 2>/dev/null || rpm -q --qf '%{VERSION}' docker-ce)），跳过安装"
else
  install_docker
fi

dk compose version >/dev/null 2>&1 \
  || die "docker compose（v2 插件）不可用。本项目的 compose 文件不支持已停止维护的 docker-compose v1"

# ---------------- 4. daemon.json 与 docker 服务 ----------------

if [ ! -f /etc/docker/daemon.json ]; then
  log "写 /etc/docker/daemon.json：日志轮转（防止容器 json 日志撑爆 /var/lib/docker）"
  {
    printf '{\n'
    printf '  "log-driver": "json-file",\n'
    printf '  "log-opts": { "max-size": "10m", "max-file": "3" }'
    if [ -n "$REGISTRY_MIRROR" ]; then
      printf ',\n  "registry-mirrors": ['
      FIRST=1
      OLD_IFS="$IFS"
      IFS=','
      for m in $REGISTRY_MIRROR; do
        [ -n "$m" ] || continue
        [ "$FIRST" -eq 1 ] || printf ', '
        printf '"%s"' "$m"
        FIRST=0
      done
      IFS="$OLD_IFS"
      printf ']'
    fi
    printf '\n}\n'
  } | $SUDO tee /etc/docker/daemon.json >/dev/null
  WROTE_DAEMON_JSON=1
else
  warn "/etc/docker/daemon.json 已存在，不动它。若里面没有 log-opts，容器日志会无限增长，建议补上："
  warn '  { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }'
fi

if [ -d /run/systemd/system ]; then
  $SUDO systemctl enable docker >/dev/null 2>&1 || true
  if [ "$WROTE_DAEMON_JSON" -eq 1 ] && systemctl is-active --quiet docker; then
    log "重启 docker 使 daemon.json 生效（已有容器会随之重启）"
    $SUDO systemctl restart docker
  else
    $SUDO systemctl start docker
  fi
  systemctl is-active --quiet docker \
    || die "docker 服务未启动，排查：systemctl status docker ｜ journalctl -u docker -n 50"
else
  warn "未检测到 systemd：请自行启动 dockerd，否则后面的 compose 步骤会失败"
fi

if [ -n "$SUDO" ] && [ "$RUN_USER" != "root" ] \
   && ! id -nG "$RUN_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  $SUDO usermod -aG docker "$RUN_USER" >/dev/null 2>&1 || true
  warn "已把 $RUN_USER 加入 docker 组（重新登录后可直接用 docker；本次部署仍走 sudo）"
fi

log "Docker：$(dk --version 2>/dev/null || echo '版本未知')"
log "Compose：$(dk compose version 2>/dev/null || echo '版本未知')"

# ---------------- 5. 对外端口与 allowed origins ----------------

# 真实客户端 IP：优先问外部服务，拿不到就退到默认路由的源地址（内网 IP）
detect_public_ip() {
  local ip="" url=""
  for url in https://api.ipify.org https://ifconfig.me/ip https://ipinfo.io/ip; do
    ip="$(curl -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    case "$ip" in
      '') continue ;;
      *[!0-9.:a-fA-F]*) continue ;;
    esac
    printf '%s' "$ip"
    return 0
  done
  ip="$(ip route get 1.1.1.1 2>/dev/null \
        | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)"
  printf '%s' "${ip:-}"
}

# 浏览器 Origin 必须与实际访问地址逐字一致：默认端口不带 :80，非默认端口要带
build_origins() {
  local out="" item="" host=""
  if [ -n "$ORIGIN_OVERRIDE" ]; then
    printf '%s' "$ORIGIN_OVERRIDE"
    return 0
  fi
  if [ -n "$DOMAINS" ]; then
    local OLD_IFS="$IFS"
    IFS=','
    for item in $DOMAINS; do
      IFS="$OLD_IFS"
      [ -n "$item" ] || continue
      item="${item#http://}"
      item="${item#https://}"
      item="${item%/}"
      [ -n "$item" ] || continue
      host="http://$item"
      [ "$PORT" != "80" ] && host="http://$item:$PORT"
      out="${out:+$out,}$host"
    done
    IFS="$OLD_IFS"
  else
    local ip=""
    ip="$(detect_public_ip)"
    if [ -n "$ip" ]; then
      host="http://$ip"
      [ "$PORT" != "80" ] && host="http://$ip:$PORT"
      out="$host"
    fi
  fi
  printf '%s' "$out"
}

ALLOWED_ORIGINS_VALUE="$(build_origins)"

# 目录名带中文或大写时，compose 会拿它当项目名并直接报错；
# 固定项目名还能让数据卷名稳定（换目录重建也不会丢数据卷）。
# 手动执行 compose 命令时要带上 -p resume，否则它按目录名算项目名，找不到这些容器。
COMPOSE_PROJECT_NAME_VALUE="resume"

# 这些变量是给 compose 做 ${VAR} 替换用的，替换发生在客户端（docker compose 进程内）。
# 所以不能只 export：sudo 默认会重置环境，变量传不进去，ALLOWED_ORIGINS 会变成空串，
# 结果就是「部署成功但登录、导出全部 403」。统一用 env 显式传给 docker 进程。
COMPOSE_ENV=(
  "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME_VALUE"
  "NGINX_HTTP_PORT=$PORT"
  "ALLOWED_ORIGINS=$ALLOWED_ORIGINS_VALUE"
)
if [ -n "$NPM_MIRROR" ]; then
  COMPOSE_ENV+=("NPM_REGISTRY=$NPM_MIRROR")
  log "构建期 npm 源：$NPM_MIRROR"
fi

# 统一入口：环境变量齐全地执行 docker compose
dkc() {
  if [ -n "$DOCKER_SUDO" ]; then
    $DOCKER_SUDO env "${COMPOSE_ENV[@]}" docker compose "$@"
  else
    env "${COMPOSE_ENV[@]}" docker compose "$@"
  fi
}

if [ -n "$ALLOWED_ORIGINS_VALUE" ]; then
  log "放行来源（ALLOWED_ORIGINS）：$ALLOWED_ORIGINS_VALUE"
else
  warn "没算出放行来源（无公网 IP 且未传 --domain/--origin）："
  warn "  部署能起来，但用公网地址登录与导出会 403。补一次：bash deploy-docker.sh --domain 你的域名"
fi

# 宿主机端口占用检查：nginx 容器起不来时给个人话，而不是让 compose 抛一堆端口冲突
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${PORT}$"; then
  warn "宿主机 $PORT 端口已被占用，nginx 容器会启动失败；可加 --port 8080 换端口"
fi

# ---------------- 6. 拉代码 → 构建 → 起容器 ----------------

if [ "$DO_PULL" -eq 1 ] && [ -d .git ]; then
  log "拉取最新代码（git pull --ff-only）"
  git pull --ff-only || warn "git pull 失败（本地有改动？仓库属主不是当前用户？），继续用当前代码部署"
fi

log "构建并启动容器（nginx + resume，首次构建要装两轮 npm 依赖，慢是正常的）"
if [ "$DO_BUILD" -eq 1 ]; then
  dkc up -d --build
else
  dkc up -d
fi

wait_healthy() {
  local name="$1" tries="$2" i=1
  while [ "$i" -le "$tries" ]; do
    if [ "$(dk inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null || true)" = "healthy" ]; then
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  return 1
}

log "等待应用容器健康检查通过（首次启动要拉起 Chromium，请稍候）"
if ! wait_healthy resume-studio 90; then
  warn "resume 容器未进入 healthy，最近日志："
  dk logs --tail 50 resume-studio || true
  die "启动失败，请按上面日志定位"
fi

log "等待 nginx 容器就绪"
if ! wait_healthy resume-nginx 30; then
  warn "resume-nginx 未进入 healthy，最近日志："
  dk logs --tail 50 resume-nginx || true
  die "nginx 启动失败，多为配置语法问题，先用这条看具体行号：
  ${DOCKER_SUDO:+$DOCKER_SUDO }docker exec resume-nginx nginx -t"
fi

# ---------------- 7. 端到端验证与收尾 ----------------

# 从宿主机端口打一次：宿主机 → nginx → 应用容器，这条通了才算真的部署成功。
# 重试几轮是为了吸收 nginx 重新解析上游的最长 10s 有效期（刚重建过容器时可能短暂 502）。
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
SMOKE_OK=0
for _ in $(seq 1 10); do
  if curl -fsS --max-time 15 "$HEALTH_URL" >/dev/null 2>&1; then
    SMOKE_OK=1
    break
  fi
  sleep 2
done
if [ "$SMOKE_OK" -eq 1 ]; then
  log "端到端检查通过（宿主机 → nginx → 应用）：$HEALTH_URL"
else
  warn "从宿主机访问 $HEALTH_URL 未通过，但容器可能已在运行；排查："
  warn "  ${DOCKER_SUDO:+$DOCKER_SUDO }docker compose -p $COMPOSE_PROJECT_NAME_VALUE logs --tail 50 nginx resume"
fi

PUBLIC_IP="$(detect_public_ip)"
VISIT="http://${PUBLIC_IP:-服务器IP}"
[ "$PORT" != "80" ] && VISIT="http://${PUBLIC_IP:-服务器IP}:$PORT"

printf '\n'
log "部署完成 ✔"
log "访问地址：$VISIT"
log "数据卷：${COMPOSE_PROJECT_NAME_VALUE}_resume-data（SQLite：账号、简历、配额；删容器不丢数据）"
log "常用命令（在本目录执行，-p 不能省：项目名被固定成 resume，不按目录名算）："
log "  查看状态   ${DOCKER_SUDO:+$DOCKER_SUDO }docker compose -p $COMPOSE_PROJECT_NAME_VALUE ps"
log "  跟随日志   ${DOCKER_SUDO:+$DOCKER_SUDO }docker compose -p $COMPOSE_PROJECT_NAME_VALUE logs -f nginx resume"
log "  更新部署   重跑本脚本"
printf '\n'

if [ -n "$ALLOWED_ORIGINS_VALUE" ]; then
  log "已放行的浏览器来源：$ALLOWED_ORIGINS_VALUE"
else
  warn "登录/导出仍会 403：用 --domain 你的域名 或 --origin http://地址 重跑一次"
fi

warn "当前只有 HTTP：账号口令与会话 Cookie 都是明文，公网务必按 nginx/default.conf 末尾"
warn "  的四步启用 HTTPS，并用 --origin https://你的域名 重新部署（Origin 不一致仍会 403）"

if command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
  warn "检测到 firewalld 正在运行：Docker 发布的端口走 nat/FORWARD 链，默认绕过 firewalld 规则，"
  warn "  也就是说 $PORT 端口现在是对外开放的。要主动放行/查看，用："
  warn "    $SUDO firewall-cmd --add-port=${PORT}/tcp --permanent && $SUDO firewall-cmd --reload"
fi
