#!/usr/bin/env bash
# Один запуск демо: поднимает API, ждёт health, открывает браузер.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}"
PID_FILE="$ROOT/.demo.pid"
STATE_FILE="${STATE_FILE:-$ROOT/.demo-state.json}"
LOG_FILE="$ROOT/.demo.log"

NODE="${NODE_BIN:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node}"
if [[ ! -x "$NODE" ]]; then
  NODE="$(command -v node || true)"
fi
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  echo "Node.js не найден. Укажите NODE_BIN=/path/to/node" >&2
  exit 1
fi

if curl -fsS -m 1 "${URL}/v1/health" >/dev/null 2>&1; then
  echo "Демо уже запущено: ${URL}"
  open "$URL" 2>/dev/null || true
  exit 0
fi

cd "$ROOT"
STATE_FILE="$STATE_FILE" nohup "$NODE" apps/api/src/server.js >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

for _ in $(seq 1 30); do
  if curl -fsS -m 1 "${URL}/v1/health" >/dev/null 2>&1; then
    echo "Демо готово: ${URL}"
  echo "Состояние: ${STATE_FILE} (черновики переживают перезапуск)"
    echo "Логи: ${LOG_FILE}"
    echo "Остановить: ${ROOT}/scripts/demo-stop.sh"
    open "$URL" 2>/dev/null || true
    exit 0
  fi
  sleep 0.5
done

echo "Сервер не поднялся. Последние строки лога:" >&2
tail -20 "$LOG_FILE" >&2 || true
exit 1
