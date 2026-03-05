#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$ROOT_DIR/packages/server"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/server.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_KEY="${DEPLOY_KEY:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"

REMOTE_DIR="${REMOTE_DIR:-/apps/jf}"
APP_NAME="${APP_NAME:-jf-server}"
APP_PORT="${APP_PORT:-9090}"
REMOTE_NPM_LOGLEVEL="${REMOTE_NPM_LOGLEVEL:-notice}"
REMOTE_TRACE="${REMOTE_TRACE:-0}"

# 1: 上传本地 packages/server/.env 到远端 shared/.env；0: 仅使用远端已有 shared/.env
COPY_ENV="${COPY_ENV:-1}"

if [[ -z "$DEPLOY_HOST" ]]; then
  cat <<'USAGE'
用法:
  DEPLOY_HOST=1.2.3.4 DEPLOY_USER=ubuntu ./scripts/deploy-server.sh

可选环境变量:
  CONFIG_FILE=./scripts/server.env
  DEPLOY_SSH_PORT=22
  DEPLOY_KEY=~/.ssh/id_rsa
  DEPLOY_PASSWORD=你的SSH密码
  REMOTE_DIR=/apps/jf
  APP_NAME=jf-server
  APP_PORT=9090
  COPY_ENV=1
USAGE
  exit 1
fi

for cmd in pnpm rsync ssh; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少命令: $cmd"
    exit 1
  fi
done

if [[ -n "$DEPLOY_PASSWORD" ]] && ! command -v sshpass >/dev/null 2>&1; then
  echo "检测到 DEPLOY_PASSWORD，但本机缺少 sshpass，请先安装（brew install hudochenkov/sshpass/sshpass）"
  exit 1
fi

if [[ ! -d "$SERVER_DIR" ]]; then
  echo "目录不存在: $SERVER_DIR"
  exit 1
fi

if [[ ! -f "$SERVER_DIR/ecosystem.config.cjs" ]]; then
  echo "缺少文件: $SERVER_DIR/ecosystem.config.cjs"
  exit 1
fi

SSH_OPTS=(-p "$DEPLOY_SSH_PORT" -o StrictHostKeyChecking=accept-new)
SSH_OPTS+=(-o ServerAliveInterval=20 -o ServerAliveCountMax=6)
if [[ -n "$DEPLOY_KEY" ]]; then
  SSH_OPTS+=(-i "$DEPLOY_KEY")
fi

SSH_WRAPPER=(ssh)
if [[ -n "$DEPLOY_PASSWORD" ]]; then
  export SSHPASS="$DEPLOY_PASSWORD"
  SSH_WRAPPER=(sshpass -e ssh)
fi

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
REMOTE_RELEASE_DIR="${REMOTE_DIR}/releases/${TIMESTAMP}"

echo "==> 本地构建 server"
pnpm --filter server build

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
STAGE_DIR="${TMP_DIR}/server"
mkdir -p "$STAGE_DIR"

echo "==> 准备发布包"
rsync -a --delete "$SERVER_DIR/dist/" "$STAGE_DIR/dist/"
cp "$SERVER_DIR/package.json" "$STAGE_DIR/package.json"
cp "$SERVER_DIR/ecosystem.config.cjs" "$STAGE_DIR/ecosystem.config.cjs"

if [[ "$COPY_ENV" == "1" ]]; then
  if [[ ! -f "$SERVER_DIR/.env" ]]; then
    echo "COPY_ENV=1 但本地不存在 $SERVER_DIR/.env"
    exit 1
  fi
  cp "$SERVER_DIR/.env" "$STAGE_DIR/.env"
fi

SSH_CMD=("${SSH_WRAPPER[@]}" "${SSH_OPTS[@]}" "$SSH_TARGET")
RSYNC_RSH="${SSH_WRAPPER[*]} ${SSH_OPTS[*]}"

echo "==> 创建远端目录"
"${SSH_CMD[@]}" "mkdir -p '${REMOTE_DIR}/releases' '${REMOTE_DIR}/shared' '${REMOTE_DIR}/logs'"

if [[ "$COPY_ENV" == "1" ]]; then
  echo "==> 上传 .env 到远端 shared"
  rsync -a -e "$RSYNC_RSH" "$STAGE_DIR/.env" "$SSH_TARGET:${REMOTE_DIR}/shared/.env"
fi

echo "==> 上传发布包到 ${REMOTE_RELEASE_DIR}"
rsync -a --delete -e "$RSYNC_RSH" "$STAGE_DIR/" "$SSH_TARGET:${REMOTE_RELEASE_DIR}/"

echo "==> 远端安装依赖并启动 PM2"
"${SSH_CMD[@]}" \
  "REMOTE_DIR='${REMOTE_DIR}' REMOTE_RELEASE_DIR='${REMOTE_RELEASE_DIR}' APP_NAME='${APP_NAME}' APP_PORT='${APP_PORT}' REMOTE_NPM_LOGLEVEL='${REMOTE_NPM_LOGLEVEL}' REMOTE_TRACE='${REMOTE_TRACE}' bash -s" <<'EOF'
set -euo pipefail

if [[ "${REMOTE_TRACE}" == "1" ]]; then
  set -x
fi

echo "[remote] 校验环境文件"
if [[ ! -f "${REMOTE_DIR}/shared/.env" ]]; then
  echo "缺少 ${REMOTE_DIR}/shared/.env，请先创建环境变量文件"
  exit 1
fi

echo "[remote] 进入发布目录: ${REMOTE_RELEASE_DIR}"
cd "${REMOTE_RELEASE_DIR}"
ln -sfn "${REMOTE_DIR}/shared/.env" .env

echo "[remote] 安装生产依赖 (npm install)"
npm install --omit=dev --no-audit --no-fund --loglevel="${REMOTE_NPM_LOGLEVEL}"

echo "[remote] 切换 current 软链"
ln -sfn "${REMOTE_RELEASE_DIR}" "${REMOTE_DIR}/current"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[remote] 安装 pm2"
  npm install -g pm2
fi

echo "[remote] 启动/重载 PM2 应用: ${APP_NAME}"
cd "${REMOTE_DIR}/current"
APP_NAME="${APP_NAME}" APP_PORT="${APP_PORT}" pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 status "${APP_NAME}"
EOF

echo "==> 部署完成"
echo "服务目录: ${REMOTE_DIR}/current"
echo "端口: ${APP_PORT}"
echo "健康检查: http://${DEPLOY_HOST}:${APP_PORT}/api-docs"
