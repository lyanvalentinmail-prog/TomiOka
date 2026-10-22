#!/usr/bin/env bash
# Arranca el bot (y evita que Termux suspenda el proceso)
set -e
cd "$(dirname "$0")/.."

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null || true
  echo "🔒 wake-lock activado (evita que Android duerma el bot)"
fi

# boot.js instala las dependencias si faltan y entra a src/index.js
node scripts/boot.js "$@"
