import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandContext } from '../src/lib/context.js'
import { createStore } from '../src/handler.js'
import { commands, findCommand } from '../src/commands/index.js'
import {
  buildYtDlpArgs,
  extractFirstUrl,
  validateDownloadUrl
} from '../src/lib/downloaders.js'
import {
  buildTextFrameArgs,
  normalizeStickerText,
  textStickerFontSize,
  wrapStickerText
} from '../src/lib/text-sticker.js'
import { readSticker } from '../src/lib/sticker.js'
import { fakeSock, ffmpegAvailable, silentLogger, testConfig, textMessage } from './helpers.js'

function makeContext(commandText) {
  const config = testConfig()
  const sock = fakeSock()
  const ctx = new CommandContext({
    sock,
    msg: textMessage(commandText),
    config,
    logger: silentLogger,
    store: createStore(config, silentLogger),
    text: commandText
  })
  ctx.commands = commands
  return { ctx, sock }
}

const sentOf = (sock, kind) => sock.sent.filter((item) => item.content?.[kind])

test('los ocho endpoints están registrados con sus alias', () => {
  for (const name of ['tiktok', 'instagram', 'ytmp3', 'ytmp4', 'brat', 'attp', 'ttp', 'sticker']) {
    assert.ok(findCommand(name), `falta el endpoint ${name}`)
    assert.equal(typeof findCommand(name).run, 'function')
  }
  assert.equal(findCommand('ig'), findCommand('instagram'))
  assert.equal(findCommand('ttdl'), findCommand('tiktok'))
  assert.equal(findCommand('youtube-mp3'), findCommand('ytmp3'))
  assert.equal(findCommand('youtube-mp4'), findCommand('ytmp4'))
})

test('extractFirstUrl encuentra la URL y limpia la puntuación final', () => {
  assert.equal(extractFirstUrl('mira https://youtu.be/abc123, porfa'), 'https://youtu.be/abc123')
  assert.equal(extractFirstUrl('sin enlace'), '')
})

test('validateDownloadUrl acepta solo enlaces HTTPS de la plataforma', () => {
  assert.equal(
    validateDownloadUrl('tiktok', 'https://www.tiktok.com/@u/video/1'),
    'https://www.tiktok.com/@u/video/1'
  )
  assert.equal(validateDownloadUrl('instagram', 'https://www.instagram.com/reel/ABC/').includes('instagram.com'), true)
  assert.equal(validateDownloadUrl('youtube', 'https://youtu.be/VIDEO_ID'), 'https://youtu.be/VIDEO_ID')
  assert.throws(() => validateDownloadUrl('tiktok', 'sin enlace', 'Uso: pega un enlace'), /Uso: pega un enlace/)
  assert.throws(() => validateDownloadUrl('tiktok', 'https://youtu.be/abc'), /no parece ser de TikTok/)
  assert.throws(() => validateDownloadUrl('youtube', 'http://youtu.be/abc'), /solo acepto enlaces HTTPS/)
  assert.throws(() => validateDownloadUrl('instagram', 'https://tiktok.com/@u/video/1'), /no parece ser de Instagram/)
})

test('buildYtDlpArgs arma descarga de video MP4 y extracción MP3 sin shell', () => {
  const video = buildYtDlpArgs({
    platform: 'youtube',
    mediaType: 'video',
    url: 'https://youtu.be/VIDEO_ID',
    outputTemplate: '/tmp/download.%(ext)s'
  })
  assert.ok(video.includes('--no-playlist'))
  assert.ok(video.includes('--merge-output-format'))
  assert.equal(video.at(-1), 'https://youtu.be/VIDEO_ID', 'la URL viaja como argumento separado')

  const audio = buildYtDlpArgs({
    platform: 'youtube',
    mediaType: 'audio',
    url: 'https://youtu.be/VIDEO_ID',
    outputTemplate: '/tmp/download.%(ext)s'
  })
  assert.ok(audio.includes('-x'))
  assert.ok(audio.includes('mp3'))
})

test('los descargadores rechazan comandos sin enlace o de otra plataforma', async () => {
  await assert.rejects(() => findCommand('tiktok').run(makeContext('.tiktok').ctx), /Uso:/)
  await assert.rejects(
    () => findCommand('instagram').run(makeContext('.instagram https://youtu.be/abc').ctx),
    /no parece ser de Instagram/
  )
  await assert.rejects(
    () => findCommand('ytmp4').run(makeContext('.ytmp4 https://www.tiktok.com/@u/video/1').ctx),
    /no parece ser de YouTube/
  )
})

test('normalizeStickerText limpia, limita y Brat pasa a minúsculas', () => {
  assert.equal(normalizeStickerText('  Hola   MUNDO ', 'brat'), 'hola mundo')
  assert.equal(normalizeStickerText('  Hola   MUNDO ', 'ttp'), 'Hola MUNDO')
  assert.equal(normalizeStickerText('x'.repeat(200), 'ttp').length, 90)
})

test('wrapStickerText parte en líneas cortas y el tamaño queda en rango', () => {
  const lines = wrapStickerText('hola mundo esto es tomioka')
  assert.ok(lines.length > 1)
  assert.ok(lines.every((line) => line.length <= 12))
  const size = textStickerFontSize(lines)
  assert.ok(size >= 30 && size <= 72)
})

test('buildTextFrameArgs refleja cada modo (brat / ttp / error)', () => {
  const brat = buildTextFrameArgs({ mode: 'brat', textFile: '/tmp/t.txt', output: '/tmp/f.png' }).join(' ')
  assert.ok(brat.includes('0x8ace00'), 'brat usa fondo verde lima')
  assert.ok(brat.includes('borderw=0'), 'brat no lleva borde')

  const ttp = buildTextFrameArgs({ mode: 'ttp', textFile: '/tmp/t.txt', output: '/tmp/f.png' }).join(' ')
  assert.ok(ttp.includes('borderw=5'), 'ttp lleva borde')

  assert.throws(() => buildTextFrameArgs({ mode: 'xyz', textFile: '/tmp/t.txt', output: '/tmp/f.png' }), /no soportado/)
})

test('.brat sin texto pide el uso correcto', async () => {
  await assert.rejects(() => findCommand('brat').run(makeContext('.brat').ctx), /Uso:/)
})

test('.brat crea un sticker de texto', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.brat tomioka')
  await findCommand('brat').run(ctx)
  const stickers = sentOf(sock, 'sticker')
  assert.equal(stickers.length, 1)
  const info = await readSticker(stickers[0].content.sticker)
  assert.equal(info.width, 512)
  assert.equal(info.animated, false)
})

test('.ttp crea un sticker de texto con borde', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.ttp hola')
  await findCommand('ttp').run(ctx)
  assert.equal(sentOf(sock, 'sticker').length, 1)
})

test('.attp crea un sticker animado de colores', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.attp hola')
  await findCommand('attp').run(ctx)
  const stickers = sentOf(sock, 'sticker')
  assert.equal(stickers.length, 1)
  const info = await readSticker(stickers[0].content.sticker)
  assert.equal(info.animated, true)
})
