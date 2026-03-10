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
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_KEY="${DEPLOY_KEY:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"

REMOTE_DIR="${REMOTE_DIR:-/apps/jf}"
APP_NAME="${APP_NAME:-jf-server}"
APP_PORT="${APP_PORT:-9090}"
REMOTE_TRACE="${REMOTE_TRACE:-0}"

TARGET_RELEASE="${1:-${ROLLBACK_RELEASE:-}}"
LIST_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --list)
      LIST_ONLY=1
      ;;
    --help|-h)
      cat <<'USAGE'
用法:
  ./scripts/rollback-server.sh
  ./scripts/rollback-server.sh 20260310153000
  ROLLBACK_RELEASE=20260310153000 ./scripts/rollback-server.sh
  ./scripts/rollback-server.sh --list

说明:
  1. 默认回滚到当前版本的上一个版本
  2. 可直接传入具体版本号
  3. 不传版本号时，会列出可回滚版本并支持输入序号或版本号选择
USAGE
      exit 0
      ;;
  esac
done

if [[ -z "$DEPLOY_HOST" ]]; then
  cat <<'USAGE'
缺少 DEPLOY_HOST，请先配置 scripts/server.env 或通过环境变量传入。

用法:
  DEPLOY_HOST=1.2.3.4 DEPLOY_USER=ubuntu ./scripts/rollback-server.sh
USAGE
  exit 1
fi

for cmd in ssh readlink; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少命令: $cmd"
    exit 1
  fi
done

if [[ -n "$DEPLOY_PASSWORD" ]] && ! command -v sshpass >/dev/null 2>&1; then
  echo "检测到 DEPLOY_PASSWORD，但本机缺少 sshpass，请先安装（brew install hudochenkov/sshpass/sshpass）"
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
SSH_CMD=("${SSH_WRAPPER[@]}" "${SSH_OPTS[@]}" "$SSH_TARGET")

REMOTE_INFO="$("${SSH_CMD[@]}" \
  "REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

CURRENT_RELEASE=""
if [[ -L "${REMOTE_DIR}/current" ]]; then
  CURRENT_TARGET="$(readlink -f "${REMOTE_DIR}/current")"
  CURRENT_RELEASE="$(basename "${CURRENT_TARGET}")"
fi

if [[ ! -d "${REMOTE_DIR}/releases" ]]; then
  exit 0
fi

printf 'CURRENT=%s\n' "${CURRENT_RELEASE}"
find "${REMOTE_DIR}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r
REMOTE_SCRIPT
)"

CURRENT_RELEASE="$(printf '%s\n' "$REMOTE_INFO" | awk -F= '/^CURRENT=/{print $2; exit}')"
RELEASES=()
while IFS= read -r release; do
  [[ -n "$release" ]] || continue
  RELEASES+=("$release")
done < <(printf '%s\n' "$REMOTE_INFO" | sed '1d' | sed '/^$/d')

if [[ "${#RELEASES[@]}" -eq 0 ]]; then
  echo "远端没有可回滚版本: ${REMOTE_DIR}/releases"
  exit 1
fi

DEFAULT_RELEASE=""
for idx in "${!RELEASES[@]}"; do
  if [[ "${RELEASES[$idx]}" == "$CURRENT_RELEASE" ]]; then
    next_idx=$((idx + 1))
    if (( next_idx < ${#RELEASES[@]} )); then
      DEFAULT_RELEASE="${RELEASES[$next_idx]}"
    fi
    break
  fi
done
if [[ -z "$DEFAULT_RELEASE" && "${#RELEASES[@]}" -gt 0 ]]; then
  DEFAULT_RELEASE="${RELEASES[0]}"
fi

echo "==> 当前版本: ${CURRENT_RELEASE:-未找到 current 软链}"
echo "==> 可回滚版本:"
for idx in "${!RELEASES[@]}"; do
  mark=""
  if [[ "${RELEASES[$idx]}" == "$CURRENT_RELEASE" ]]; then
    mark=" (当前)"
  elif [[ "${RELEASES[$idx]}" == "$DEFAULT_RELEASE" ]]; then
    mark=" (默认)"
  fi
  printf '  [%d] %s%s\n' "$((idx + 1))" "${RELEASES[$idx]}" "$mark"
done

if [[ "$LIST_ONLY" == "1" ]]; then
  exit 0
fi

if [[ -z "$TARGET_RELEASE" ]]; then
  if [[ -t 0 ]]; then
    echo ""
    read -r -p "请输入要回滚的序号/版本号，直接回车使用默认版本 [${DEFAULT_RELEASE}]: " USER_INPUT
    USER_INPUT="${USER_INPUT//[[:space:]]/}"
    if [[ -z "$USER_INPUT" ]]; then
      TARGET_RELEASE="$DEFAULT_RELEASE"
    elif [[ "$USER_INPUT" =~ ^[0-9]+$ ]] && (( USER_INPUT >= 1 && USER_INPUT <= ${#RELEASES[@]} )); then
      TARGET_RELEASE="${RELEASES[$((USER_INPUT - 1))]}"
    else
      TARGET_RELEASE="$USER_INPUT"
    fi
  else
    TARGET_RELEASE="$DEFAULT_RELEASE"
  fi
fi

if [[ -z "$TARGET_RELEASE" ]]; then
  echo "无法确定回滚目标版本"
  exit 1
fi

FOUND_TARGET=0
for release in "${RELEASES[@]}"; do
  if [[ "$release" == "$TARGET_RELEASE" ]]; then
    FOUND_TARGET=1
    break
  fi
done

if [[ "$FOUND_TARGET" != "1" ]]; then
  echo "未找到指定版本: ${TARGET_RELEASE}"
  exit 1
fi

if [[ -n "$CURRENT_RELEASE" && "$TARGET_RELEASE" == "$CURRENT_RELEASE" ]]; then
  echo "目标版本就是当前版本，无需回滚: ${TARGET_RELEASE}"
  exit 0
fi

echo ""
echo "==> 准备回滚到版本: ${TARGET_RELEASE}"

"${SSH_CMD[@]}" -tt \
  "REMOTE_DIR='${REMOTE_DIR}' APP_NAME='${APP_NAME}' APP_PORT='${APP_PORT}' TARGET_RELEASE='${TARGET_RELEASE}' REMOTE_TRACE='${REMOTE_TRACE}' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

if [[ "${REMOTE_TRACE}" == "1" ]]; then
  set -x
fi

TARGET_DIR="${REMOTE_DIR}/releases/${TARGET_RELEASE}"
if [[ ! -d "${TARGET_DIR}" ]]; then
  echo "[remote] 目标版本不存在: ${TARGET_DIR}"
  exit 1
fi

if [[ ! -f "${TARGET_DIR}/ecosystem.config.cjs" ]]; then
  echo "[remote] 缺少文件: ${TARGET_DIR}/ecosystem.config.cjs"
  exit 1
fi

echo "[remote] 切换 current -> ${TARGET_DIR}"
ln -sfn "${TARGET_DIR}" "${REMOTE_DIR}/current"

if [[ ! -f "${REMOTE_DIR}/shared/.env" ]]; then
  echo "[remote] 缺少 ${REMOTE_DIR}/shared/.env，请先检查环境文件"
  exit 1
fi

cd "${REMOTE_DIR}/current"
ln -sfn "${REMOTE_DIR}/shared/.env" .env

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[remote] 未安装 pm2，无法执行回滚"
  exit 1
fi

echo "[remote] 重启 PM2 应用: ${APP_NAME}"
pm2 delete "${APP_NAME}" 2>/dev/null || true
APP_NAME="${APP_NAME}" APP_PORT="${APP_PORT}" pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 status "${APP_NAME}"

echo ""
echo "[remote] ========== 健康检查 =========="
MAX_RETRIES=5
HEALTHY=0
for i in $(seq 1 $MAX_RETRIES); do
  sleep 2
  if curl -sf "http://127.0.0.1:${APP_PORT}/api-docs/v1" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  echo "[remote] 第 ${i}/${MAX_RETRIES} 次检查未通过，等待重试..."
done

if [[ "$HEALTHY" == "1" ]]; then
  echo "[remote] ✅ 回滚后服务正常响应"
else
  echo "[remote] ⚠️  回滚后服务未响应，开始排查..."
  echo ""
  echo "[remote] ---------- PM2 状态 ----------"
  pm2 status "${APP_NAME}" 2>&1 || true
  echo ""
  echo "[remote] ---------- PM2 错误日志（最后 50 行） ----------"
  pm2 logs "${APP_NAME}" --err --nostream --lines 50 2>&1 || true
  echo ""
  echo "[remote] ---------- PM2 输出日志（最后 30 行） ----------"
  pm2 logs "${APP_NAME}" --out --nostream --lines 30 2>&1 || true
  exit 1
fi
REMOTE_SCRIPT

echo ""
echo "========================================"
echo "  ✅ 回滚完成"
echo "========================================"
echo "  回滚版本: ${TARGET_RELEASE}"
echo "  服务目录: ${REMOTE_DIR}/current"
echo "  端口:     ${APP_PORT}"
echo "  Swagger:  http://${DEPLOY_HOST}:${APP_PORT}/api-docs/v1"
echo "========================================"
