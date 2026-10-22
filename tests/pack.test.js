import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackStore } from '../src/lib/sessions.js'
import { finishPack } from '../src/commands/pack.js'
import { createStore } from '../src/handler.js'
import { readSticker } from '../src/lib/sticker.js'
import { fakeSock, ffmpegAvailable, silentLogger, testConfig, withLiveMessages } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const animatedSticker = await readFile(path.join(here, 'fixtures/sticker-anim.webp'))
const staticSticker = await readFile(path.join(here, 'fixtures/sticker-static.webp'))

/** Lee las entradas de un ZIP "store" generado por el bot */
function readZipEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x04034b50) break
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength)
    const dataStart = offset + 30 + nameLength + extraLength
    entries.set(name, buffer.subarray(dataStart, dataStart + size))
    offset = dataStart + size
  }
  return entries
}

function fakeContext(config, store) {
  const output = { documents: [], replies: [] }
  const ctx = {
    output,
    config,
    store,
    logger: silentLogger,
    chatJid: '59891111111@s.whatsapp.net',
    senderJid: '59891111111@s.whatsapp.net',
    async typing() {},
    async reply(text) {
      output.replies.push(text)
    },
    async react() {},
    async sendDocument(buffer, fileName, mimetype, caption) {
      output.documents.push({ buffer, fileName, mimetype, caption })
    }
  }
  return withLiveMessages(ctx, fakeSock())
}

test('PackStore inicia, agrega y cierra sesiones', () => {
  const store = new PackStore({ ttlMinutes: 1, maxStickers: 2, logger: silentLogger })
  const session = store.start({ chatJid: 'a', senderJid: 'b', name: 'Pack', author: 'Tomi' })
  assert.equal(store.get('a', 'b'), session)
  assert.equal(store.findByChat('a'), session)

  assert.equal(store.add(session, { buffer: Buffer.from('1') }).ok, true)
  assert.equal(store.add(session, { buffer: Buffer.from('2') }).ok, true)
  assert.deepEqual(store.add(session, { buffer: Buffer.from('3') }), {
    ok: false,
    reason: 'lleno'
  })

  const finished = store.finish(session)
  assert.equal(finished.stickers.length, 2)
  assert.equal(store.get('a', 'b'), null)

  const other = store.start({ chatJid: 'a', senderJid: 'c', name: 'X', author: 'Y' })
  assert.equal(store.cancel(other), true)
  assert.equal(store.size, 0)
  store.destroy()
})

test('PackStore expira sesiones inactivas', () => {
  const store = new PackStore({ ttlMinutes: 0.02, maxStickers: 5, logger: silentLogger })
  const session = store.start({ chatJid: 'a', senderJid: 'b', name: 'Pack', author: 'Tomi' })
  session.updatedAt = Date.now() - 10000
  assert.equal(store.get('a', 'b'), null)
  store.destroy()
})

test('finishPack arma el .wasticker con contents.json y stickers', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const ctx = fakeContext(config, store)
  const session = store.packs.start({
    chatJid: ctx.chatJid,
    senderJid: ctx.senderJid,
    name: 'Olas del Mar',
    author: 'Tomi 🌊'
  })
  store.packs.add(session, { buffer: staticSticker, emojis: ['🌊'] })
  store.packs.add(session, { buffer: animatedSticker, emojis: ['💧'] })

  await finishPack(ctx, session)

  assert.equal(ctx.output.documents.length, 1)
  const doc = ctx.output.documents[0]
  assert.equal(doc.fileName, 'Olas_del_Mar.wasticker')
  assert.equal(doc.mimetype, 'application/zip')
  assert.equal(store.packs.size, 0, 'la sesión se cierra')

  const entries = readZipEntries(doc.buffer)
  assert.ok(entries.has('contents.json'))
  const contents = JSON.parse(entries.get('contents.json').toString('utf8'))
  assert.equal(contents.sticker_packs.length, 1)
  const pack = contents.sticker_packs[0]
  assert.equal(pack.name, 'Olas del Mar')
  assert.equal(pack.publisher, 'Tomi 🌊')
  assert.equal(pack.stickers.length, 2)
  assert.equal(pack.animated_sticker_pack, true)
  for (const sticker of pack.stickers) {
    assert.ok(entries.has(sticker.image_file), `falta ${sticker.image_file}`)
  }

  // Los stickers del pack llevan el nombre del pack en sus metadatos
  const first = await readSticker(entries.get(pack.stickers[0].image_file))
  assert.equal(first.metadata['sticker-pack-name'], 'Olas del Mar')
})

test('finishPack sin sesión explica el error', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const ctx = fakeContext(config, store)
  await assert.rejects(() => finishPack(ctx, null), /No hay ningún pack en curso/)
})

test('finishPack con pack vacío no genera archivo', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const ctx = fakeContext(config, store)
  const session = store.packs.start({
    chatJid: ctx.chatJid,
    senderJid: ctx.senderJid,
    name: 'Vacío',
    author: 'Tomi'
  })
  await assert.rejects(() => finishPack(ctx, session), /vacío/)
  assert.equal(ctx.output.documents.length, 0)
})

test('finishPack incluye la vista previa si hay FFmpeg', async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('FFmpeg no disponible en este entorno')
    return
  }
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const ctx = fakeContext(config, store)
  const session = store.packs.start({
    chatJid: ctx.chatJid,
    senderJid: ctx.senderJid,
    name: 'Con tray',
    author: 'Tomi'
  })
  store.packs.add(session, { buffer: staticSticker, emojis: [] })
  await finishPack(ctx, session)

  const entries = readZipEntries(ctx.output.documents[0].buffer)
  const contents = JSON.parse(entries.get('contents.json').toString('utf8'))
  const pack = contents.sticker_packs[0]
  assert.ok(pack.tray_image_file, 'contents.json referencia el tray')
  assert.ok(entries.has(pack.tray_image_file))
  const trayBuffer = entries.get(pack.tray_image_file)
  const isPng = trayBuffer.subarray(1, 4).toString('ascii') === 'PNG'
  const isWebp =
    trayBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    trayBuffer.subarray(8, 12).toString('ascii') === 'WEBP'
  assert.ok(isPng || isWebp, 'el ícono del pack es PNG o WebP')
  store.packs.destroy()
})

test('finishPack manda el pack nativo (no el archivo) si el socket lo soporta', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const ctx = fakeContext(config, store)
  const relayed = []
  ctx.sock = {
    async waUploadToServer() {
      return { directPath: '/v/tomioka-test', mediaUrl: 'https://mmg.whatsapp.net/v/tomioka-test' }
    },
    async relayMessage(jid, message, options) {
      relayed.push({ jid, message, options })
      return 'msg-nativo'
    }
  }

  const session = store.packs.start({
    chatJid: ctx.chatJid,
    senderJid: ctx.senderJid,
    name: 'Nativo',
    author: 'Tomi'
  })
  store.packs.add(session, { buffer: staticSticker, emojis: [] })
  await finishPack(ctx, session)

  assert.equal(ctx.output.documents.length, 0, 'no se manda el .wasticker como archivo')
  assert.equal(relayed.length, 1)

  const packMessage = relayed[0].message.stickerPackMessage
  assert.equal(packMessage.name, 'Nativo')
  assert.equal(packMessage.publisher, 'Tomi')
  assert.equal(packMessage.stickers.length, 1)
  assert.equal(packMessage.stickers[0].mimetype, 'image/webp')
  assert.ok(packMessage.directPath)
  assert.ok(packMessage.mediaKey.length > 0)
  assert.ok(packMessage.fileLength > 0)
  store.packs.destroy()
})

test('finishPack cae al .wasticker si el pack nativo falla', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const ctx = fakeContext(config, store)
  ctx.sock = {
    async waUploadToServer() {
      throw new Error('sin conexión')
    },
    async relayMessage() {
      throw new Error('no debería llegar acá')
    }
  }

  const session = store.packs.start({
    chatJid: ctx.chatJid,
    senderJid: ctx.senderJid,
    name: 'Respaldo',
    author: 'Tomi'
  })
  store.packs.add(session, { buffer: staticSticker, emojis: [] })
  await finishPack(ctx, session)

  assert.equal(ctx.output.documents.length, 1)
  assert.match(ctx.output.documents[0].fileName, /\.wasticker$/)
  store.packs.destroy()
})

test('acceptedKinds incluye fotos y videos según la configuración', async () => {
  const { acceptedKinds } = await import('../src/commands/pack.js')
  const config = testConfig()
  assert.deepEqual(acceptedKinds(config), ['sticker', 'image', 'video', 'document'])

  const soloStickers = testConfig({ pack: { acceptPhotos: false, acceptVideos: false } })
  assert.deepEqual(acceptedKinds(soloStickers), ['sticker'])
})

test('.pack accepta una foto y la convierte en sticker', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { addMediaToSession } = await import('../src/commands/pack.js')
  const { createStore } = await import('../src/handler.js')
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const image = await readFile(path.join(here, 'fixtures/sample.png'))

  const base = fakeContext(config, store)
  const session = store.packs.start({
    chatJid: base.chatJid,
    senderJid: base.senderJid,
    name: 'Fotos',
    author: 'Tomi'
  })

  const ctx = {
    ...base,
    mediaTarget: { kind: 'image', type: 'imageMessage', media: { mimetype: 'image/png' } },
    requireMedia() {
      return this.mediaTarget
    },
    async download() {
      return image
    }
  }

  const count = await addMediaToSession(ctx, session, { silent: true })
  assert.equal(count, 1)
  assert.equal(session.stickers.length, 1)
  const info = await readSticker(session.stickers[0].buffer)
  assert.equal(info.width, 512)
  assert.equal(info.animated, false)
  store.packs.destroy()
})

test('un pack con fotos genera el .wasticker con varios stickers', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const { addMediaToSession } = await import('../src/commands/pack.js')
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const base = fakeContext(config, store)
  const session = store.packs.start({
    chatJid: base.chatJid,
    senderJid: base.senderJid,
    name: 'Tres fotos',
    author: 'Tomi'
  })

  for (const fixture of ['sample.png', 'sample.png', 'sample.png']) {
    const image = await readFile(path.join(here, 'fixtures', fixture))
    const ctx = {
      ...base,
      mediaTarget: { kind: 'image', type: 'imageMessage', media: { mimetype: 'image/png' } },
      requireMedia() {
        return this.mediaTarget
      },
      async download() {
        return image
      }
    }
    await addMediaToSession(ctx, session, { silent: true })
  }

  assert.equal(session.stickers.length, 3)
  await finishPack(base, session)
  const doc = base.output.documents[0]
  const entries = readZipEntries(doc.buffer)
  const contents = JSON.parse(entries.get('contents.json').toString('utf8'))
  assert.equal(contents.sticker_packs[0].stickers.length, 3)
  for (const sticker of contents.sticker_packs[0].stickers) {
    assert.ok(entries.has(sticker.image_file))
  }
  store.packs.destroy()
})

test('.pack como pie de foto inicia el pack y agrega esa foto', async (t) => {
  if (!(await ffmpegAvailable())) return t.skip('FFmpeg no disponible')
  const image = await readFile(path.join(here, 'fixtures', 'sample.png'))
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const base = fakeContext(config, store)

  const ctx = {
    ...base,
    args: [],
    argsText: 'Gatitos,Tomi',
    command: 'pack',
    mediaTarget: { kind: 'image', type: 'imageMessage', media: { mimetype: 'image/png' } },
    requireMedia() {
      return this.mediaTarget
    },
    async download() {
      return image
    }
  }

  const { default: pack } = await import('../src/commands/pack.js')
  await pack.run(ctx)
  const session = store.packs.findByChat(ctx.chatJid, ctx.senderJid)
  assert.ok(session, 'la sesión existe')
  assert.equal(session.stickers.length, 1, 'la foto del caption entra al pack')
  assert.equal(session.name, 'Gatitos')

  // Otra foto con el mismo pie agrega al pack existente en lugar de fallar
  await pack.run(ctx)
  assert.equal(store.packs.findByChat(ctx.chatJid, ctx.senderJid).stickers.length, 2)
  store.packs.destroy()
})
