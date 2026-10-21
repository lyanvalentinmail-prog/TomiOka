import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANIM_CHUNK,
  EXIF_CHUNK,
  VP8X_FLAGS,
  auditSticker,
  injectExif,
  isWebpBuffer,
  parseWebp,
  readExifPayload,
  stripExif,
  webpInfo
} from '../src/lib/webp.js'
import { writeStickerMetadata } from '../src/lib/sticker.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const staticSticker = await readFile(path.join(here, 'fixtures/sticker-static.webp'))
const animatedSticker = await readFile(path.join(here, 'fixtures/sticker-anim.webp'))
// WebP "simple" (sin chunk VP8X), como los que genera FFmpeg para fotos
const simpleSticker = await readFile(path.join(here, 'fixtures/sticker-simple.webp'))

const chunkIds = (buffer) => parseWebp(buffer).chunks.map((chunk) => chunk.id)
const animBackground = (buffer) => {
  const chunk = parseWebp(buffer).chunks.find((item) => item.id === ANIM_CHUNK)
  return chunk ? chunk.data.readUInt32LE(2) : null
}

test('parseWebp lee la cabecera RIFF/WEBP', () => {
  const parsed = parseWebp(animatedSticker)
  assert.equal(parsed.valid, true)
  assert.equal(parsed.size, animatedSticker.length)
  assert.equal(parsed.sizeMismatch, false)
  assert.equal(isWebpBuffer(animatedSticker), true)
  assert.equal(isWebpBuffer(Buffer.from('GIF89a')), false)
  assert.equal(isWebpBuffer(null), false)
  assert.equal(parseWebp(Buffer.from('nada')).valid, false)
})

test('webpInfo describe estáticos y animados', () => {
  const still = webpInfo(staticSticker)
  assert.equal(still.width, 512)
  assert.equal(still.height, 512)
  assert.equal(still.animated, false)
  assert.equal(still.frameCount, 0)
  assert.equal(still.hasAlpha, true)

  const anim = webpInfo(animatedSticker)
  assert.equal(anim.animated, true)
  assert.ok(anim.frameCount >= 10)
  assert.ok(anim.totalDelay > 0)
  assert.equal(anim.hasAlpha, true)
  assert.equal(anim.loops, 0)
})

test('injectExif conserva ANIM y ALPHA del WebP animado', () => {
  const exif = Buffer.from('{"sticker-pack-name":"Test"}', 'utf8')
  const out = injectExif(animatedSticker, exif)
  const before = webpInfo(animatedSticker)
  const after = webpInfo(out)

  // El bug original: el re-mux borraba ALPHA y dejaba el sticker con fondo negro.
  assert.ok(after.flags & VP8X_FLAGS.ALPHA, 'debe conservar el flag ALPHA')
  assert.ok(after.flags & VP8X_FLAGS.ANIM, 'debe conservar el flag ANIM')
  assert.ok(after.flags & VP8X_FLAGS.EXIF, 'debe marcar EXIF')
  assert.equal(after.hasAlpha, true)
  assert.equal(after.animated, true)
  assert.equal(after.frameCount, before.frameCount)
  assert.equal(after.totalDelay, before.totalDelay)
  assert.equal(after.backgroundColor, 0, 'el fondo ANIM debe ser transparente')
  assert.equal(animBackground(out), 0)
  assert.deepEqual(chunkIds(out).filter((id) => id === 'ANMF').length, before.frameCount)
  assert.deepEqual(readExifPayload(out), { 'sticker-pack-name': 'Test' })
})

test('injectExif reemplaza un EXIF anterior en vez de duplicarlo', () => {
  const first = injectExif(animatedSticker, Buffer.from('{"v":1}', 'utf8'))
  const second = injectExif(first, Buffer.from('{"v":2}', 'utf8'))
  assert.equal(chunkIds(second).filter((id) => id === EXIF_CHUNK).length, 1)
  assert.deepEqual(readExifPayload(second), { v: 2 })
  assert.equal(webpInfo(second).frameCount, webpInfo(animatedSticker).frameCount)
  assert.equal(webpInfo(second).hasAlpha, true)
})

test('stripExif vuelve al WebP original', () => {
  const withExif = injectExif(staticSticker, Buffer.from('{"x":1}', 'utf8'))
  assert.ok(chunkIds(withExif).includes(EXIF_CHUNK))
  const clean = stripExif(withExif)
  assert.ok(!chunkIds(clean).includes(EXIF_CHUNK))
  assert.equal(webpInfo(clean).flags & VP8X_FLAGS.EXIF, 0)
  assert.equal(webpInfo(clean).width, 512)
  assert.equal(webpInfo(clean).hasAlpha, true)
})

test('writeStickerMetadata no rompe los cuadros ni el alfa', async () => {
  const out = await writeStickerMetadata(animatedSticker, { packName: 'Anim', packAuthor: 'Tomi' })
  const before = webpInfo(animatedSticker)
  const after = webpInfo(out)
  assert.equal(after.frameCount, before.frameCount)
  assert.equal(after.hasAlpha, true)
  assert.ok(after.flags & VP8X_FLAGS.ALPHA)
  assert.ok(after.flags & VP8X_FLAGS.EXIF)
  assert.equal(auditSticker(out).valid, true)
})

test('injectExif agrega VP8X cuando el WebP es simple', async () => {
  assert.ok(!chunkIds(simpleSticker).includes('VP8X'))
  const out = await writeStickerMetadata(simpleSticker, { packName: 'Simple', packAuthor: 'Tomi' })
  const info = webpInfo(out)
  assert.equal(info.width, 96)
  assert.equal(info.height, 96)
  assert.ok(info.flags & VP8X_FLAGS.EXIF)
  assert.equal(chunkIds(out)[0], 'VP8X')
  assert.deepEqual(readExifPayload(out)['sticker-pack-name'], 'Simple')
  assert.equal(auditSticker(out).valid, true)
})

test('auditSticker detecta un WebP roto o demasiado grande', () => {
  const good = auditSticker(staticSticker)
  assert.equal(good.valid, true)
  assert.deepEqual(good.issues, [])

  const broken = auditSticker(Buffer.from('no soy un webp'))
  assert.equal(broken.valid, false)
  assert.ok(broken.issues.length > 0)

  const oversized = auditSticker(animatedSticker, { maxBytes: 1024 })
  assert.equal(oversized.valid, false)
  assert.ok(oversized.issues.some((issue) => /pesa|KB|bytes/i.test(issue)))

  const badSize = auditSticker(staticSticker, { maxSize: 320 })
  assert.equal(badSize.valid, false)
})
