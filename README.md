# 🌊 TomiOka Bot

Bot de WhatsApp hecho con **Baileys**, pensado para correr en **Termux (Android)**, en un VPS o en cualquier Linux.
Se vincula con **código de vinculación (pairing code)** o con **código QR**, y viene con un menú aesthetic y
comandos para crear stickers, convertir archivos, combinar emojis y armar paquetes de stickers.

```
ㅤ➢ㅤ︵ ₊˚๑ ꒰♯🌊⸝⸝@𝐓͠ᨵ꯭꯭ׁׅׅ𝐌𝐈𖣠꙰𝐊𝐀─𓉳 ꒱
ㅤㅤㅤ𝓜𝓮𝓷𝓾 𝓭𝓮 𝓬𝓸𝓶𝓪𝓷𝓭𝓸𝓼  ( ᵕ ᴗ ᵕ )♡
```

---

## ✨ Características

- 🔐 **Dos formas de vincular**: pairing code (recomendado en Termux) y QR.
- 🔁 **Reconexión automática** y manejo de sesión (`sessions/`): vinculas una sola vez.
- 🖼️ **Stickers** desde imagen, video o GIF (recorte, escala 512×512 y transparencia).
- 🎞️ **Conversión inversa**: sticker → imagen PNG y sticker → video MP4.
- 🏷️ **Metadatos**: `.take` y `.steal` cambian el nombre/autor del sticker.
- 🍳 **Emoji Mix**: combinaciones de Google Emoji Kitchen (catálogo con caché local).
- 📦 **Packs de stickers** en formato `.wasticker` (ZIP con `contents.json`, stickers y vista previa).
  Se arman **enviando varias fotos** (o videos/GIFs/stickers) y terminan con `.pack done`.
- 🧾 **Menú compacto y configurable** desde `config.json`: sin líneas vacías, solo el nombre del comando y una única categoría con todos los comandos (`commands: []`).
- 🖼️ **Menú con banner**: `.help` se envía como pie de foto de una imagen (por defecto `banner.jpg` de Google Drive, con caché local).
- 🪶 **Pensado para Termux**: sin compiladores, sin dependencias nativas, ZIP incluido en el código.
- 🧪 **Tests** con `node --test` (88 pruebas) y `npm run doctor` para diagnóstico.

---

## 📋 Requisitos

| Requisito | Versión / nota |
|-----------|----------------|
| Node.js | **20 o superior** (Termux: `pkg install nodejs-lts`) |
| FFmpeg | con codificador **libwebp** (`pkg install ffmpeg`) |
| Espacio | ~150 MB con dependencias + 95 MB si usas `.emojimix` (solo la primera vez) |
| Cuenta de WhatsApp | número que actuará como bot (puede ser tu número personal) |

> Sin FFmpeg el bot arranca igual, pero los comandos de stickers/conversión responden con un aviso.

---

## 🚀 Instalación en Termux

```bash
# 1. Paquetes del sistema
pkg update -y && pkg install -y nodejs-lts git ffmpeg libwebp

# 2. Clonar el proyecto
git clone https://github.com/lyanvalentinmail-prog/TomiOka.git
cd TomiOka

# 3. Instalar dependencias de Node
npm install

# 4. (Opcional) diagnóstico del entorno
npm run doctor

# 5. Arrancar
npm start
```

O directamente:

```bash
bash scripts/setup-termux.sh
npm start
```

### Mantener el bot vivo en Android

```bash
termux-wake-lock        # evita que Android suspenda Termux
pkg install tmux        # ábrelo dentro de tmux
tmux new -s tomioka
npm start
# salir de tmux: Ctrl+B y luego D · volver: tmux attach -t tomioka
```

También puedes usar `bash scripts/start.sh` (activa el wake-lock automáticamente).

### Instalación en Linux / VPS

```bash
sudo apt update && sudo apt install -y nodejs npm ffmpeg
npm install
npm start
```

---

## 🔗 Vincular WhatsApp

La primera vez no existe sesión, así que el bot pregunta cómo vincular.

### Opción A · Pairing code (recomendado)

```bash
npm start -- --pair
# o bien
npm run pair
# con el número directo:
node src/index.js --pair --phone 59891234567
```

1. El bot muestra un código de 8 dígitos (ej. `ABCD-1234`).
2. En WhatsApp: **Ajustes → Dispositivos vinculados → Vincular un dispositivo → Vincular con número de teléfono**.
3. Escribe el código. Listo: la sesión queda guardada en `sessions/`.

### Opción B · Código QR

```bash
npm start -- --qr
# o bien
npm run qr
```

Escanea el QR de la terminal con **WhatsApp → Dispositivos vinculados → Vincular un dispositivo**.

> 💡 El QR se renueva solo cada ~20 s. Si lo necesitas más grande, achica la fuente de Termux o usa pairing code.

### Sesión guardada

- Las credenciales quedan en `sessions/` (ignorada por Git).
- Para desvincular: borra la carpeta `rm -rf sessions` y vuelve a iniciar.
- Si WhatsApp cierra la sesión (logout), el bot borra `sessions/` automáticamente y pide re-vincular.

---

## 🕹️ Comandos

El prefijo por defecto es `.` (se cambia en `config.json`).

| Comando | Alias | Qué hace |
|---------|-------|----------|
| `.sticker` | `.s`, `.stiker`, `.figu` | Crea un sticker desde imagen, video, GIF o reenvía un sticker con tus metadatos |
| `.gif` | `.stikergif`, `.togif` | Convierte un GIF o video en sticker **animado** |
| `.toimg` | `.toimage`, `.img` | Pasa un sticker a imagen PNG (en animados usa el primer cuadro) |
| `.tovideo` | `.tomp4` | Pasa un sticker a video MP4 (los estáticos se convierten en un video de 2 s) |
| `.take Nombre \| Autor` | `.autor`, `.rename` | Cambia nombre y autor del sticker; sin argumentos vuelve a los del bot |
| `.steal` | `.robar`, `.copy` | Copia el sticker con el nombre del bot |
| `.emojimix 😺 🐼` | `.mix` | Combina dos emojis (o sin argumentos para una mezcla aleatoria) |
| `.pack Nombre \| Autor` | `.packsticker` | Inicia un pack; envía **varias fotos/videos** (se convierten solos) y cierra con `.pack done` |
| `.help` | `.menu`, `.comandos` | Muestra el menú; `.help sticker` muestra la ayuda de un comando |

### Ejemplos rápidos

```
# respondiendo a una foto
.sticker

# respondiendo a un sticker
.take Olas del mar | Tomi 🌊
.toimg
.tovideo

# emojis
.emojimix 😺 🐼
.emojimix           ← aleatorio

# pack de stickers con fotos
.pack Gatitos | Tomi
(foto)              ← se agrega sola (convertida a sticker)
(foto)
(foto)
.pack done          ← devuelve Gatitos.wasticker

# también sirve con el comando como pie de foto
(foto con pie: ".pack Gatitos | Tomi")   ← inicia el pack y agrega esa foto
(foto) (foto) (foto)
.pack done
```

### Cómo funciona `.pack`

1. `.pack Nombre | Autor` abre una sesión (10 minutos de inactividad).
2. Envía **varias fotos**, videos, GIFs o stickers: se agregan solos (máx. 30 por pack), las fotos y videos
   se convierten a sticker al vuelo y el bot va reaccionando con el número (1️⃣, 2️⃣, 3️⃣…).
   También puedes mandar el comando como **pie de foto**: esa imagen entra directo al pack.
3. `.pack done` genera un ZIP `.wasticker` con `contents.json`, todos los stickers y la vista previa.
4. `.pack cancel` descarta la sesión · `.pack status` muestra el avance · `.pack add` (respondiendo a un archivo).

Configurable en `pack`:

| Opción | Por defecto | Qué hace |
|--------|-------------|----------|
| `acceptPhotos` | `true` | Las fotos se convierten en sticker automáticamente |
| `acceptVideos` | `true` | Los videos y GIFs también (sticker animado) |
| `maxStickers` | `30` | Tope de stickers por pack |
| `autoDoneAfter` | `0` | `0` = cierra solo con `.pack done`; con `N` descarga el pack al llegar a N |

El archivo `.wasticker` se puede importar con apps de packs de stickers (por ejemplo Sticker Maker).

---

## ⚙️ Configuración (`config.json`)

```jsonc
{
  "bot": {
    "name": "@𝐓͠ᨵ꯭꯭ׁׅׅ𝐌𝐈𖣠꙰𝐊𝐀",   // nombre que aparece en el menú
    "team": "◢🌊◣ 𝕿𝖔𝖒𝖎𝖐𝖆 ࿙💧࿚",
    "prefix": ".",                  // o ["." , "!", "/"] para varios prefijos
    "version": "1.0",
    "status": "ᴏɴʟɪɴᴇ",
    "year": "2026"
  },
  "login": "ask",                   // "ask" | "pairing" | "qr"
  "pairingPhone": "",               // ej. "59891234567" (con código de país)
  "owner": { "numbers": [], "allowFromMe": false },
  "stickers": {
    "packName": "TomiOka",
    "packAuthor": "◢🌊◣ 𝕿𝖔𝖒𝖎𝖐𝖆",
    "fps": 15,
    "maxAnimatedSeconds": 6.5,
    "quality": 82,
    "maxStaticKB": 100,
    "maxAnimatedKB": 500
  },
  "pack": {
    "maxStickers": 30,
    "sessionMinutes": 10,
    "acceptPhotos": true,           // fotos → sticker automáticamente
    "acceptVideos": true,           // videos/GIFs → sticker animado
    "autoDoneAfter": 0              // 0 = cerrar solo con .pack done
  },
  "emojimix": { "enabled": true },
  "behavior": {
    "cooldownMs": 2500,             // anti-spam por usuario
    "reactToCommands": true,        // ⏳ / ✅ / ❌
    "sendTyping": true,
    "respondInGroups": true,
    "requirePrefixInDM": true,      // en privado también exige prefijo
    "ignoreFromMe": false           // el bot ignora sus propios envíos por ID
  },
  "menu": {
    "image": "https://drive.google.com/file/d/1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV/view", // banner
    "imageCacheMinutes": 720,       // 0 = vuelve a descargar en cada menú
    "sendAsCaption": true,          // menú como pie de foto del banner
    "showDescriptions": false,      // el menú muestra solo el comando, sin descripción
    "showUser": true,
    "phrases": ["El océano también guarda secretos 🌊", "Un sticker vale más que mil palabras 💧"],
    "categories": [
      {
        "emoji": "🌊",
        "description": "𝖳𝗈𝖽𝗈𝗌 𝗅𝗈𝗌 𝖼𝗈𝗆𝖺𝗇𝖽𝗈𝗌",
        "kaomoji": "( ᵕ ᵗ ᵕ )",
        "divider": ["💧", "🌊"],
        "commands": []              // [] = todos los comandos registrados
      }
    ]
  }
}
```

### Variables de entorno (opcionales)

| Variable | Ejemplo | Para qué |
|----------|---------|----------|
| `BOT_PREFIX` | `!` | Cambia el prefijo sin tocar el JSON |
| `LOGIN` | `pairing` / `qr` | Método de vinculación |
| `PAIRING_PHONE` | `59891234567` | Número para pairing |
| `SESSION_DIR` | `./sessions2` | Carpeta de credenciales |
| `OWNER_NUMBERS` | `5989...,5989...` | Dueños separados por coma |
| `FFMPEG_PATH` | `/data/.../ffmpeg` | Usar un FFmpeg específico |
| `LOG_LEVEL` | `debug` | Nivel de logs |
| `MENU_IMAGE` | `https://.../menu.jpg` | Banner del menú (URL, Drive o ruta local) |

---

## 🧱 Estructura del proyecto

```
TomiOka/
├── config.json              # configuración del bot y del menú
├── src/
│   ├── index.js             # entrada + CLI (--pair, --qr, --phone, --doctor)
│   ├── connection.js        # Baileys, pairing/QR, reconexión
│   ├── handler.js           # enrutado de mensajes, cooldowns, errores
│   ├── menu.js              # menú aesthetic y ayuda por comando
│   ├── config.js            # defaults, env, validaciones
│   ├── doctor.js            # diagnóstico (FFmpeg, dependencias, espacio)
│   ├── commands/            # un archivo por comando
│   ├── lib/
│   │   ├── ffmpeg.js        # detección de FFmpeg + argumentos
│   │   ├── media.js         # imagen/GIF/video ↔ sticker
│   │   ├── sticker.js       # EXIF (nombre/autor), demux WebP
│   │   ├── banner.js        # banner del menú (Drive/URL/local) con caché
│   │   ├── emojimix.js      # catálogo Emoji Kitchen con caché
│   │   ├── zip.js           # generador ZIP sin dependencias
│   │   ├── sessions.js      # sesiones de packs con expiración
│   │   ├── message.js       # extracción de media y citas
│   │   └── context.js       # helpers que usan los comandos
├── scripts/
│   ├── setup-termux.sh      # instalación automática en Termux
│   ├── start.sh             # arranque con wake-lock
│   └── verify-commands.js   # prueba end-to-end de todos los comandos
├── tests/                   # node --test (88 pruebas)
├── sessions/                # credenciales (ignorada)
└── data/                    # caché emojimix y temporales (ignorada)
```

---

## 🧪 Tests y diagnóstico

```bash
npm test           # 113 pruebas (menú, banner, ZIP, stickers, packs, handler)
npm run verify     # ejecuta TODOS los comandos simulando mensajes de WhatsApp
npm run doctor     # FFmpeg, dependencias, banner, carpetas, espacio, sesión
```

`npm run verify` recorre el handler real con fixtures locales (no necesita cuenta de WhatsApp):

```
✔ .help (menú con banner)                     OK react×2 image×1
✔ .sticker (foto)                             OK react×2 sticker×1
✔ .gif (GIF animado)                          OK react×2 sticker×1
✔ .toimg (sticker → PNG)                      OK react×2 image×1
✔ .tovideo (sticker → MP4)                    OK react×2 video×1
✔ .take Olas | Tomi (metadatos)               OK react×2 sticker×1
✔ .steal (copia con metadatos del bot)        OK react×2 sticker×1
✔ .emojimix 😀 🔥 (catálogo en caché)         OK react×2 sticker×1
✔ .pack done (genera .wasticker)              OK react×2 document×1
✔ .wasticker válido (3 stickers + vista previa)   contents.json + 3 webp
✔ 29/29 verificaciones OK
```

Los tests de conversión se saltan solos si no hay FFmpeg disponible.

El catálogo de emojis (~95 MB, usa ~300 MB de RAM mientras se procesa una sola vez) se puede pre-descargar
para no esperar en el primer `.emojimix`:

```bash
npm run emojimix:sync
```

---

## 🩺 Problemas frecuentes

| Síntoma | Solución |
|---------|----------|
| `FFmpeg no encontrado` | `pkg install ffmpeg` y reinicia el bot |
| `Tu FFmpeg no incluye el codificador WebP` | `pkg install ffmpeg libwebp` (usa el repo oficial de Termux) |
| El pairing code nunca aparece | Usa `node src/index.js --pair --phone <número con país>`; el código se genera al conectar |
| `Connection Closed` en bucle | Borra `sessions/`, revisa internet y vuelve a vincular |
| `logged out` | La sesión se cerró desde el teléfono: borra `sessions/` y vincula de nuevo |
| Los stickers pesan demasiado | Baja `stickers.quality` o `maxStaticKB` en `config.json` |
| `.emojimix` tarda la primera vez | Está descargando el catálogo (~95 MB); luego queda en `data/emojimix-index.json` |
| El bot se detiene solo en Android | `termux-wake-lock` + `tmux`; desactiva optimización de batería para Termux |
| `.help` llega sin la imagen del banner | El archivo de Drive debe ser público ("cualquiera con el enlace"); revisa `npm run doctor`. También puedes usar una ruta local: `"image": "banner.jpg"` |
| Cambié el banner y sigue el viejo | Pon `"imageCacheMinutes": 0` o borra `data/cache/menu-image-*` |
| Los comandos no responden en grupos | Verifica el prefijo (`.` por defecto) y `behavior.respondInGroups` |

---

## ⚠️ Uso responsable

Este proyecto es para uso personal y educativo. Automatizar una cuenta de WhatsApp puede ir contra sus
términos de servicio: úsalo con moderación, no para spam ni envíos masivos, y no compartas tu carpeta
`sessions/` (contiene las credenciales de tu cuenta).

---

## 📄 Licencia

MIT. Los stickers que genera el bot son tuyos; respeta los derechos de las imágenes que conviertas.
