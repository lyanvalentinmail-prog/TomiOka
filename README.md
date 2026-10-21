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
- 🖼️ **Menú con banner**: `.help` se envía como pie de foto de una imagen (por defecto `banner.jpg` de Google Drive, con caché local). Cada vez que pedís un menú nuevo, **todos** los anteriores se retiran: los de texto quedan editados como **"Menu eliminado."** y los que llevan banner se eliminan para todos (WhatsApp no permite editar una foto hasta convertirla en texto; si un texto es muy viejo para editarse, también se elimina).
- ✏️ **Mensajes que se actualizan solos**: el progreso de `.pack` es un único mensaje que se edita con cada sticker (no manda uno por foto), y `.debug` edita el "Ejecutando diagnóstico…" con el resultado.
- 🪶 **Pensado para Termux**: sin compiladores, sin dependencias nativas, ZIP incluido en el código.
- 🧪 **Tests** con `node --test` (180 pruebas) y `npm run doctor` para diagnóstico.

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

> ♻️ **Si ya hay sesión guardada, el bot conecta solo**: no pregunta nada, no muestra QR
> ni pide código. Esto es lo normal en Termux: cerrás la terminal, volvés a `npm start`
> y el bot vuelve a entrar con la sesión de `sessions/`.

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
- Al arrancar, el bot revisa `sessions/creds.json`:
  - **válida** → conecta automáticamente (ignora `--qr`, `--pair` y `login` de `config.json`);
  - **inválida o dañada** → la mueve a `sessions.invalid-<fecha>/` (no se pierde nada) y pide vincular de nuevo;
  - **no existe** → pregunta cómo vincular.
- Para desvincular: `npm start -- --relink` (mueve la sesión a un respaldo y vuelve a pedir vinculación)
  o directamente `rm -rf sessions`.
- Si WhatsApp cierra la sesión (logout desde el teléfono), el bot lo detecta, avisa y pide re-vincular.
- El comando `.debug` muestra el estado de la sesión y audita un sticker de prueba (alfa, cuadros, tamaño).

---

## 🕹️ Comandos

El prefijo por defecto es `.` (se cambia en `config.json`).

| Comando | Alias | Qué hace |
|---------|-------|----------|
| `.sticker` | `.s`, `.stiker`, `.figu` | Crea un sticker desde imagen, video, GIF o reenvía un sticker con tus metadatos |
| `.gif` | `.stikergif`, `.togif` | Convierte un GIF o video en sticker **animado** |
| `.toimg` | `.toimage`, `.img` | Pasa un sticker a imagen PNG (en animados usa el primer cuadro) |
| `.tovideo` | `.tomp4` | Pasa un sticker a video MP4 (los estáticos se convierten en un video de 2 s) |
| `.take Nombre \| Autor` | `.autor`, `.rename` | Cambia nombre y autor del sticker; también acepta fotos/videos (los convierte antes) |
| `.steal` | `.robar`, `.copy` | Copia el sticker (o una foto/video) con el nombre del bot |
| `.emojimix 😺 🐼` | `.mix` | Combina dos emojis (o sin argumentos para una mezcla aleatoria) |
| `.pack Nombre \| Autor` | `.packsticker` | Inicia un pack; envía **varias fotos/videos** (se convierten solos) y cierra con `.pack done` |
| `.help` | `.menu`, `.comandos` | Muestra el menú; `.help sticker` muestra la ayuda de un comando |
| `.debug` | `.diag` | Diagnóstico del bot en el chat (FFmpeg, carpetas, sesión y una conversión real). No aparece en el menú |

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
.pack done          ← envía el paquete de stickers a WhatsApp

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
   El avance se muestra **editando el mismo mensaje** (`📥 3/30`), así el chat no se llena de mensajes:
   `.pack status`, `.pack cancel` y `.pack done` también actualizan ese mensaje.
3. `.pack done` envía el **paquete nativo de WhatsApp**: aparece la tarjeta del pack con el botón para
   agregarlo a tus stickers (con nombre, autor y vista previa). No hace falta descargar ni importar nada.
   - Si el envío nativo falla (por ejemplo, un WhatsApp muy viejo), el bot manda el `.wasticker` como
     archivo de respaldo para importarlo con una app de packs.
4. `.pack cancel` descarta la sesión · `.pack status` muestra el avance · `.pack add` (respondiendo a un archivo).

Configurable en `pack`:

| Opción | Por defecto | Qué hace |
|--------|-------------|----------|
| `acceptPhotos` | `true` | Las fotos se convierten en sticker automáticamente |
| `acceptVideos` | `true` | Los videos y GIFs también (sticker animado) |
| `maxStickers` | `30` | Tope de stickers por pack |
| `autoDoneAfter` | `0` | `0` = cierra solo con `.pack done`; con `N` descarga el pack al llegar a N |

El paquete viaja como ZIP cifrado (`contents.json` + stickers + vista previa), igual que un `.wasticker`,
pero se envía como `stickerPackMessage` para que WhatsApp lo reconozca directamente. El mismo ZIP queda
disponible como `.wasticker` si alguna vez hace falta importarlo con Sticker Maker.

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
│   ├── index.js             # entrada + CLI (--pair, --qr, --phone, --relink, --doctor)
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
│   │   ├── webp.js          # edición de chunks WebP sin re-mux (alfa intacto)
│   │   ├── session.js       # detecta/valida/respalda la sesión guardada
│   │   ├── live-messages.js # edita el menú/progreso en vez de repetir mensajes
│   │   ├── sticker-pack.js  # envía el paquete nativo de stickers a WhatsApp
│   │   ├── banner.js        # banner del menú (Drive/URL/local) con caché
│   │   ├── tmp.js           # carpetas temporales con respaldo para Termux
│   │   ├── emojimix.js      # catálogo Emoji Kitchen con caché
│   │   ├── zip.js           # generador ZIP sin dependencias
│   │   ├── sessions.js      # sesiones de packs con expiración
│   │   ├── message.js       # extracción de media y citas
│   │   └── context.js       # helpers que usan los comandos
├── scripts/
│   ├── setup-termux.sh      # instalación automática en Termux
│   ├── start.sh             # arranque con wake-lock
│   ├── selftest.js          # diagnóstico del pipeline de stickers
│   └── verify-commands.js   # prueba end-to-end de todos los comandos
├── tests/                   # node --test (180 pruebas)
├── sessions/                # credenciales (ignorada)
└── data/                    # caché emojimix, temporales y menús guardados (ignorada)
```

---

## 🧪 Tests y diagnóstico

```bash
npm test           # 180 pruebas (menú, banner, ZIP, stickers, WebP, sesión, packs, pipeline, handler)
npm run verify     # ejecuta TODOS los comandos simulando mensajes de WhatsApp (37 verificaciones)
npm run selftest   # conversiones reales con FFmpeg y explicación de cada falla
npm run doctor     # FFmpeg, carpetas, banner, espacio, sesión + prueba real
```

### Si algo no convierte (stickers, toimg, tovideo…)

Desde el propio chat:

```
.debug
```

Responde con versión de Node, ruta y capacidades de FFmpeg, carpeta temporal,
banner, sesión y **una conversión real** paso a paso. En la terminal:

```bash
npm run selftest
```

Qué revisa y cómo se arregla:

| Paso que falla | Causa | Solución |
|----------------|-------|----------|
| `ffmpeg disponible` | FFmpeg no instalado | `pkg install ffmpeg` (Termux) |
| `codificador WebP` | FFmpeg sin libwebp | `pkg install ffmpeg libwebp` y reiniciar |
| `carpeta temporal` | `TMPDIR` apunta a algo inexistente (típico en Termux) | `export TOMIOKA_TMPDIR="$HOME/tomioka-tmp"` |
| `estático` / `animado` | opciones no soportadas | el bot ya reintenta con variantes compatibles (`-preset`, `-loop` y `-quality` opcionales) |

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
| `.take` no cambia el nombre | WhatsApp cachea el pack: el bot ya genera un `pack-id` nuevo; borra el sticker del chat y reenvíalo |
| `.take`/`.steal` con una foto dicen "Bad header" | Versión anterior: ahora aceptan fotos y videos y los convierten antes |
| Todo lo que usa FFmpeg falla en Termux | `TMPDIR` inválido: el bot usa `data/tmp` como respaldo; verifica con `.debug` o `npm run selftest` |
| `.emojimix` tarda la primera vez | Está descargando el catálogo (~95 MB); luego queda en `data/emojimix-index.json` |
| WhatsApp dice "no se puede ver la información del sticker" | Corregido: el bloque EXIF ahora declara el largo del JSON (antes quedaba en 0 y WhatsApp no leía el nombre/autor). Generá el sticker de nuevo |
| Los stickers salían con fondo negro o cortados | Corregido: los metadatos se escriben sin re-muxear, así que el sticker mantiene la transparencia y todos los cuadros del GIF/video |
| Antes pedía código/QR aunque ya había sesión | Corregido: ahora detecta `sessions/creds.json`, conecta solo y respalda la sesión si está dañada |
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
