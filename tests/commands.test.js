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

function makeContext(
  commandText,
  { quotedKind = null, mimetype, buffer = null, config = testConfig(), store = null, sock = null } = {}
) {
  const activeSock = sock || fakeSock()
  const activeStore = store || createStore(config, silentLogger)
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
  const ctx = new CommandContext({
    sock: activeSock,
    msg,
    config,
    logger: silentLogger,
    store: activeStore,
    text: commandText
  })
  ctx.commands = commands
  if (buffer) ctx.download = async () => buffer
  return { ctx, sock: activeSock }
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

test('.help deja los menús anteriores como "Menu eliminado."', async () => {
  const config = testConfig()
  config.menu = { ...config.menu, image: 'no-existe/banner.png' }
  const store = createStore(config, silentLogger)
  const sock = fakeSock()

  await findCommand('help').run(makeContext('.help', { config, store, sock }).ctx)
  await findCommand('help').run(makeContext('.help', { config, store, sock }).ctx)

  const retired = sock.sent.filter((item) => item.content?.text === 'Menu eliminado.')
  assert.equal(retired.length, 1, 'solo el menú anterior se retira')
  assert.ok(retired[0].content.edit, 'se edita el mensaje viejo')
  assert.equal(retired[0].content.edit.id, 'msg-1')

  const menus = sock.sent.filter(
    (item) => typeof item.content?.text === 'string' && !item.content.edit && item.content.text.includes('𝓜𝓮𝓷𝓾')
  )
  assert.equal(menus.length, 2, 'cada .help manda su menú')

  // Un tercer menú retira el segundo, no el primero
  await findCommand('help').run(makeContext('.help', { config, store, sock }).ctx)
  const edits = sock.sent.filter((item) => item.content?.edit)
  assert.equal(edits.length, 2)
  // El tercer menú retira el segundo (msg-3), no el primero
  assert.equal(edits[1].content.edit.id, 'msg-3')
})

test('.help con banner elimina el menú anterior al pedir otro (no lo edita a texto)', async () => {
  const config = testConfig()
  config.menu = { ...config.menu, image: 'tests/fixtures/sample.png', sendAsCaption: true }
  const store = createStore(config, silentLogger)
  const sock = fakeSock()

  await findCommand('help').run(makeContext('.help', { config, store, sock }).ctx)
  await findCommand('help').run(makeContext('.help', { config, store, sock }).ctx)
  await findCommand('help').run(makeContext('.help', { config, store, sock }).ctx)

  // Cada menú nuevo elimina para todos el banner anterior: una foto no se
  // puede editar hasta convertirla en el texto "Menu eliminado."
  const deletions = sock.sent.filter((item) => item.content?.delete)
  assert.deepEqual(
    deletions.map((item) => item.content.delete.id),
    ['msg-1', 'msg-3'],
    'se eliminan todos los banners anteriores'
  )
  assert.equal(
    sock.sent.filter((item) => item.content?.text === 'Menu eliminado.').length,
    0,
    'el banner no se "edita" a texto (WhatsApp lo ignoraría)'
  )
  assert.equal(sentOf(sock, 'image').length, 3, 'cada .help manda su menú con banner')
})

test('.help <comando> no retira el menú', async () => {
  const config = testConfig()
  config.menu = { ...config.menu, image: 'no-existe/banner.png' }
  const store = createStore(config, silentLogger)
  const sock = fakeSock()

  await findCommand('help').run(makeContext('.help', { config, store, sock }).ctx)
  await findCommand('help').run(makeContext('.help pack', { config, store, sock }).ctx)

  assert.equal(sock.sent.filter((item) => item.content?.edit).length, 0)
})

test('.pack edita el mensaje de progreso en vez de mandar uno por sticker', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const sock = fakeSock()

  await findCommand('pack').run(makeContext('.pack Olas | Tomi', { config, store, sock }).ctx)

  for (let i = 0; i < 2; i += 1) {
    await findCommand('pack').run(
      makeContext('.pack add', {
        config,
        store,
        sock,
        quotedKind: 'sticker',
        mimetype: 'image/webp',
        buffer: staticSticker
      }).ctx
    )
  }

  const standalone = sock.sent.filter(
    (item) => typeof item.content?.text === 'string' && !item.content.edit
  )
  assert.equal(standalone.length, 1, 'solo el mensaje inicial (los avances lo editan)')

  const progressEdits = sock.sent.filter(
    (item) => item.content?.edit && item.content.text.includes('📥')
  )
  assert.equal(progressEdits.length, 2, 'cada sticker edita el mismo mensaje')
  assert.equal(new Set(progressEdits.map((item) => item.content.edit.id)).size, 1)
  assert.match(progressEdits.at(-1).content.text, /2\/30/)
})

test('.pack done cierra el mensaje de progreso', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const sock = fakeSock()

  await findCommand('pack').run(makeContext('.pack Olas | Tomi', { config, store, sock }).ctx)
  await findCommand('pack').run(
    makeContext('.pack add', {
      config,
      store,
      sock,
      quotedKind: 'sticker',
      mimetype: 'image/webp',
      buffer: staticSticker
    }).ctx
  )
  await findCommand('pack').run(makeContext('.pack done', { config, store, sock }).ctx)

  const final = sock.sent.filter((item) => item.content?.edit && /enviado/i.test(item.content.text))
  assert.equal(final.length, 1)
  const slot = 'pack:59891111111@s.whatsapp.net'
  assert.equal(store.messages.entries('59891111111@s.whatsapp.net', slot).length, 0)
})

test('.take avisa por chat lo que cambió', async () => {
  const { ctx, sock } = makeContext('.take Olas | Tomi', { quotedKind: 'sticker', buffer: animatedSticker })
  await findCommand('take').run(ctx)
  const texts = sentOf(sock, 'text')
  assert.equal(texts.length, 1)
  assert.match(texts[0].content.text, /Sticker actualizado/)
  assert.match(texts[0].content.text, /Olas/)
  assert.match(texts[0].content.text, /Tomi/)
})

test('.take usa un pack-id nuevo (para que WhatsApp refresque el nombre)', async () => {
  const original = await readSticker(staticSticker)
  const before = original.metadata?.['sticker-pack-id']
  const { ctx, sock } = makeContext('.take Nuevo | Autor', { quotedKind: 'sticker', buffer: staticSticker })
  await findCommand('take').run(ctx)
  const out = await readSticker(sentOf(sock, 'sticker')[0].content.sticker)
  assert.equal(out.metadata['sticker-pack-name'], 'Nuevo')
  assert.notEqual(out.metadata['sticker-pack-id'], before)
})

test('.take acepta una foto y la convierte en sticker', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.take Foto | Tomi', {
    quotedKind: 'image',
    mimetype: 'image/png',
    buffer: png
  })
  await findCommand('take').run(ctx)
  const stickers = sentOf(sock, 'sticker')
  assert.equal(stickers.length, 1)
  const info = await readSticker(stickers[0].content.sticker)
  assert.equal(info.metadata['sticker-pack-name'], 'Foto')
  assert.equal(info.metadata['sticker-pack-publisher'], 'Tomi')
  assert.match(sentOf(sock, 'text')[0].content.text, /Convertido a sticker/)
})

test('.take acepta un video y crea un sticker animado', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.take Video | Tomi', {
    quotedKind: 'video',
    mimetype: 'video/mp4',
    buffer: mp4
  })
  await findCommand('take').run(ctx)
  const info = await readSticker(sentOf(sock, 'sticker')[0].content.sticker)
  assert.equal(info.animated, true)
  assert.equal(info.metadata['sticker-pack-name'], 'Video')
})

test('.take sin media explica cómo usarlo', async () => {
  const { ctx } = makeContext('.take x | y')
  await assert.rejects(() => findCommand('take').run(ctx), /Responde a un \*sticker\*/)
})

test('.steal copia una foto como sticker del bot', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { ctx, sock } = makeContext('.steal', {
    quotedKind: 'image',
    mimetype: 'image/png',
    buffer: png
  })
  await findCommand('steal').run(ctx)
  const stickers = sentOf(sock, 'sticker')
  assert.equal(stickers.length, 1)
  const info = await readSticker(stickers[0].content.sticker)
  assert.equal(info.metadata['sticker-pack-name'], ctx.config.stickers.packName)
  assert.match(sentOf(sock, 'text')[0].content.text, /Sticker copiado/)
})

test('.debug devuelve un diagnóstico legible', async () => {
  const { ctx, sock } = makeContext('.debug')
  await findCommand('debug').run(ctx)
  const texts = sentOf(sock, 'text')
  assert.ok(texts.length >= 2)
  const report = texts.at(-1).content.text
  assert.match(report, /Diagnóstico de TomiOka/)
  assert.match(report, /Node:/)
  assert.match(report, /FFmpeg:/)
  assert.match(report, /Carpeta temporal:/)
  assert.match(report, /Prueba de conversión/)
})

test('.debug no aparece en el menú', async () => {
  const { buildMenu } = await import('../src/menu.js')
  const menu = buildMenu({ config: testConfig(), commands, sender: {} })
  assert.ok(!menu.includes('.debug'))
  assert.ok(menu.includes('.help'))
})

test('.take funciona aunque el sticker traiga un EXIF raro (sin cabecera)', async () => {
  const webpmux = (await import('node-webpmux')).default
  const image = new webpmux.Image()
  await image.load(staticSticker)
  image.exif = Buffer.from('{"sticker-pack-name":"hecho por otra app"}', 'utf8')
  const weird = await image.save(null, { exif: true })

  const { ctx, sock } = makeContext('.take Mío | Tomi', { quotedKind: 'sticker', buffer: weird })
  await findCommand('take').run(ctx)
  const stickers = sentOf(sock, 'sticker')
  assert.equal(stickers.length, 1, 'igual devuelve el sticker')
  const info = await readSticker(stickers[0].content.sticker)
  assert.equal(info.metadata['sticker-pack-name'], 'Mío')
})

test('.take rechaza un documento que no es imagen ni video', async () => {
  const { ctx } = makeContext('.take X | Y', {
    quotedKind: 'document',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 documento')
  })
  await assert.rejects(() => findCommand('take').run(ctx), /no es una imagen ni un video/)
})

test('.steal rechaza un media que no se pudo convertir en WebP', async () => {
  const { ctx } = makeContext('.steal', {
    quotedKind: 'image',
    mimetype: 'image/png',
    buffer: Buffer.from('esto no es una imagen')
  })
  // Sin FFmpeg el error viene de la conversión; con FFmpeg, del formato
  await assert.rejects(() => findCommand('steal').run(ctx), /FFmpeg|sticker|imagen|compatible/i)
})
