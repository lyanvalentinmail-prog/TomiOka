#!/data/data/com.termux/files/usr/bin/bash
# ---------------------------------------------------------------
#  TomiOka Bot · instalación automática en Termux
#  Uso:  bash scripts/setup-termux.sh
# ---------------------------------------------------------------
set -e

GREEN='\033[1;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RESET='\033[0m'

info() { printf "${CYAN}➜${RESET} %s\n" "$1"; }
ok()   { printf "${GREEN}✔${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}▲${RESET} %s\n" "$1"; }

if [ -z "$PREFIX" ] || [ ! -d "/data/data/com.termux" ]; then
  warn "Este script está pensado para Termux (Android). Continúa bajo tu responsabilidad."
fi

info "Actualizando repositorios de Termux..."
pkg update -y >/dev/null 2>&1 || warn "No se pudo actualizar (puedes continuar igual)."

info "Instalando dependencias del sistema (Node.js, FFmpeg, Git, yt-dlp)..."
pkg install -y nodejs-lts ffmpeg git libwebp yt-dlp >/dev/null || pkg install -y node ffmpeg git

ok "Node.js $(node -v)"
ok "FFmpeg $(ffmpeg -version 2>/dev/null | head -n1 | cut -d' ' -f3)"

# yt-dlp lo usan .tiktok, .instagram, .ytmp3 y .ytmp4
if command -v yt-dlp >/dev/null 2>&1; then
  ok "yt-dlp $(yt-dlp --version 2>/dev/null | head -n1)"
else
  warn "yt-dlp no quedó instalado: los descargadores (.tiktok, .instagram, .ytmp3, .ytmp4) no funcionarán."
  warn "Instálalo con: pkg install yt-dlp   (o: pip install -U yt-dlp)"
fi

info "Instalando dependencias de Node..."
npm install --omit=dev

info "Verificando que FFmpeg pueda crear WebP..."
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -qi libwebp; then
  ok "codificador WebP disponible"
else
  warn "FFmpeg no tiene libwebp: los stickers podrían fallar."
  warn "Prueba: pkg install ffmpeg libwebp"
fi

mkdir -p sessions data/tmp

echo
ok "Instalación terminada."
echo
echo -e "${CYAN}Para arrancar el bot:${RESET}"
echo "   npm start            # te pregunta si quieres pairing code o QR"
echo "   npm run pair         # código de vinculación"
echo "   npm run qr           # código QR"
echo
echo -e "${CYAN}Recomendaciones en Termux:${RESET}"
echo "   termux-wake-lock     # evita que Android suspenda el bot"
echo "   pkg install tmux     # ejecútalo dentro de tmux para que siga activo"
echo
