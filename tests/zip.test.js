import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { crc32, createZip } from '../src/lib/zip.js'

test('crc32 coincide con los valores conocidos', () => {
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686)
  assert.equal(crc32(Buffer.from('')), 0)
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('createZip arma un archivo con cabecera válida', () => {
  const zip = createZip([
    { name: 'contents.json', data: Buffer.from('{"hola":1}') },
    { name: 'sticker.webp', data: Buffer.from('RIFFxxxxWEBP') }
  ])
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'firma local')
  assert.equal(zip.toString('ascii', 30, 30 + 'contents.json'.length), 'contents.json')
  const eocd = zip.length - 22
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50, 'fin del directorio central')
  assert.equal(zip.readUInt16LE(eocd + 10), 2, 'dos entradas')
})

test('el ZIP se puede abrir con unzip del sistema', (t) => {
  let dir
  try {
    dir = mkdtempSync(path.join(os.tmpdir(), 'zip-test-'))
    const file = path.join(dir, 'test.zip')
    writeFileSync(
      file,
      createZip([
        { name: 'contents.json', data: Buffer.from('{"sticker_packs":[]}') },
        { name: 'a.webp', data: Buffer.from('RIFF....WEBP') },
        { name: 'b.wasticker', data: Buffer.from('x') }
      ])
    )
    let output
    try {
      output = execFileSync('unzip', ['-l', file], { encoding: 'utf8' })
    } catch {
      t.skip('unzip no está disponible en este sistema')
      return
    }
    assert.match(output, /contents\.json/)
    assert.match(output, /a\.webp/)
    assert.match(output, /b\.wasticker/)
  } finally {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
})

test('createZip rechaza listas vacías', () => {
  assert.throws(() => createZip([]), /al menos un archivo/)
})

test('createZip usa flag UTF-8 para nombres no ascii', () => {
  const zip = createZip([{ name: 'sticker-ñ.webp', data: Buffer.from('x') }])
  assert.equal(zip.readUInt16LE(6), 0x0800)
})

test('los datos se pueden leer de vuelta', () => {
  const content = Buffer.from(JSON.stringify({ hola: '🌊' }))
  const zip = createZip([{ name: 'contents.json', data: content }])
  const nameLength = zip.readUInt16LE(26)
  const start = 30 + nameLength
  assert.deepEqual(zip.subarray(start, start + content.length), content)
})
