import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildExifPayload,
  demuxWebpFrames,
  isWebp,
  newPackId,
  readSticker,
  writeStickerMetadata
} from '../src/lib/sticker.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const staticSticker = await readFile(path.join(here, 'fixtures/sticker-static.webp'))
const animatedSticker = await readFile(path.join(here, 'fixtures/sticker-anim.webp'))

test('isWebp detecta el formato', () => {
  assert.equal(isWebp(staticSticker), true)
  assert.equal(isWebp(Buffer.from('no soy webp')), false)
  assert.equal(isWebp(null), false)
})

test('lee dimensiones y metadatos del sticker', async () => {
  const info = await readSticker(staticSticker)
  assert.equal(info.width, 512)
  assert.equal(info.height, 512)
  assert.equal(info.animated, false)
})

test('escribe y lee los metadatos del pack', async () => {
  const out = await writeStickerMetadata(staticSticker, {
    packName: 'Mi Pack',
    packAuthor: 'Tomi 🌊',
    emojis: ['🌊', '💧']
  })
  assert.ok(isWebp(out))
  assert.ok(out.length > staticSticker.length)

  const info = await readSticker(out)
  assert.equal(info.metadata['sticker-pack-name'], 'Mi Pack')
  assert.equal(info.metadata['sticker-pack-publisher'], 'Tomi 🌊')
  assert.deepEqual(info.metadata.emojis, ['🌊', '💧'])
  assert.equal(info.metadata['is-animated'], false)
})

test('conserva la animación al escribir metadatos', async () => {
  const out = await writeStickerMetadata(animatedSticker, { packName: 'Anim', packAuthor: 'Tomi' })
  const info = await readSticker(out)
  assert.equal(info.animated, true)
  assert.equal(info.metadata['is-animated'], true)
})

test('demuxWebpFrames separa los cuadros', async () => {
  const result = await demuxWebpFrames(animatedSticker)
  assert.equal(result.animated, true)
  assert.ok(result.frames.length >= 2)
  assert.equal(result.delays.length, result.frames.length)
  assert.ok(result.frames.every((frame) => isWebp(frame)))
})

test('buildExifPayload recorta valores largos y usa defaults', () => {
  const payload = buildExifPayload({ packName: 'x'.repeat(120) })
  assert.equal(payload['sticker-pack-name'].length, 60)
  assert.deepEqual(payload.emojis, ['🌊'])
  assert.equal(typeof payload['sticker-pack-id'], 'string')
})

test('newPackId genera ids distintos', () => {
  assert.notEqual(newPackId(), newPackId())
  assert.equal(newPackId().length, 32)
})
