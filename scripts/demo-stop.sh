#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/.demo.pid"
if [[ ! -f "$PID_FILE" ]]; then
  echo "Демо не запущено (нет .demo.pid)."
  exit 0
fi
PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Остановлено: PID $PID"
else
  echo "Процесс $PID уже не работает."
fi
rm -f "$PID_FILE"
