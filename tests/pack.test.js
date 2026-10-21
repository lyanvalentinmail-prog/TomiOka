import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackStore } from '../src/lib/sessions.js'
import { finishPack } from '../src/commands/pack.js'
import { createStore } from '../src/handler.js'
import { readSticker } from '../src/lib/sticker.js'
import { ffmpegAvailable, silentLogger, testConfig } from './helpers.js'

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
  return {
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
  assert.equal(entries.get(pack.tray_image_file).subarray(1, 4).toString('ascii'), 'PNG')
  store.packs.destroy()
})
