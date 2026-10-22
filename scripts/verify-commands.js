#!/usr/bin/env node
/**
 * Verificación end-to-end de los comandos del bot.
 *
 * Simula mensajes de WhatsApp (con un socket falso) y ejecuta cada comando a
 * través del handler real. La descarga de media se sustituye por fixtures
 * locales, así no hace falta cuenta de WhatsApp.
 *
 * Uso: npm run verify
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../src/config.js'
import { commands } from '../src/commands/index.js'
import { createStore, handleMessage } from '../src/handler.js'
import { CommandContext } from '../src/lib/context.js'
import { resolveFfmpeg } from '../src/lib/ffmpeg.js'
import { resetIndexCache } from '../src/lib/emojimix.js'
import { c, sym } from '../src/lib/colors.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, '..', 'tests', 'fixtures')
const read = (name) => readFileSync(path.join(fixtures, name))

const png = read('sample.png')
const gif = read('sample.gif')
const mp4 = read('sample.mp4')
const webpStatic = read('sticker-static.webp')
const webpAnimated = read('sticker-anim.webp')

const MEDIA = {
  image: { buffer: png, message: { imageMessage: { mimetype: 'image/png', fileLength: png.length } } },
  video: { buffer: mp4, message: { videoMessage: { mimetype: 'video/mp4', fileLength: mp4.length } } },
  gif: {
    buffer: gif,
    message: { videoMessage: { mimetype: 'image/gif', fileLength: gif.length } }
  },
  sticker: {
    buffer: webpStatic,
    message: { stickerMessage: { mimetype: 'image/webp', fileLength: webpStatic.length } }
  },
  stickerAnimado: {
    buffer: webpAnimated,
    message: { stickerMessage: { mimetype: 'image/webp', fileLength: webpAnimated.length } }
  }
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'tomioka-verify-'))
const results = []

/** Socket falso que imita la API de Baileys y guarda lo enviado */
function fakeSock() {
  const sent = []
  const relayed = []
  const sock = {
    sent,
    relayed,
    // El envío "nativo" del pack se activa solo en su bloque de verificación.
    enableNative() {
      sock.waUploadToServer = async () => ({
        directPath: '/v/tomioka-verify',
        mediaUrl: 'https://mmg.whatsapp.net/v/tomioka-verify'
      })
      sock.relayMessage = async (jid, message, options) => {
        relayed.push({ jid, message, options })
        return `native-${relayed.length}`
      }
    },
    disableNative() {
      delete sock.waUploadToServer
      delete sock.relayMessage
    },
    user: { id: '59890000000:1@s.whatsapp.net', name: 'TomiOka' },
    async sendMessage(jid, content) {
      sent.push({ jid, ...content })
      return { key: { id: `msg-${sent.length}`, remoteJid: jid } }
    },
    async sendPresenceUpdate() {},
    async updateMediaMessage() {
      throw new Error('reupload no soportado en la verificación')
    }
  }
  return sock
}

const kindsSent = (sent) => {
  const counts = {}
  for (const item of sent) {
    const key = Object.keys(item).find((k) =>
      ['text', 'image', 'video', 'sticker', 'document', 'react'].includes(k)
    )
    if (key) counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function buildConfig() {
  const config = loadConfig()
  config.behavior = {
    ...config.behavior,
    cooldownMs: 0,
    reactToCommands: true,
    sendTyping: true
  }
  config.menu = {
    ...config.menu,
    image: path.join(fixtures, 'sample.png'), // banner local (sin red)
    sendAsCaption: true
  }
  config.emojimix = {
    ...config.emojimix,
    cacheFile: path.join(tmp, 'emojimix-index.json'),
    metadataUrl: 'http://127.0.0.1:1/no-usado.json'
  }
  config.paths = { ...config.paths, data: path.join(tmp, 'data'), tmp: path.join(tmp, 'files') }
  mkdirSync(config.paths.data, { recursive: true })

  writeFileSync(
    config.emojimix.cacheFile,
    JSON.stringify({
      version: 2,
      total: 2,
      source: 'verificación',
      createdAt: new Date().toISOString(),
      combos: {
        '1f600_1f525': {
          url: 'https://www.gstatic.com/android/keyboards/emojikitchen/20201001/u1f600/u1f600_u1f525.png',
          date: '20201001'
        },
        '1f43c_1f43c': {
          url: 'https://www.gstatic.com/android/keyboards/emojikitchen/20201001/u1f43c/u1f43c_u1f43c.png',
          date: '20201001'
        }
      }
    })
  )
  return config
}

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger }

/** Mensaje de texto del usuario, opcionalmente citando un media */
function textMessage(text, quoted = null) {
  return {
    key: { remoteJid: '59891111111@s.whatsapp.net', fromMe: false, id: `msg-${Math.random()}` },
    pushName: 'Verificador',
    message: quoted
      ? {
          extendedTextMessage: {
            text,
            contextInfo: {
              stanzaId: 'quoted-id',
              participant: '59892222222@s.whatsapp.net',
              quotedMessage: quoted
            }
          }
        }
      : { conversation: text }
  }
}

/** Mensaje con media propio (foto, video, sticker) */
function mediaMessage(media) {
  return {
    key: { remoteJid: '59891111111@s.whatsapp.net', fromMe: false, id: `msg-${Math.random()}` },
    pushName: 'Verificador',
    message: media.message
  }
}

/** Lee las entradas de un ZIP sin compresión (el que genera el bot) */
function readZipEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength)
    const start = offset + 30 + nameLength + extraLength
    entries.set(name, buffer.subarray(start, start + size))
    offset = start + size
  }
  return entries
}

function record(name, ok, detail, sent) {
  const preview =
    sent.find((item) => typeof item.text === 'string')?.text ||
    sent.find((item) => typeof item.caption === 'string' && item.caption)?.caption ||
    ''
  results.push({
    name,
    ok,
    detail,
    kinds: kindsSent(sent),
    preview: preview.replace(/\s+/g, ' ').slice(0, 90)
  })
}

/** Ejecuta un paso y evalúa el resultado */
async function step({ name, config, store, sock, msg, expect, allowError = false, allowEmpty = false }) {
  const before = sock.sent.length
  await handleMessage({ sock, msg, config, logger: noopLogger, store, commands })
  const sent = sock.sent.slice(before)
  const texts = sent.flatMap((item) =>
    [item.text, item.caption].filter((value) => typeof value === 'string' && value.length > 0)
  )

  if (allowError) {
    const errorText = texts.find((text) => text.includes('❌'))
    record(
      name,
      Boolean(errorText) && (!expect || expect.test(errorText)),
      errorText ? errorText.split('\n').slice(1).join(' ').slice(0, 70) : 'no devolvió error',
      sent
    )
    return { sent, texts }
  }

  const ok = expect
    ? texts.some((text) => expect.test(text))
    : sent.length > 0 || allowEmpty
  record(name, ok, ok ? 'OK' : 'sin respuesta esperada', sent)
  return { sent, texts }
}

async function main() {
  const ffmpeg = await resolveFfmpeg()
  const config = buildConfig()
  const store = createStore(config, noopLogger)
  const sock = fakeSock()

  console.log('')
  console.log(c.bold(`${sym.wave} Verificación de comandos · TomiOka Bot`))
  console.log(c.gray(`   FFmpeg: ${ffmpeg ? `${ffmpeg.path} (webp: ${ffmpeg.webp})` : 'NO DISPONIBLE'}`))
  console.log('')

  // Descarga de media simulada (sin red ni WhatsApp)
  const originalDownload = CommandContext.prototype.download
  CommandContext.prototype.download = async function download(target) {
    const resolved = target || this.mediaTarget
    const media = MEDIA[resolved?.kind]
    if (!media) throw new Error(`fixture no disponible para ${resolved?.kind}`)
    return media.buffer
  }

  // Descargas simuladas: emojimix devuelve el PNG de prueba y las IA devuelven
  // una respuesta SSE como la del gateway de OpenCode (sin tocar la red).
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('opencode.ai')) {
      const chunk = JSON.stringify({ choices: [{ delta: { content: 'Respuesta simulada de la IA.' } }] })
      return new Response(`data: ${chunk}\n\ndata: [DONE]`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }
    return new Response(png)
  }

  try {
    // ---------- ayuda / menú ----------
    const helpStep = await step({
      name: '.help (menú cargado junto con el banner)',
      config,
      store,
      sock,
      msg: textMessage('.help'),
      expect: /𝓜𝓮𝓷𝓾 𝓭𝓮 𝓬𝓸𝓶𝓪𝓷𝓭𝓸𝓼[\s\S]*\.debug[\s\S]*𝕰𝐍𝐃 𝐎𝐅 𝐌𝐄𝐍𝐔/
    })
    const helpImages = helpStep.sent.filter((item) => item.image)
    const helpTexts = helpStep.sent.filter((item) => typeof item.text === 'string')
    record(
      'menú + banner en un solo mensaje (sin texto aparte)',
      helpImages.length === 1 && helpTexts.length === 0 && Boolean(helpImages[0]?.caption),
      helpImages.length === 1 && helpTexts.length === 0 ? 'OK' : `image=${helpImages.length} text=${helpTexts.length}`,
      helpStep.sent
    )
    await step({
      name: '.help take (ayuda puntual)',
      config,
      store,
      sock,
      msg: textMessage('.help take'),
      expect: /\.take nombre,autor/
    })
    await step({
      name: '.menu (alias)',
      config,
      store,
      sock,
      msg: textMessage('.menu'),
      expect: /𝕰𝐍𝐃 𝐎𝐅 𝐌𝐄𝐍𝐔/
    })
    await step({
      name: '.comandoinexistente (aviso)',
      config,
      store,
      sock,
      msg: textMessage('.comandoinexistente'),
      expect: /No conozco/
    })

    // ---------- stickers ----------
    await step({
      name: '.sticker (foto)',
      config,
      store,
      sock,
      msg: textMessage('.sticker', MEDIA.image.message),
      expect: /Sticker creado/
    })
    await step({
      name: '.sticker (sticker reenviado)',
      config,
      store,
      sock,
      msg: textMessage('.sticker', MEDIA.sticker.message)
    })
    await step({
      name: '.gif (GIF animado)',
      config,
      store,
      sock,
      msg: textMessage('.gif', MEDIA.gif.message),
      expect: /Sticker animado/
    })
    await step({
      name: '.gif (video)',
      config,
      store,
      sock,
      msg: textMessage('.gif', MEDIA.video.message),
      expect: /Sticker animado/
    })
    // ---------- conversión ----------
    await step({
      name: '.toimg (sticker → PNG)',
      config,
      store,
      sock,
      msg: textMessage('.toimg', MEDIA.stickerAnimado.message),
      expect: /Sticker convertido|Imagen generada/
    })
    await step({
      name: '.tovideo (sticker → MP4)',
      config,
      store,
      sock,
      msg: textMessage('.tovideo', MEDIA.stickerAnimado.message),
      expect: /video/
    })
    await step({
      name: '.take Olas,Tomi (metadatos)',
      config,
      store,
      sock,
      msg: textMessage('.take Olas,Tomi', MEDIA.sticker.message),
      expect: /Sticker actualizado/
    })
    await step({
      name: '.take sobre una foto (convierte y renombra)',
      config,
      store,
      sock,
      msg: textMessage('.take Foto,Tomi', MEDIA.image.message),
      expect: /Convertido a sticker/
    })
    // ---------- emojimix ----------
    await step({
      name: '.emojimix 😀 🔥 (catálogo en caché)',
      config,
      store,
      sock,
      msg: textMessage('.emojimix 😀 🔥')
    })
    await step({
      name: '.emojimix sin argumentos (aleatorio)',
      config,
      store,
      sock,
      msg: textMessage('.emojimix')
    })
    await step({
      name: '.emojimix 🐟 🐟 (combinación inexistente)',
      config,
      store,
      sock,
      msg: textMessage('.emojimix 🐟 🐟'),
      expect: /No encontré combinación/,
      allowError: true
    })
    await step({
      name: '.emojimix 😀 (un solo emoji)',
      config,
      store,
      sock,
      msg: textMessage('.emojimix 😀'),
      expect: /dos\* emojis/,
      allowError: true
    })

    // ---------- pack ----------
    await step({
      name: '.pack Olas del mar,Tomi (inicia)',
      config,
      store,
      sock,
      msg: textMessage('.pack Olas del mar,Tomi'),
      expect: /Nuevo pack iniciado/
    })
    await step({
      name: 'foto 1 → pack',
      config,
      store,
      sock,
      msg: mediaMessage(MEDIA.image)
    })
    await step({
      name: 'foto 2 → pack',
      config,
      store,
      sock,
      msg: mediaMessage(MEDIA.image)
    })
    await step({
      name: 'sticker → pack',
      config,
      store,
      sock,
      msg: mediaMessage(MEDIA.sticker)
    })
    await step({
      name: '.pack status',
      config,
      store,
      sock,
      msg: textMessage('.pack status'),
      expect: /Pack en curso/
    })
    const packDone = await step({
      name: '.pack done (genera .wasticker)',
      config,
      store,
      sock,
      msg: textMessage('.pack done'),
      expect: /Pack listo/
    })

    // Valida el .wasticker generado con las 3 fotos/stickers
    const doc = packDone.sent.find((item) => item.document)
    if (doc) {
      const entries = readZipEntries(doc.document)
      const contents = JSON.parse(entries.get('contents.json').toString('utf8'))
      const pack = contents.sticker_packs[0]
      const stickersOk = pack.stickers.every((sticker) => entries.has(sticker.image_file))
      const webps = [...entries.keys()].filter((name) => name.endsWith('.webp'))
      // Sin FFmpeg las fotos no se pueden convertir: solo entra el sticker de prueba.
      const minimum = ffmpeg ? 2 : 1
      const valid =
        pack.stickers.length >= minimum &&
        stickersOk &&
        // La vista previa se declara en contents.json: si está, tiene que existir.
        (!pack.tray_image_file || entries.has(pack.tray_image_file))
      record(
        `.wasticker válido (${pack.stickers.length} stickers${entries.has(pack.tray_image_file) ? ' + vista previa' : ''})`,
        valid,
        valid
          ? `contents.json + ${webps.length} webp${ffmpeg ? '' : ' (sin FFmpeg: solo el sticker de prueba)'}`
          : 'estructura incompleta',
        []
      )
    } else {
      record('.wasticker válido', false, 'no se envió el documento', [])
    }
    // ---------- pack nativo (mensaje de WhatsApp, no archivo) ----------
    sock.enableNative()
    await step({
      name: '.pack nativo (inicia)',
      config,
      store,
      sock,
      msg: textMessage('.pack Nativos,Tomi'),
      expect: /Nuevo pack iniciado/
    })
    await step({
      name: 'sticker → pack nativo',
      config,
      store,
      sock,
      msg: mediaMessage(MEDIA.sticker),
      allowEmpty: true
    })
    await step({
      name: 'sticker 2 → pack nativo',
      config,
      store,
      sock,
      msg: mediaMessage(MEDIA.sticker),
      allowEmpty: true
    })
    const nativeBefore = sock.relayed.length
    const nativeDone = await step({
      name: '.pack done (pack nativo)',
      config,
      store,
      sock,
      msg: textMessage('.pack done'),
      allowEmpty: true
    })
    const nativeRelay = sock.relayed.slice(nativeBefore).at(-1)
    const stickerPack = nativeRelay?.message?.stickerPackMessage
    const nativeOk =
      Boolean(stickerPack) &&
      Number(stickerPack.stickers?.length) >= 2 &&
      !nativeDone.sent.some((item) => item.document)
    record(
      'pack nativo (stickerPackMessage, sin archivo)',
      nativeOk,
      nativeOk ? `${Number(stickerPack.stickers.length)} stickers + paquete subido` : 'no se envió el pack nativo',
      nativeDone.sent
    )
    sock.disableNative()

    await step({
      name: '.pack done sin sesión (error claro)',
      config,
      store,
      sock,
      msg: textMessage('.pack done'),
      expect: /No hay ningún pack en curso/,
      allowError: true
    })
    await step({
      name: '.pack Test (nuevo) + cancel',
      config,
      store,
      sock,
      msg: textMessage('.pack Test'),
      expect: /Nuevo pack iniciado/
    })
    await step({
      name: '.pack cancel',
      config,
      store,
      sock,
      msg: textMessage('.pack cancel'),
      expect: /cancelado/
    })

    // ---------- IA (respuesta simulada, sin red) ----------
    await step({
      name: '.gemini (consulta a Gemini)',
      config,
      store,
      sock,
      msg: textMessage('.gemini explica el agua en una línea'),
      expect: /Gemini/
    })
    await step({
      name: '.chatgpt (consulta a ChatGPT)',
      config,
      store,
      sock,
      msg: textMessage('.chatgpt escribe un saludo corto'),
      expect: /ChatGPT/
    })
    await step({
      name: '.deepseek (consulta a DeepSeek)',
      config,
      store,
      sock,
      msg: textMessage('.deepseek cuánto es 2+2'),
      expect: /DeepSeek/
    })
    await step({
      name: '.gemini citando un mensaje (usa la cita como contexto)',
      config,
      store,
      sock,
      msg: textMessage('.gemini resumí esto', { conversation: 'un texto largo para resumir' }),
      expect: /Gemini/
    })

    // ---------- errores esperados ----------
    await step({
      name: '.gemini sin pregunta (error claro)',
      config,
      store,
      sock,
      msg: textMessage('.gemini'),
      expect: /Escribe tu pregunta/,
      allowError: true
    })
    await step({
      name: '.pinterest sin enlace (aviso de uso)',
      config,
      store,
      sock,
      msg: textMessage('.pinterest'),
      expect: /Uso:/,
      allowError: true
    })
    await step({
      name: '.pinterest con enlace de otra plataforma',
      config,
      store,
      sock,
      msg: textMessage('.pinterest https://youtu.be/abc'),
      expect: /no parece ser de Pinterest/,
      allowError: true
    })
    await step({
      name: '.toimg sin sticker (mensaje de ayuda)',
      config,
      store,
      sock,
      msg: textMessage('.toimg'),
      expect: /Responde a un \*sticker\*/,
      allowError: true
    })
    await step({
      name: '.sticker sin media (mensaje de ayuda)',
      config,
      store,
      sock,
      msg: textMessage('.sticker'),
      expect: /Responde a una \*imagen\*/,
      allowError: true
    })
    // ---------- diagnóstico ----------
    await step({
      name: '.debug (diagnóstico del entorno)',
      config,
      store,
      sock,
      msg: textMessage('.debug'),
      expect: /Diagnóstico de TomiOka/
    })

    // Mensaje normal: no debe responder nada
    const before = sock.sent.length
    await handleMessage({
      sock,
      msg: textMessage('hola bot'),
      config,
      logger: noopLogger,
      store,
      commands
    })
    const silencio = sock.sent.length - before
    record('mensaje normal (no responde)', silencio === 0, silencio === 0 ? 'OK' : `${silencio} respuestas`, [])
  } finally {
    CommandContext.prototype.download = originalDownload
    globalThis.fetch = originalFetch
    store.packs.destroy()
    resetIndexCache()
    rmSync(tmp, { recursive: true, force: true })
  }

  // ---------- informe ----------
  const width = Math.max(...results.map((item) => item.name.length)) + 2
  let failures = 0
  for (const item of results) {
    const kinds = Object.entries(item.kinds)
      .map(([kind, count]) => `${kind}×${count}`)
      .join(' ')
    if (!item.ok) failures += 1
    const icon = item.ok ? c.green('✔') : c.red('✖')
    console.log(
      `${icon} ${item.name.padEnd(width)} ${c.gray(item.detail)} ${c.cyan(kinds)}`.trimEnd()
    )
    if (item.preview && !item.name.startsWith('mensaje')) {
      console.log(`${' '.repeat(width + 2)}${c.gray(`↳ ${item.preview}`)}`)
    }
  }

  console.log('')
  const total = results.length
  if (failures === 0) {
    console.log(c.green(`${sym.ok} ${total}/${total} verificaciones OK`))
  } else {
    console.log(c.red(`${sym.err} ${failures}/${total} verificaciones fallaron`))
    process.exitCode = 1
  }
  console.log('')
}

main().catch((error) => {
  console.error(c.red(`${sym.err} La verificación se cayó: ${error.stack || error.message}`))
  process.exitCode = 1
})
