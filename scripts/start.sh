#!/usr/bin/env bash
# Arranca el bot (y evita que Termux suspenda el proceso)
set -e
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "➜ Instalando dependencias por primera vez..."
  npm install --omit=dev
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null || true
  echo "🔒 wake-lock activado (evita que Android duerma el bot)"
fi

node src/index.js "$@"
