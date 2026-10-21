import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  codePointToEmoji,
  codeVariants,
  emojiToCodePoint,
  findMix,
  normalizeCode,
  pairKey,
  randomMix,
  resetIndexCache
} from '../src/lib/emojimix.js'

test('emojiToCodePoint convierte emojis simples y compuestos', () => {
  assert.equal(emojiToCodePoint('😀'), '1f600')
  assert.equal(emojiToCodePoint('❤️'), '2764-fe0f')
  assert.equal(emojiToCodePoint('🇺🇾'), '1f1fa-1f1fe')
  assert.equal(emojiToCodePoint('👨‍👩‍👧'), '1f468-200d-1f469-200d-1f467')
})

test('normalizeCode limpia prefijos u y selectores', () => {
  assert.equal(normalizeCode('u1f600'), '1f600')
  assert.equal(normalizeCode('U+1F600'), '1f600')
  assert.equal(normalizeCode('2764-fe0f'), '2764')
  assert.equal(normalizeCode('1f1fa-1f1fe'), '1f1fa-1f1fe')
})

test('codeVariants devuelve variantes sin duplicados', () => {
  assert.deepEqual(codeVariants('❤️'), ['2764-fe0f', '2764'])
  assert.deepEqual(codeVariants('😀'), ['1f600'])
})

test('codePointToEmoji reconstruye el emoji', () => {
  assert.equal(codePointToEmoji('1f600'), '😀')
  assert.equal(codePointToEmoji('2764-fe0f'), '❤️')
  assert.equal(codePointToEmoji(''), '')
  assert.equal(codePointToEmoji('zzz'), '')
})

test('pairKey normaliza ambos lados', () => {
  assert.equal(pairKey('u1f600', '1F525'), '1f600_1f525')
})

test('findMix busca en el índice en memoria (caché)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emojimix-test-'))
  const cacheFile = path.join(dir, 'index.json')
  const combos = {
    '1f600_1f525': { url: 'https://example.com/1f600_1f525.png', date: '20201001' },
    '1f43c_1f43c': { url: 'https://example.com/1f43c_1f43c.png', date: '20201001' }
  }
  writeFileSync(
    cacheFile,
    JSON.stringify({ version: 1, total: 2, source: 'test', createdAt: new Date().toISOString(), combos })
  )
  resetIndexCache()
  try {
    const options = { cacheFile, metadataUrl: 'http://invalid.local/none.json' }
    const mix = await findMix('😀', '🔥', options)
    assert.ok(mix)
    assert.equal(mix.url, 'https://example.com/1f600_1f525.png')

    const reversed = await findMix('🔥', '😀', options)
    assert.equal(reversed.url, mix.url, 'funciona en cualquier orden')

    const missing = await findMix('🐼', '🔥', options)
    assert.equal(missing, null)

    const random = await randomMix(options)
    assert.ok(random.url)

    const lowercase = await findMix('😀', '🔥', options)
    assert.ok(lowercase.key.includes('1f600'))
  } finally {
    resetIndexCache()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findMix falla con mensaje claro si no hay caché ni red', async () => {
  resetIndexCache()
  const dir = mkdtempSync(path.join(os.tmpdir(), 'emojimix-empty-'))
  try {
    await assert.rejects(
      () =>
        findMix('😀', '🔥', {
          cacheFile: path.join(dir, 'nope.json'),
          metadataUrl: 'http://127.0.0.1:1/metadata.json',
          timeoutMs: 1500
        }),
      /No se pudo descargar el catálogo/
    )
  } finally {
    resetIndexCache()
    rmSync(dir, { recursive: true, force: true })
  }
})
