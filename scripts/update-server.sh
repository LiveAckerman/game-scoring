#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/server.env}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "未找到配置文件: $CONFIG_FILE"
  echo "请先复制模板并填写: cp $SCRIPT_DIR/server.env.example $SCRIPT_DIR/server.env"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
set +a

"$SCRIPT_DIR/deploy-server.sh"
