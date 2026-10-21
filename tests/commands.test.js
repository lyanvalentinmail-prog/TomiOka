import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { CommandContext } from '../src/lib/context.js'
import { createStore } from '../src/handler.js'
import { commands, findCommand } from '../src/commands/index.js'
import { readSticker } from '../src/lib/sticker.js'
import { resetIndexCache } from '../src/lib/emojimix.js'
import { fakeSock, ffmpegAvailable, silentLogger, testConfig } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const png = await readFile(path.join(here, 'fixtures/sample.png'))
const gif = await readFile(path.join(here, 'fixtures/sample.gif'))
const mp4 = await readFile(path.join(here, 'fixtures/sample.mp4'))
const staticSticker = await readFile(path.join(here, 'fixtures/sticker-static.webp'))
const animatedSticker = await readFile(path.join(here, 'fixtures/sticker-anim.webp'))

function quotedMessageFor(kind, mimetype = 'image/webp') {
  const key = `${kind}Message`
  return { [key]: { mimetype, fileLength: 1000 } }
}

function makeContext(commandText, { quotedKind = null, mimetype, buffer = null, config = testConfig() } = {}) {
  const sock = fakeSock()
  const store = createStore(config, silentLogger)
  const quoted = quotedKind ? quotedMessageFor(quotedKind, mimetype) : undefined
  const msg = {
    key: { remoteJid: '59891111111@s.whatsapp.net', fromMe: false, id: 'cmd-1' },
    pushName: 'Tester',
    message: {
      extendedTextMessage: {
        text: commandText,
        ...(quoted
          ? {
              contextInfo: {
                stanzaId: 'quoted-1',
                participant: '59892222222@s.whatsapp.net',
                quotedMessage: quoted
              }
            }
          : {})
      }
    }
  }
  const ctx = new CommandContext({ sock, msg, config, logger: silentLogger, store, text: commandText })
  ctx.commands = commands
  if (buffer) ctx.download = async () => buffer
  return { ctx, sock }
}

const sentOf = (sock, kind) => sock.sent.filter((item) => item.content?.[kind])

test('.toimg convierte el sticker citado en imagen', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.toimg', {
    quotedKind: 'sticker',
    mimetype: 'image/webp',
    buffer: staticSticker
  })
  await findCommand('toimg').run(ctx)
  assert.equal(sentOf(sock, 'image').length, 1)
  assert.equal(sentOf(sock, 'image')[0].content.image.subarray(1, 4).toString('ascii'), 'PNG')
})

test('.tovideo convierte el sticker citado en video', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.tovideo', {
    quotedKind: 'sticker',
    mimetype: 'image/webp',
    buffer: animatedSticker
  })
  await findCommand('tovideo').run(ctx)
  assert.equal(sentOf(sock, 'video').length, 1)
  assert.equal(sentOf(sock, 'video')[0].content.video.subarray(4, 8).toString('ascii'), 'ftyp')
})

test('.sticker convierte una imagen en sticker con metadatos', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.sticker', {
    quotedKind: 'image',
    mimetype: 'image/png',
    buffer: png
  })
  await findCommand('sticker').run(ctx)
  const stickers = sentOf(sock, 'sticker')
  assert.equal(stickers.length, 1)
  const info = await readSticker(stickers[0].content.sticker)
  assert.equal(info.width, 512)
  assert.equal(info.metadata['sticker-pack-name'], ctx.config.stickers.packName)
})

test('.sticker reenvía un sticker sin recodificar', async () => {
  const { ctx, sock } = makeContext('.sticker', {
    quotedKind: 'sticker',
    mimetype: 'image/webp',
    buffer: staticSticker
  })
  await findCommand('sticker').run(ctx)
  assert.equal(sentOf(sock, 'sticker').length, 1)
})

test('.gif convierte un GIF en sticker animado', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.gif', {
    quotedKind: 'video',
    mimetype: 'image/gif',
    buffer: gif
  })
  await findCommand('gif').run(ctx)
  const stickers = sentOf(sock, 'sticker')
  assert.equal(stickers.length, 1)
  const info = await readSticker(stickers[0].content.sticker)
  assert.equal(info.animated, true)
})

test('.gif convierte un video en sticker animado', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.gif', {
    quotedKind: 'video',
    mimetype: 'video/mp4',
    buffer: mp4
  })
  await findCommand('gif').run(ctx)
  assert.equal(sentOf(sock, 'sticker').length, 1)
})

test('.take cambia nombre y autor', async () => {
  const { ctx, sock } = makeContext('.take Olas | Tomi 🌊', {
    quotedKind: 'sticker',
    buffer: animatedSticker
  })
  await findCommand('take').run(ctx)
  const sticker = sentOf(sock, 'sticker')[0].content.sticker
  const info = await readSticker(sticker)
  assert.equal(info.metadata['sticker-pack-name'], 'Olas')
  assert.equal(info.metadata['sticker-pack-publisher'], 'Tomi 🌊')
  assert.equal(info.animated, true, 'mantiene la animación')
})

test('.take sin argumentos vuelve a los metadatos del bot', async () => {
  const { ctx, sock } = makeContext('.take', { quotedKind: 'sticker', buffer: staticSticker })
  await findCommand('take').run(ctx)
  const info = await readSticker(sentOf(sock, 'sticker')[0].content.sticker)
  assert.equal(info.metadata['sticker-pack-name'], ctx.config.stickers.packName)
})

test('.steal copia el sticker con el pack del bot', async () => {
  const { ctx, sock } = makeContext('.steal', { quotedKind: 'sticker', buffer: animatedSticker })
  await findCommand('steal').run(ctx)
  const info = await readSticker(sentOf(sock, 'sticker')[0].content.sticker)
  assert.equal(info.metadata['sticker-pack-name'], ctx.config.stickers.packName)
  assert.equal(info.animated, true)
})

test('.toimg sin sticker citado explica qué hacer', async () => {
  const { ctx } = makeContext('.toimg')
  await assert.rejects(() => findCommand('toimg').run(ctx), /Responde a un \*sticker\*/)
})

test('.emojimix combina dos emojis usando el catálogo en caché', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emojimix-cmd-'))
  const cacheFile = path.join(dir, 'index.json')
  writeFileSync(
    cacheFile,
    JSON.stringify({
      version: 1,
      total: 1,
      source: 'test',
      createdAt: new Date().toISOString(),
      combos: { '1f63a_1f43c': { url: 'https://example.com/mix.png', date: '20201001' } }
    })
  )
  resetIndexCache()

  const config = testConfig()
  config.emojimix = { ...config.emojimix, cacheFile, enabled: true }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(png)
  try {
    const { ctx, sock } = makeContext('.emojimix 😺 🐼', { config })
    await findCommand('emojimix').run(ctx)
    const stickers = sentOf(sock, 'sticker')
    assert.equal(stickers.length, 1)
    const info = await readSticker(stickers[0].content.sticker)
    assert.equal(info.animated, false)
  } finally {
    globalThis.fetch = originalFetch
    resetIndexCache()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('.emojimix explica cuando la combinación no existe', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emojimix-none-'))
  const cacheFile = path.join(dir, 'index.json')
  writeFileSync(
    cacheFile,
    JSON.stringify({
      version: 1,
      total: 1,
      source: 'test',
      createdAt: new Date().toISOString(),
      combos: { '1f63a_1f43c': { url: 'https://example.com/mix.png', date: '20201001' } }
    })
  )
  resetIndexCache()
  const config = testConfig()
  config.emojimix = { ...config.emojimix, cacheFile, enabled: true }
  try {
    const { ctx } = makeContext('.emojimix 🐟 🐟', { config })
    await assert.rejects(() => findCommand('emojimix').run(ctx), /No encontré combinación/)
  } finally {
    resetIndexCache()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('.emojimix pide dos emojis cuando recibe uno solo', async () => {
  const { ctx } = makeContext('.emojimix 😺')
  await assert.rejects(() => findCommand('emojimix').run(ctx), /dos\* emojis/)
})

test('.help envía el menú con el banner como pie de foto', async () => {
  const config = testConfig()
  config.menu = { ...config.menu, image: 'tests/fixtures/sample.png', sendAsCaption: true }
  const { ctx, sock } = makeContext('.help', { config })
  await findCommand('help').run(ctx)

  const images = sentOf(sock, 'image')
  assert.equal(images.length, 1, 'se envía una imagen')
  assert.equal(images[0].content.image.subarray(1, 4).toString('ascii'), 'PNG')
  assert.match(images[0].content.caption, /𝓜𝓮𝓷𝓾 𝓭𝓮 𝓬𝓸𝓶𝓪𝓷𝓭𝓸𝓼/)
  assert.equal(sentOf(sock, 'text').length, 0, 'el menú va como pie de foto')
})

test('.help manda imagen y menú aparte si el pie sería muy largo', async () => {
  const config = testConfig()
  config.menu = { ...config.menu, image: 'tests/fixtures/sample.png', sendAsCaption: true }
  const manyCommands = new Map()
  for (let i = 0; i < 120; i += 1) {
    manyCommands.set(`cmd${i}`, { name: `comando-largo-${i}`, description: '' })
  }
  const { ctx, sock } = makeContext('.help', { config })
  ctx.commands = manyCommands
  await findCommand('help').run(ctx)

  assert.equal(sentOf(sock, 'image').length, 1)
  assert.equal(sentOf(sock, 'text').length, 1, 'el menú se envía como texto aparte')
})

test('.help cae al texto si el banner no existe', async () => {
  const config = testConfig()
  config.menu = { ...config.menu, image: 'no-existe/banner.png' }
  const { ctx, sock } = makeContext('.help', { config })
  await findCommand('help').run(ctx)
  assert.equal(sentOf(sock, 'image').length, 0)
  assert.equal(sentOf(sock, 'text').length, 1)
})
