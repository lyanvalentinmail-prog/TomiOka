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
- 🏷️ **Metadatos**: `.take` cambia el nombre/autor del sticker.
- 🍳 **Emoji Mix**: combinaciones de Google Emoji Kitchen (catálogo con caché local).
- 📦 **Packs de stickers** en formato `.wasticker` (ZIP con `contents.json`, stickers y vista previa).
  Se arman **enviando varias fotos** (o videos/GIFs/stickers) y terminan con `.pack done`.
- 🧾 **Menú completo y configurable** desde `config.json`: sin líneas vacías, usando los emojis principales del bot (`💧`, `🌊`, `🐟`, `💦`, `💙`) y con **todos los comandos** agrupados en seis categorías: 🌊 **Descargas**, 💧 **Stickers**, 💦 **Conversión**, 🐟 **Packs**, 💙 **AI** y 🌊 **Info**.
- ⬇️ **Descargadores** con `yt-dlp`: videos públicos de TikTok, Instagram y Pinterest y audio/video de YouTube (`.ytmp3` / `.ytmp4`).
- 🧠 **IA en el chat**: `.gemini`, `.chatgpt` y `.deepseek` consultan los modelos de **OpenCode** (`opencode.ai`).
  Sin ninguna clave usan el free tier del gateway; con `OPENCODE_API_KEY` usan el modelo oficial de cada marca.
- ✍️ **Stickers de texto**: `.brat` (fondo verde lima), `.attp` (animado con colores) y `.ttp` (texto con borde), generados localmente con FFmpeg.
- 🖼️ **Menú con banner**: `.help` carga el menú completo directamente como pie de foto del banner en un único mensaje (por defecto `banner.jpg` de Google Drive, con caché local), nunca por separado. Cada vez que pedís un menú nuevo, **todos** los anteriores se retiran: los que llevan banner se eliminan para todos y los de solo texto quedan editados como **"Menu eliminado."**.
- ✏️ **Mensajes que se actualizan solos**: el progreso de `.pack` es un único mensaje que se edita con cada sticker (no manda uno por foto), y `.debug` edita el "Ejecutando diagnóstico…" con el resultado.
- 🪶 **Pensado para Termux**: sin compiladores, sin dependencias nativas, ZIP incluido en el código.
- 🧪 **Tests** con `node --test` (287 pruebas) y `npm run doctor` para diagnóstico.
- 🌐 **Plataforma web** (`web/`): SPA/PWA copiada de la web de Project y rebrandeada como **TomiOka**, con rutas `/home`, `/register`, `/bots`, `/metrics`, `/store`, `/endpoints`, `/favorites`, `/tickets`, `/profile` y `/cmds`, servidor local con API real (`/api/state`, `/api/system`, `/api/commands`, `/api/endpoints/catalog`) y registro local de **sub-bots**. La tab de Endpoints web contiene solo los nueve endpoints de servicio (Descargas y Stickers); lo no implementado (cuentas, tienda, tickets o sesiones desde el navegador) responde con un mensaje claro, sin simular un backend.

---

## 🌐 Plataforma web

```bash
npm run web        # http://localhost:3000  (variable PORT para cambiar el puerto)
```

SPA/PWA en HTML, CSS y JavaScript copiada de la web de Project, con la marca y los
datos de TomiOka. El servidor local (`scripts/serve-web.js`) sirve la app y una API
acotada y veraz. Incluye:

1. **Landing y panel** con las rutas de la referencia: `/home`, `/register`, `/bots`, `/metrics`, `/store`, `/endpoints`, `/favorites`, `/tickets`, `/profile` y `/cmds`.
2. **Registro local de sub-bots**: `POST /api/instances` guarda cada sub-bot en `data/web-subbots.json` con su `sessions/<slug>` y su comando de vinculación por terminal (`SESSION_DIR=sessions/<slug> PAIRING_PHONE=... npm run pair` o `npm run qr`).
3. **Pairing code real desde el panel**: `POST /api/instances/:id/pairing` abre un socket de Baileys para ese sub-bot y le pide el código a WhatsApp (formato `XXXX-XXXX`, ~60 s de vigencia); el estado se sigue en vivo por `/api/instances/:id/link` y SSE (`/api/stream`). Al vincularse, el sub-bot queda en línea **y respondiendo comandos** desde el mismo proceso del panel, con su prefijo propio. También se puede detener/reiniciar desde Mis Bots.
4. **Endpoints**: solo los nueve comandos de WhatsApp del menú —TikTok downloader, Instagram downloader, Pinterest downloader, Youtube Mp3 y Youtube Mp4 en **Descargas**; Brat, Attp, Ttp y Sticker en **Stickers**—, servidos por `/api/endpoints/catalog` y `/api/v1`.
5. **Comandos reales del bot** en `/api/commands`, generados desde `src/commands/index.js`, y telemetría local del proceso en `/api/system` y `/api/health`.
6. **PWA completa**: `manifest.webmanifest`, `sw.js`, `icon.svg` y fuentes locales (Outfit y JetBrains Mono).

> El panel tiene cuentas locales reales: registro/login con contraseña cifrada
> (scrypt, en `data/web-accounts.json`), sesiones con token y API keys propias.
> Los emails de `OWNER_EMAIL` (por defecto `Lyanvalentinmail@gmail.com`) tienen
> rol **OWNER** y acceso al panel de administración de Endpoints. Lo que guardas
> en **Editar bot** se aplica en vivo a ese sub-bot: sus categorías reales son
> Descargas, Stickers, Herramientas e Información; el único estilo de menú es el
> de TomiOka; los comandos/categorías deshabilitados dejan de responder, los
> alias extra y los comandos personalizados funcionan, y los «números owner»
> son los dueños de ese sub-bot. Además, `npm start` instala las dependencias
> si faltan (scripts/boot.js). No vende planes
> ni guarda tickets: esos endpoints responden `501` con el motivo. La vinculación
> de WhatsApp sí es real desde el panel (pairing code de Baileys) o, si
> prefieres, por terminal con `npm run pair`/`npm run qr`.

### Desplegar la página: Render (Blueprint) o Vercel

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/lyanvalentinmail-prog/TomiOka)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/lyanvalentinmail-prog/TomiOka&project-name=tomioka-panel)

| Plataforma | Cómo | Qué usa del repo |
|------------|------|------------------|
| **Render (Blueprint)** | Botón de arriba, o en Render: **New + → Blueprint** → elegí este repo → *Apply* | `render.yaml`: crea el servicio web `tomioka-panel` con `node scripts/serve-web.js` (escucha en el `PORT` que asigna Render) y health check en `/` |
| **Vercel** | Botón de arriba, o en Vercel: **Add New → Project** → importá este repo | `vercel.json`: publica la carpeta `web/` como sitio estático, sin paso de build; cada push redespliega solo |

> Ambos despliegues publican **solo esta página**. El bot de WhatsApp (Baileys) necesita
> una sesión persistente y un proceso siempre activo: seguí corriéndolo en tu Termux/VPS.

## 📋 Requisitos

| Requisito | Versión / nota |
|-----------|----------------|
| Node.js | **20 o superior** (Termux: `pkg install nodejs-lts`) |
| FFmpeg | con codificador **libwebp** (`pkg install ffmpeg`) |
| yt-dlp | para `.tiktok`, `.instagram`, `.pinterest`, `.ytmp3` y `.ytmp4` (`pkg install yt-dlp` o `pip install -U yt-dlp`; ruta alternativa con `YTDLP_PATH`) |
| Espacio | ~150 MB con dependencias + 95 MB si usas `.emojimix` (solo la primera vez) |
| Cuenta de WhatsApp | número que actuará como bot (puede ser tu número personal) |

> Sin FFmpeg el bot arranca igual, pero los comandos de stickers/conversión responden con un aviso.

---

## 🚀 Instalación en Termux

```bash
# 1. Paquetes del sistema
pkg update -y && pkg install -y nodejs-lts git ffmpeg libwebp yt-dlp

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

### 🖥️ Terminal del bot (Termux)

TomiOka trae una terminal propia de **pantalla completa**: es una
**copia exacta de la TUI de [OpenCode](https://github.com/anomalyco/opencode)**
(MIT © opencode; gracias 💧), medida sobre su código fuente y adaptada
solo en marca y contenido: la misma home centrada (spacer de 3, logo
bitono con sombra en la fuente de bloques original, prompt de máx. 75
columnas con borde izquierdo `┃` en `#fab283`, fila de metadata
`agente · modelo · proveedor`, sombra `▀` inferior y footer
`⊙ estado … versión`), la paleta de comandos y los diálogos de
60/88 columnas abiertos a ¼ de pantalla sobre el fondo atenuado, la
sidebar de sesión de 42 columnas con fondo `#141414` y el tema oscuro
original completo (`#0a0a0a`, panel `#141414`, element `#1e1e1e`,
texto `#eeeeee`, muted `#808080`, primary `#fab283`). Sirve para
manejar el bot desde el celular, sin editar archivos a mano:

```bash
npm run terminal
```

**Controles:** en la home **escribes y las secciones se filtran**
sobre el prompt (el autocomplete de OpenCode); `↑↓` mueve, `Enter`
abre (sin texto abre la paleta) y `Esc` limpia la búsqueda. `Ctrl+P`
abre la **paleta de comandos** y `Ctrl+X` es la tecla líder, igual
que en OpenCode: `Ctrl+X` y después `b` sidebar, `c`/`n` consola,
`p` pairing, `r` QR, `s` estado, `e` editar, `m` menú, `g` comandos,
`l` sesión, `d` doctor, `v` verificar, `u` actualizar, `t` tema,
`1…9` salto rápido a una sección y `q`/`x` salir. `Ctrl+C`/`Ctrl+D`
salen (en la consola detienen el bot). En la home, cualquier carácter
escribible —incluidas `q` y `t`— filtra el prompt (no son atajos
ocultos). El tema se cambia desde la sección **Cambiar tema**, la
paleta o `Ctrl+X` + `t` (Océano, Atardecer, Menta, Violeta; se
recuerda entre sesiones). En **Editar configuración**, `Enter`
edita/cambia un campo y `e` abre `config.json` en tu editor
(`$EDITOR`, nano o vi) con respaldo `.bak`. También acepta mouse:
la rueda hace scroll y un clic abre. En las listas largas,
`PgUp`/`PgDn` saltan por páginas, y con `/` buscas dentro del menú
(`n`/`N` salta entre coincidencias).

Lo mejor: el bot corre **dentro de la terminal**, en una consola en vivo
con sus logs: el pairing code y el QR se ven ahí mismo, sin cambiar de
pantalla. Con `i` escribes al bot, `r` lo reinicia y `x` lo detiene. Al
vincular con pairing code no hay formularios: el bot te pide el número
**en la consola misma** (la escritura se enfoca sola), lo tipeás con
código de país, das Enter y el código de 8 dígitos sale ahí mismo.

Desde ahí puedes iniciar el bot, vincular con pairing code o QR, ver el
panel de estado (sesión, sistema y actividad, se refresca solo),
**editar la configuración en línea** (nombre, prefijo, teléfono de
pairing, owners, modo de login, pack de stickers, banner del menú y los
interruptores de pie de foto/descripciones; cada cambio guarda un
respaldo `config.json.bak`), ver el menú de WhatsApp y la lista completa
de comandos, crear **respaldos de la sesión** con fecha, correr el
diagnóstico (`doctor`), verificar los comandos, actualizar el repo con
`git pull` y borrar la sesión para volver a vincular. La pantalla se
redibuja por diferencias con salida sincronizada (sin parpadeo) y no
usa dependencias nuevas (solo ANSI de Node), así que funciona en
Termux sin compilar nada.

### Instalación en Linux / VPS

```bash
sudo apt update && sudo apt install -y nodejs npm ffmpeg yt-dlp
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
| **📥 Descargas** | | |
| `.tiktok <enlace>` | `.tiktokdl`, `.ttdl` | Descarga un video público de TikTok (usa yt-dlp) |
| `.instagram <enlace>` | `.ig`, `.instagramdl`, `.igdl` | Descarga un video o reel público de Instagram (usa yt-dlp) |
| `.pinterest <enlace>` | `.pin`, `.pinterestdl`, `.pindl` | Descarga el video (o la imagen) de un pin de Pinterest; acepta `pin.it` y dominios locales (usa yt-dlp) |
| `.ytmp3 <enlace>` | `.ytmp-3`, `.youtube-mp3` | Descarga el audio de YouTube en MP3 |
| `.ytmp4 <enlace>` | `.ytmp-4`, `.youtube-mp4` | Descarga un video de YouTube en MP4 |
| **🎨 Stickers** | | |
| `.brat <texto>` | | Sticker estilo Brat: fondo verde lima y texto negro en minúsculas |
| `.attp <texto>` | | Sticker **animado** con tu texto cambiando de color |
| `.ttp <texto>` | | Sticker con tu texto blanco y borde negro sobre transparencia |
| `.sticker` | `.s`, `.stiker`, `.figu` | Crea un sticker desde imagen, video, GIF o reenvía un sticker con tus metadatos |
| `.gif` | `.stikergif`, `.togif` | Convierte un GIF o video en sticker **animado** |
| `.toimg` | `.toimage`, `.img` | Pasa un sticker a imagen PNG (en animados usa el primer cuadro) |
| `.tovideo` | `.tomp4` | Pasa un sticker a video MP4 (los estáticos se convierten en un video de 2 s) |
| `.take nombre,autor` | `.autor`, `.rename` | Cambia nombre y autor del sticker; también acepta fotos/videos (los convierte antes) |
| `.emojimix 😺 🐼` | `.mix` | Combina dos emojis (o sin argumentos para una mezcla aleatoria) |
| `.pack nombre,autor` | `.packsticker` | Inicia un pack; envía **varias fotos/videos** (se convierten solos) y cierra con `.pack done` |
| **🧠 AI** | | |
| `.gemini <pregunta>` | `.geminiai`, `.google-ai` | Le pregunta a Gemini (Google). También sirve respondiendo a un mensaje |
| `.chatgpt <pregunta>` | `.gpt`, `.openai`, `.chat-gpt` | Le pregunta a ChatGPT (OpenAI) |
| `.deepseek <pregunta>` | `.deep`, `.seek` | Le pregunta a DeepSeek, que razona paso a paso |
| **💧 Info** | | |
| `.help` | `.menu`, `.comandos` | Muestra el menú; `.help sticker` muestra la ayuda de un comando |
| `.debug` | `.diag` | Diagnóstico del bot en el chat (FFmpeg, carpetas, sesión y una conversión real) |

### Ejemplos rápidos

```
# descargas (pega el enlace público)
.tiktok https://www.tiktok.com/@usuario/video/123
.pinterest https://www.pinterest.com/pin/123456789/
.pinterest https://pin.it/AbC1dEf
.ytmp3 https://youtu.be/VIDEO_ID

# inteligencia artificial
.gemini explica la fotosíntesis en tres líneas
.chatgpt escribe un saludo de cumpleaños corto
.deepseek si 3 camisetas cuestan 45, ¿cuánto cuestan 7?
.gemini resumí esto        ← respondiendo a un mensaje

# stickers de texto
.brat tomioka
.attp hola
.ttp hola

# respondiendo a una foto
.sticker

# respondiendo a un sticker
.take Olas del mar,Tomi 🌊
.toimg
.tovideo

# emojis
.emojimix 😺 🐼
.emojimix           ← aleatorio

# pack de stickers con fotos
.pack Gatitos,Tomi
(foto)              ← se agrega sola (convertida a sticker)
(foto)
(foto)
.pack done          ← envía el paquete de stickers a WhatsApp

# también sirve con el comando como pie de foto
(foto con pie: ".pack Gatitos,Tomi")     ← inicia el pack y agrega esa foto
(foto) (foto) (foto)
.pack done
```

### Cómo funciona `.pack`

1. `.pack nombre,autor` abre una sesión (10 minutos de inactividad).
2. Envía **varias fotos**, videos, GIFs o stickers: se agregan solos (máx. 30 por pack), las fotos y videos
   se convierten a sticker al vuelo y el bot va reaccionando con el número (1️⃣, 2️⃣, 3️⃣…).
   También puedes mandar el comando como **pie de foto**: esa imagen entra directo al pack.
   El avance se muestra **editando el mismo mensaje** (`✅ 3/30`), así el chat no se llena de mensajes:
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

## 🧠 Categoría AI (Gemini, ChatGPT y DeepSeek)

Tres comandos que consultan los modelos de **[OpenCode](https://opencode.ai)** y responden en el chat:

```
.gemini explica la fotosíntesis en tres líneas
.chatgpt escribe un saludo de cumpleaños corto
.deepseek si 3 camisetas cuestan 45 dólares, ¿cuánto cuestan 7?
```

También sirven **respondiendo a un mensaje**: el texto citado viaja como contexto.

```
(mensaje largo)
.gemini resumí esto          ← resume el mensaje citado
.deepseek                    ← sin argumento: usa solo la cita
```

El bot manda un "está pensando…" y después **edita ese mismo mensaje** con la respuesta (no duplica
mensajes). Al pie dice qué modelo contestó, así nunca queda la duda de quién respondió.

### Funciona sin configurar nada (y mejor con clave)

OpenCode sirve los modelos en protocolos distintos y tiene dos niveles:

| Situación | Qué pasa |
|-----------|----------|
| **Sin clave** | Se usa el **free tier** del gateway. DeepSeek responde con su modelo gratuito oficial (`deepseek-v4.1-flash-free`); Gemini y ChatGPT, al no tener versión gratuita, responden con el mejor modelo gratis disponible y la respuesta lo aclara como *modelo de respaldo*. |
| **Con `OPENCODE_API_KEY`** | Cada comando usa el modelo oficial de su marca: `gemini-3-flash`, `gpt-5.6-terra` y `deepseek-v4.1-flash`. |

```bash
export OPENCODE_API_KEY="sk-..."   # se consigue en https://opencode.ai/auth
npm start
```

> El free tier es anónimo y compartido (cuota por IP): puede saturarse. Para un bot con tráfico real,
> conviene poner la clave.

Para confirmar que la IA responde en tu equipo (y ver qué modelo contesta cada comando):

```bash
npm run ai:test
```

`npm test` y `npm run verify` **simulan** el gateway y no tocan la red; `ai:test` hace la llamada real.

### Detalles técnicos

`src/lib/ai.js` habla con el gateway sin dependencias nuevas (solo `fetch` de Node 20+):

- **Un protocolo por familia de modelos**: `chat/completions` (DeepSeek y los gratuitos), `responses`
  (GPT/Grok), `messages` (Claude) y el endpoint de Google con `systemInstruction` (Gemini).
  Se elige solo con el id del modelo, así no hay que configurar nada por comando.
- **Dos esquemas de URL, probados en orden**: la documentación oficial separa las rutas por familia
  (`/inference/openai/v1`, `/inference/anthropic/v1`, `/inference/google/v1beta`) mientras que el CLI
  usa una base unificada (`/inference/v1`). Se intenta la ruta documentada y, si devuelve 404/405/501,
  la unificada; la que funciona queda como preferida para no volver a pagar el intento.
- **La puerta del free tier**: los modelos gratis solo se atienden a tráfico que parezca del agente
  OpenCode. El cliente replica lo que el gateway exige: el par de cabeceras `x-opencode-session` /
  `x-opencode-session-id` con un id en el formato real (`ses_` + 12 hex con el timestamp + 14
  caracteres), el `User-Agent` `opencode/x.y.z`, `stream: true` y una herramienta llamada `read` en el
  manifiesto. La sesión se remite sola cada 30 minutos para que no envejezca.
- **Las llamadas a herramienta se descartan**: el gateway no honra `tool_choice: "none"` y puede
  responder con un `read`; el bot nunca ejecuta herramientas, así que esas respuestas se tiran y se
  prueba el modelo siguiente.
- **Respuesta en streaming (SSE)** con tolerancia a JSON puro, por si el servidor ignora el `stream`.
- **Reintentos y respaldo en cadena**: 429, 5xx, 410 (modelo retirado), `FreeTierError` y
  `MissingSessionID` reintentan y pasan al modelo siguiente; un 401/402 (clave inválida o sin créditos)
  corta al toque con un mensaje claro en vez de gastar pedidos.
- **Límites pensados para WhatsApp**: el prompt se recorta a `maxInputChars` (6000) y la respuesta a
  `maxChars` (3500), por debajo del techo de 4096 caracteres de WhatsApp.

Configurable en `ai` (`config.json`):

| Opción | Por defecto | Qué hace |
|--------|-------------|----------|
| `enabled` | `true` | Apaga toda la categoría AI |
| `apiKey` | `""` | Clave de OpenCode (mejor por `OPENCODE_API_KEY`) |
| `baseUrl` | `https://opencode.ai/inference/v1` | Base unificada del gateway (la que usa el CLI) |
| `openaiBaseUrl` | `https://opencode.ai/inference/openai/v1` | Ruta por familia para DeepSeek/GPT y los gratuitos |
| `anthropicBaseUrl` | `https://opencode.ai/inference/anthropic/v1` | Ruta por familia para Claude |
| `googleBaseUrl` | `https://opencode.ai/inference/google/v1beta` | Gateway de Gemini |
| `models.gemini` / `.chatgpt` / `.deepseek` | `gemini-3-flash`, `gpt-5.6-terra`, `deepseek-v4.1-flash` | Modelos de cada comando, en orden de preferencia |
| `freeModels` | `deepseek-v4.1-flash-free`, … | Red de seguridad gratuita, en orden |
| `freeTierFallback` | `true` | Con `false` solo se prueban los modelos de la marca |
| `timeoutMs` / `maxTokens` / `temperature` | `90000` / `1024` / `0.7` | Ajustes del pedido |
| `maxInputChars` / `maxChars` | `6000` / `3500` | Recorte del prompt y de la respuesta |

Los modelos que ofrece OpenCode cambian seguido; se pueden listar en vivo con:

```bash
curl -s https://opencode.ai/inference/v1/models
```

Y se ponen en `ai.models` o `ai.freeModels` sin tocar el código.

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
  "ai": {                            // 🧠 Gemini, ChatGPT y DeepSeek vía OpenCode
    "enabled": true,
    "apiKey": "",                    // mejor por OPENCODE_API_KEY; vacío = free tier
    "baseUrl": "https://opencode.ai/inference/v1",
    "googleBaseUrl": "https://opencode.ai/inference/google/v1beta",
    "models": {
      "gemini": ["gemini-3-flash"],
      "chatgpt": ["gpt-5.6-terra"],
      "deepseek": ["deepseek-v4.1-flash", "deepseek-v4.1-flash-free"]
    },
    "freeModels": ["deepseek-v4.1-flash-free", "glm-5.3-flash-free", "big-pickle"],
    "freeTierFallback": true,        // si la marca falla, prueba los gratuitos
    "maxChars": 3500                 // la respuesta entra en un mensaje de WhatsApp
  },
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
    "categories": [             // el menú lista TODOS los comandos visibles, en 6 categorías
      {
        "emoji": "🌊",
        "title": "𝔻𝕖𝕤𝕔𝕒𝕣𝕘𝕒𝕤",      // nombre que sale en el encabezado del menú
        "description": "𝖣𝖾𝗌𝖼𝖺𝗋𝗀𝖺𝗌", // nombre de respaldo si no hay title
        "kaomoji": "( ˶ˆ꒳ˆ˵ )",
        "divider": ["💧", "💦"],
        "commands": ["tiktok", "instagram", "pinterest", "ytmp3", "ytmp4"]
      },
      {
        "emoji": "💧",
        "title": "𝕊𝕥𝕚𝕔𝕜𝕖𝕣𝕤",
        "description": "𝖲𝗍𝗂𝖼𝗄𝖾𝗋𝗌",
        "kaomoji": "( ᵕ ᵗ ᵕ )",
        "divider": ["🐟", "💙"],
        "commands": ["brat", "attp", "ttp", "sticker", "gif", "emojimix"]
      }
    ]
  }
}
```

**Encabezado de cada categoría.** El menú ya no numera las categorías como
`Categoría01`, `Categoría02`… Ahora muestra el nombre real de cada una:

```
ㅤㅤ◢ 𝟎𝟏 ◣
🌊ㅤ׃ㅤ 𝔻𝕖𝕤𝕔𝕒𝕣𝕘𝕒𝕤 ㅤ׃
ㅤㅤㅤ( ˶ˆ꒳ˆ˵ )
୨ৎㅤ.tiktok
```

El texto del encabezado sale de `title` y, si no existe, de `description`
(así las categorías que crea el panel web siguen funcionando sin tocar nada).
El `◢ 𝟎𝟏 ◣` es solo el adorno del índice: podés cambiar el nombre de una
categoría editando `menu.categories` en `config.json` sin tocar el código.

### Variables de entorno (opcionales)

| Variable | Ejemplo | Para qué |
|----------|---------|----------|
| `BOT_PREFIX` | `!` | Cambia el prefijo sin tocar el JSON |
| `LOGIN` | `pairing` / `qr` | Método de vinculación |
| `PAIRING_PHONE` | `59891234567` | Número para pairing |
| `SESSION_DIR` | `./sessions2` | Carpeta de credenciales |
| `OWNER_NUMBERS` | `5989...,5989...` | Dueños separados por coma |
| `FFMPEG_PATH` | `/data/.../ffmpeg` | Usar un FFmpeg específico |
| `YTDLP_PATH` | `/data/.../yt-dlp` | Usar un yt-dlp específico (descargadores) |
| `LOG_LEVEL` | `debug` | Nivel de logs |
| `MENU_IMAGE` | `https://.../menu.jpg` | Banner del menú (URL, Drive o ruta local) |
| `OPENCODE_API_KEY` | `sk-...` | Clave de OpenCode para que la IA use los modelos oficiales (sin clave va al free tier) |
| `AI_ENABLED` | `0` | Apaga la categoría AI sin tocar el JSON |

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
│   │   ├── downloaders.js   # TikTok/Instagram/Pinterest/YouTube con yt-dlp
│   │   ├── ai.js            # cliente de IA (OpenCode: Gemini, ChatGPT, DeepSeek)
│   │   ├── text-sticker.js  # stickers de texto Brat / ATTP / TTP
│   │   ├── media.js         # imagen/GIF/video ↔ sticker
│   │   ├── sticker.js       # EXIF (nombre/autor), demux WebP
│   │   ├── webp.js          # edición de chunks WebP sin re-mux (alfa intacto)
│   │   ├── session.js       # detecta/valida/respalda la sesión guardada
│   │   ├── link-session.js  # pairing code real de Baileys para el panel web
│   │   ├── live-messages.js # edita el menú/progreso en vez de repetir mensajes
│   │   ├── sticker-pack.js  # envía el paquete nativo de stickers a WhatsApp
│   │   ├── banner.js        # banner del menú (Drive/URL/local) con caché
│   │   ├── tmp.js           # carpetas temporales con respaldo para Termux
│   │   ├── emojimix.js      # catálogo Emoji Kitchen con caché
│   │   ├── zip.js           # generador ZIP sin dependencias
│   │   ├── sessions.js      # sesiones de packs con expiración
│   │   ├── message.js       # extracción de media y citas
│   │   └── context.js       # helpers que usan los comandos
├── web/                     # SPA/PWA (index.html, styles.css, app.js, sw.js, manifest.webmanifest, icon.svg, fonts/)
├── scripts/
│   ├── setup-termux.sh      # instalación automática en Termux
│   ├── start.sh             # arranque con wake-lock
│   ├── selftest.js          # diagnóstico del pipeline de stickers
│   ├── serve-web.js         # sirve la plataforma web (npm run web)
│   └── verify-commands.js   # prueba end-to-end de todos los comandos
├── tests/                   # node --test (287 pruebas)
├── sessions/                # credenciales (ignorada)
└── data/                    # caché emojimix, temporales y menús guardados (ignorada)
```

---

## 🧪 Tests y diagnóstico

```bash
npm test           # 287 pruebas (menú, endpoints, IA, banner, ZIP, stickers, WebP, sesión, packs, pipeline, handler, terminal)
npm run verify     # ejecuta TODOS los comandos simulando mensajes de WhatsApp (42 verificaciones)
npm run ai:test    # llamada REAL a las tres IA: qué modelo responde, con qué protocolo y en cuánto tiempo
npm run selftest   # conversiones reales con FFmpeg y explicación de cada falla
npm run doctor     # FFmpeg, yt-dlp, carpetas, banner, espacio, sesión, IA + prueba real
```

`npm test` y `npm run verify` simulan el gateway de IA (no tocan la red). Para confirmar que la IA
funciona en **tu** equipo usa `npm run ai:test`, que hace la llamada de verdad y muestra por cada
comando el modelo configurado, el protocolo, el endpoint, quién contestó realmente y si fue un
respaldo. Acepta una pregunta propia:

```bash
npm run ai:test                          # pregunta por defecto a las tres
npm run ai:test -- "hola, ¿qué modelo eres?"
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
✔ .take Olas,Tomi (metadatos)                 OK react×2 sticker×1
✔ .emojimix 😀 🔥 (catálogo en caché)         OK react×2 sticker×1
✔ .gemini (consulta a Gemini)                 OK react×2 text×2
✔ .pack done (genera .wasticker)              OK react×2 document×1
✔ .wasticker válido (3 stickers + vista previa)   contents.json + 3 webp
✔ 42/42 verificaciones OK
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
| `.take` con una foto dice "Bad header" | Versión anterior: ahora acepta fotos y videos y los convierte antes |
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
