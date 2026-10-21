import test from 'node:test'
import assert from 'node:assert/strict'
import { createDecipheriv, createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getMediaKeys,
  hkdfInfoKey,
  MEDIA_HKDF_KEY_MAPPING,
  MEDIA_PATH_MAP
} from '@whiskeysockets/baileys'
import {
  STICKER_PACK_HKDF,
  STICKER_PACK_PATH,
  buildStickerPackZip,
  ensureStickerPackMediaTypes,
  packStickerFileName,
  prepareStickerPackMessage
} from '../src/lib/sticker-pack.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const staticSticker = await readFile(path.join(here, 'fixtures/sticker-static.webp'))
const animatedSticker = await readFile(path.join(here, 'fixtures/sticker-anim.webp'))

/** Lee las entradas de un ZIP "store" */
function readZipEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break
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

const samplePack = () =>
  buildStickerPackZip({
    packId: 'tomioka_test',
    name: 'Olas',
    publisher: 'Tomi',
    description: 'Pack de Olas',
    stickers: [
      { buffer: staticSticker, emojis: ['🌊'], animated: false },
      { buffer: animatedSticker, emojis: ['💧'], animated: true }
    ],
    tray: staticSticker,
    trayFileName: 'tomioka_test.webp'
  })

test('ensureStickerPackMediaTypes registra el tipo de media en Baileys', () => {
  assert.equal(MEDIA_PATH_MAP['sticker-pack'], undefined)
  assert.equal(MEDIA_HKDF_KEY_MAPPING['sticker-pack'], undefined)

  assert.equal(ensureStickerPackMediaTypes(), true)
  assert.equal(MEDIA_PATH_MAP['sticker-pack'], STICKER_PACK_PATH)
  assert.equal(MEDIA_HKDF_KEY_MAPPING['sticker-pack'], STICKER_PACK_HKDF)
  // Clave que usa WhatsApp para cifrar los packs de stickers
  assert.equal(hkdfInfoKey('sticker-pack'), 'WhatsApp Sticker Pack Keys')
  // Llamarlo de nuevo no rompe nada
  assert.equal(ensureStickerPackMediaTypes(), true)
})

test('packStickerFileName usa el hash del WebP', () => {
  const name = packStickerFileName(staticSticker)
  assert.match(name, /^[A-Za-z0-9+/=-]+\.webp$/)
  assert.ok(!name.includes('/'), 'sin barras: el nombre va dentro del ZIP')
  assert.equal(name, packStickerFileName(Buffer.from(staticSticker)))
  assert.notEqual(name, packStickerFileName(animatedSticker))
  assert.ok(name.startsWith(createHash('sha256').update(staticSticker).digest('base64').replace(/\//g, '-')))
})

test('buildStickerPackZip arma un .wasticker con los nombres del mensaje', () => {
  const pack = samplePack()
  const entries = readZipEntries(pack.zip)
  const contents = JSON.parse(entries.get('contents.json').toString('utf8'))
  const packInfo = contents.sticker_packs[0]

  assert.equal(packInfo.identifier, 'tomioka_test')
  assert.equal(packInfo.name, 'Olas')
  assert.equal(packInfo.publisher, 'Tomi')
  assert.equal(packInfo.tray_image_file, 'tomioka_test.webp')
  assert.ok(entries.has('tomioka_test.webp'))

  assert.equal(pack.stickers.length, 2)
  assert.equal(packInfo.stickers.length, 2)
  for (const sticker of pack.stickers) {
    assert.ok(entries.has(sticker.fileName), `el ZIP tiene ${sticker.fileName}`)
    assert.equal(sticker.mimetype, 'image/webp')
    assert.ok(packInfo.stickers.some((item) => item.image_file === sticker.fileName))
  }
  assert.deepEqual(
    pack.stickers.map((sticker) => sticker.isAnimated),
    [false, true]
  )
  assert.equal(packInfo.animated_sticker_pack, true)
  assert.equal(pack.trayIconFileName, 'tomioka_test.webp')
})

test('buildStickerPackZip exige stickers y id', () => {
  assert.throws(() => buildStickerPackZip({ packId: 'x', stickers: [] }), /al menos un sticker/)
  assert.throws(
    () => buildStickerPackZip({ packId: '', stickers: [{ buffer: staticSticker }] }),
    /id del pack/
  )
})

test('prepareStickerPackMessage cifra y sube el paquete como sticker-pack', async () => {
  ensureStickerPackMediaTypes()
  const pack = samplePack()

  let captured = null
  const message = await prepareStickerPackMessage({
    packId: 'tomioka_test',
    name: 'Olas',
    publisher: 'Tomi',
    description: 'Pack de Olas',
    zip: pack.zip,
    stickers: pack.stickers,
    trayIconFileName: pack.trayIconFileName,
    upload: async (filePath, options) => {
      captured = { filePath, options, enc: await readFile(filePath) }
      return { directPath: '/v/tomioka_test', mediaUrl: 'https://mmg.whatsapp.net/v/tomioka_test' }
    },
    mediaKeyTimestamp: 1700000000
  })

  assert.ok(captured, 'se subió el archivo cifrado')
  assert.equal(captured.options.mediaType, 'sticker-pack')
  assert.equal(
    captured.enc.length,
    Math.ceil(pack.zip.length / 16) * 16 + 10,
    'texto cifrado (con padding CBC) + MAC de 10 bytes'
  )

  assert.equal(message.stickerPackId, 'tomioka_test')
  assert.equal(message.name, 'Olas')
  assert.equal(message.publisher, 'Tomi')
  assert.equal(message.packDescription, 'Pack de Olas')
  assert.equal(Number(message.stickerPackSize), pack.zip.length)
  assert.equal(Number(message.fileLength), pack.zip.length)
  assert.equal(message.directPath, '/v/tomioka_test')
  assert.equal(message.trayIconFileName, 'tomioka_test.webp')
  assert.equal(message.mediaKey.length, 32)
  assert.equal(message.stickers.length, 2)

  // Se descifra con la misma clave que usa WhatsApp: prueba de que el HKDF
  // "WhatsApp Sticker Pack Keys" y el MAC están bien.
  const keys = await getMediaKeys(message.mediaKey, 'sticker-pack')
  const mac = captured.enc.subarray(captured.enc.length - 10)
  const ciphertext = captured.enc.subarray(0, captured.enc.length - 10)
  const expectedMac = createHmac('sha256', keys.macKey)
    .update(keys.iv)
    .update(ciphertext)
    .digest()
    .subarray(0, 10)
  assert.deepEqual(Buffer.from(mac), expectedMac)

  const decipher = createDecipheriv('aes-256-cbc', keys.cipherKey, keys.iv)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  assert.equal(plain.length, pack.zip.length)
  assert.deepEqual(Buffer.from(message.fileSha256), createHash('sha256').update(plain).digest())
  assert.deepEqual(plain, pack.zip)
})

test('prepareStickerPackMessage valida la subida', async () => {
  const pack = samplePack()
  await assert.rejects(
    () =>
      prepareStickerPackMessage({
        packId: 'x',
        name: 'x',
        publisher: 'x',
        zip: pack.zip,
        stickers: pack.stickers,
        upload: async () => ({})
      }),
    /ruta del paquete/
  )
  await assert.rejects(
    () => prepareStickerPackMessage({ packId: 'x', zip: pack.zip, stickers: [], upload: async () => ({}) }),
    /no tiene stickers/
  )
})
