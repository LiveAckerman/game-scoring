#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/server.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_KEY="${DEPLOY_KEY:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"

REMOTE_DIR="${REMOTE_DIR:-/apps/jf}"
NODE_MAJOR="${NODE_MAJOR:-20}"

if [[ -z "$DEPLOY_HOST" ]]; then
  cat <<'USAGE'
用法:
  DEPLOY_HOST=1.2.3.4 DEPLOY_USER=ubuntu ./scripts/init-ubuntu-server.sh

可选环境变量:
  CONFIG_FILE=./scripts/server.env
  DEPLOY_SSH_PORT=22
  DEPLOY_KEY=~/.ssh/id_rsa
  DEPLOY_PASSWORD=你的SSH密码
  REMOTE_DIR=/apps/jf
  NODE_MAJOR=20
USAGE
  exit 1
fi

if [[ -n "$DEPLOY_PASSWORD" ]] && ! command -v sshpass >/dev/null 2>&1; then
  echo "检测到 DEPLOY_PASSWORD，但本机缺少 sshpass，请先安装（brew install hudochenkov/sshpass/sshpass）"
  exit 1
fi

SSH_OPTS=(-p "$DEPLOY_SSH_PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "$DEPLOY_KEY" ]]; then
  SSH_OPTS+=(-i "$DEPLOY_KEY")
fi

SSH_WRAPPER=(ssh)
if [[ -n "$DEPLOY_PASSWORD" ]]; then
  export SSHPASS="$DEPLOY_PASSWORD"
  SSH_WRAPPER=(sshpass -e ssh)
fi

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_CMD=("${SSH_WRAPPER[@]}" "${SSH_OPTS[@]}" "$SSH_TARGET")

echo "==> 初始化 Ubuntu 服务器 ${SSH_TARGET}"
"${SSH_CMD[@]}" "REMOTE_DIR='${REMOTE_DIR}' NODE_MAJOR='${NODE_MAJOR}' bash -s" <<'EOF'
set -euo pipefail

run_root() {
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

echo "==> 安装系统依赖"
run_root apt-get update
run_root apt-get install -y curl ca-certificates gnupg rsync git build-essential

if ! command -v node >/dev/null 2>&1; then
  echo "==> 安装 Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | run_root bash -
  run_root apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> 安装 pnpm"
  run_root npm install -g pnpm
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> 安装 pm2"
  run_root npm install -g pm2
fi

echo "==> 创建部署目录 ${REMOTE_DIR}"
run_root mkdir -p "${REMOTE_DIR}/releases" "${REMOTE_DIR}/shared" "${REMOTE_DIR}/logs"
if [[ "$(id -u)" -ne 0 ]]; then
  run_root chown -R "$(id -un)":"$(id -gn)" "${REMOTE_DIR}"
fi

echo "==> 配置 pm2 开机自启"
if command -v systemctl >/dev/null 2>&1; then
  run_root env "PATH=$PATH" pm2 startup systemd -u "$(id -un)" --hp "$HOME" || true
fi
pm2 save || true

echo "==> 初始化完成"
echo "node: $(node -v)"
echo "npm:  $(npm -v)"
echo "pnpm: $(pnpm -v)"
echo "pm2:  $(pm2 -v)"
EOF
