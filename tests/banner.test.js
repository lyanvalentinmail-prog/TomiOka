import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearMenuImageCache,
  driveFileId,
  imageCandidates,
  loadMenuImage,
  sniffImageType
} from '../src/lib/banner.js'
import { silentLogger, testConfig } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const png = readFileSync(path.join(here, 'fixtures/sample.png'))
const bannerPath = path.join(here, 'fixtures', 'sample.png')

const BANNER_DRIVE =
  'https://drive.google.com/file/d/1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV/view?usp=drivesdk'

function tempConfig(menu = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'banner-test-'))
  const config = testConfig()
  config.paths = { ...config.paths, data: dir }
  config.menu = { ...config.menu, ...menu }
  return { config, dir }
}

test('driveFileId reconoce los formatos de enlace de Drive', () => {
  assert.equal(driveFileId(BANNER_DRIVE), '1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV')
  assert.equal(
    driveFileId('https://drive.google.com/open?id=1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV'),
    '1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV'
  )
  assert.equal(
    driveFileId('https://drive.google.com/uc?export=download&id=1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV'),
    '1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV'
  )
  assert.equal(
    driveFileId('https://docs.google.com/uc?export=download&id=1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV'),
    '1dt870fo7a7X2DRsqY1DiK55NDKKA5JOV'
  )
  assert.equal(driveFileId('https://example.com/banner.jpg'), null)
  assert.equal(driveFileId(''), null)
})

test('imageCandidates arma variantes para Drive y URLs normales', () => {
  const drive = imageCandidates(BANNER_DRIVE)
  assert.equal(drive.length, 4)
  assert.match(drive[0], /^https:\/\/drive\.google\.com\/uc\?export=download&id=1dt870fo7a7/)
  assert.match(drive[1], /^https:\/\/lh3\.googleusercontent\.com\/d\/1dt870fo7a7/)
  assert.equal(drive.at(-1), BANNER_DRIVE)

  assert.deepEqual(imageCandidates('https://example.com/banner.jpg'), [
    'https://example.com/banner.jpg'
  ])
  assert.deepEqual(imageCandidates('tests/fixtures/sample.png'), ['tests/fixtures/sample.png'])
  assert.deepEqual(imageCandidates(''), [])
})

test('sniffImageType detecta png, jpg, webp y gif', () => {
  assert.equal(sniffImageType(png), 'png')
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpg')
  assert.equal(
    sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    'webp'
  )
  assert.equal(sniffImageType(Buffer.from('GIF89a0000000')), 'gif')
  assert.equal(sniffImageType(Buffer.from('<html>no soy imagen</html>')), null)
  assert.equal(sniffImageType(null), null)
})

test('loadMenuImage lee un banner local', async () => {
  const { config, dir } = tempConfig({ image: bannerPath })
  try {
    const image = await loadMenuImage(config, { logger: silentLogger })
    assert.ok(image)
    assert.equal(image.type, 'png')
    assert.deepEqual(image.buffer, png)
    assert.equal(image.fromCache, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadMenuImage soporta rutas relativas al proyecto', async () => {
  const { config, dir } = tempConfig({ image: 'tests/fixtures/sample.png' })
  try {
    const image = await loadMenuImage(config, { logger: silentLogger })
    assert.ok(image)
    assert.equal(image.type, 'png')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadMenuImage soporta data URI', async () => {
  const { config, dir } = tempConfig({
    image: `data:image/png;base64,${png.toString('base64')}`
  })
  try {
    const image = await loadMenuImage(config, { logger: silentLogger })
    assert.equal(image.type, 'png')
    assert.deepEqual(image.buffer, png)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadMenuImage descarga la URL y luego usa la caché', async () => {
  let hits = 0
  const server = createServer((request, response) => {
    hits += 1
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
    response.end(png)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/banner.png`
  const { config, dir } = tempConfig({ image: url, imageCacheMinutes: 60 })

  try {
    const first = await loadMenuImage(config, { logger: silentLogger })
    assert.equal(first.type, 'png')
    assert.equal(first.fromCache, false)
    assert.equal(hits, 1)

    const second = await loadMenuImage(config, { logger: silentLogger })
    assert.equal(second.fromCache, true, 'la segunda vez sale de la caché')
    assert.equal(hits, 1, 'no vuelve a pedir la imagen')

    const forced = await loadMenuImage(config, { logger: silentLogger, force: true })
    assert.equal(forced.fromCache, false)
    assert.equal(hits, 2)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadMenuImage usa la caché vencida si la red falla', async () => {
  const { config, dir } = tempConfig({ image: 'http://127.0.0.1:1/banner.png', imageCacheMinutes: 0 })
  try {
    // Simula una caché previa
    const cacheDir = path.join(dir, 'cache')
    mkdirSync(cacheDir, { recursive: true })
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha1').update(config.menu.image).digest('hex').slice(0, 12)
    writeFileSync(path.join(cacheDir, `menu-image-${hash}`), png)

    const image = await loadMenuImage(config, { logger: silentLogger })
    assert.ok(image)
    assert.equal(image.fromCache, true)
    assert.deepEqual(image.buffer, png)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadMenuImage devuelve null si la URL no es una imagen', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html>inicia sesión en Google</html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/banner`
  const { config, dir } = tempConfig({ image: url })
  try {
    const image = await loadMenuImage(config, { logger: silentLogger })
    assert.equal(image, null)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadMenuImage devuelve null sin imagen configurada o con archivo inexistente', async () => {
  const { config, dir } = tempConfig({ image: '' })
  try {
    assert.equal(await loadMenuImage(config, { logger: silentLogger }), null)
    config.menu.image = 'no-existe/banner.png'
    assert.equal(await loadMenuImage(config, { logger: silentLogger }), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clearMenuImageCache borra solo las imágenes del menú', async () => {
  const { config, dir } = tempConfig({ image: bannerPath })
  try {
    const cacheDir = path.join(dir, 'cache')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(path.join(cacheDir, 'menu-image-abc'), png)
    writeFileSync(path.join(cacheDir, 'otra-cosa.bin'), 'x')
    const removed = clearMenuImageCache(config)
    assert.equal(removed, 1)
    assert.equal(existsSync(path.join(cacheDir, 'menu-image-abc')), false)
    assert.equal(existsSync(path.join(cacheDir, 'otra-cosa.bin')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('imageCacheMinutes: 0 fuerza una descarga nueva en cada menú', async () => {
  let hits = 0
  const server = createServer((request, response) => {
    hits += 1
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
    response.end(png)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { config, dir } = tempConfig({
    image: `http://127.0.0.1:${server.address().port}/banner.png`,
    imageCacheMinutes: 0
  })
  try {
    await loadMenuImage(config, { logger: silentLogger })
    await loadMenuImage(config, { logger: silentLogger })
    assert.equal(hits, 2)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
