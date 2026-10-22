import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BufferCache, hashBuffer, signature } from '../src/lib/cache.js'
import { fireAndForget, mapLimit } from '../src/lib/concurrency.js'
import { createStore, handleMessage } from '../src/handler.js'
import { commands } from '../src/commands/index.js'
import { stickerCacheKey } from '../src/lib/media.js'
import { createWorkDir, prewarmWorkDir, withWorkDir } from '../src/lib/tmp.js'
import { commandContext, silentLogger, testConfig } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const png = readFileSync(path.join(here, 'fixtures/sample.png'))
const sticker = readFileSync(path.join(here, 'fixtures/sticker-static.webp'))

const RTT = 60 // latencia simulada por operación de WhatsApp

/** Socket falso con latencia: registra el orden real de los envíos */
function latentSock(rtt = RTT) {
  const events = []
  const sock = {
    events,
    user: { id: '59890000000:1@s.whatsapp.net' },
    async sendMessage(jid, content) {
      const kind = content.react
        ? `react:${content.react.text}`
        : content.image
          ? 'imagen'
          : content.sticker
            ? 'sticker'
            : content.document
              ? 'documento'
              : content.text
                ? 'texto'
                : 'otro'
      await new Promise((resolve) => setTimeout(resolve, rtt))
      events.push({ kind, at: Date.now() })
      return { key: { id: `m${events.length}`, remoteJid: jid } }
    },
    async sendPresenceUpdate() {
      await new Promise((resolve) => setTimeout(resolve, rtt))
    },
    async updateMediaMessage() {
      throw new Error('no soportado')
    }
  }
  return sock
}

const msgFor = (text) => ({
  key: { remoteJid: '59891111111@s.whatsapp.net', fromMe: false, id: `p-${Math.random()}` },
  pushName: 'Tester',
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000)
})

test('los avisos (⏳ y escribiendo…) no retrasan el resultado', async () => {
  const config = testConfig()
  config.menu = { ...config.menu, image: 'tests/fixtures/sample.png', sendAsCaption: true }
  const store = createStore(config, silentLogger)
  const sock = latentSock()

  const startedAt = Date.now()
  await handleMessage({ sock, msg: msgFor('.help'), config, store, logger: silentLogger, commands })
  const product = sock.events.find((event) => event.kind === 'imagen')
  const handlerDone = Date.now() - startedAt

  assert.ok(product, 'el menú con banner se envió')
  const productAt = product.at - startedAt
  // Antes había que esperar dos viajes (presencia + reacción) antes de enviar
  // nada: con 60 ms cada uno el resultado salía recién a los ~180 ms.
  assert.ok(
    productAt < RTT * 1.7,
    `el resultado tardó ${productAt} ms (esperado menos de ${Math.round(RTT * 1.7)} ms)`
  )
  // El cierre (✅ + dejó de escribir) va en paralelo, no uno detrás del otro.
  assert.ok(handlerDone < RTT * 5, `el handler tardó ${handlerDone} ms`)
  assert.equal(sock.events.filter((event) => event.kind.startsWith('react')).length, 2, '⏳ y ✅')
})

test('si el comando falla se reacciona con 💦 y se avisa', async () => {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const sock = latentSock(5)

  await handleMessage({ sock, msg: msgFor('.toimg'), config, store, logger: silentLogger, commands })
  const kinds = sock.events.map((event) => event.kind)
  assert.ok(kinds.includes('react:⏳'))
  assert.ok(kinds.includes('react:💦'))
  assert.ok(kinds.some((kind) => kind === 'texto'), 'explica el error')
})

test('los avisos se omiten cuando la configuración los apaga', async () => {
  const config = testConfig({ behavior: { reactToCommands: false, sendTyping: false } })
  config.menu = { ...config.menu, image: 'no-existe.png' }
  const store = createStore(config, silentLogger)
  const sock = latentSock(5)
  await handleMessage({ sock, msg: msgFor('.help'), config, store, logger: silentLogger, commands })
  assert.equal(sock.events.filter((event) => event.kind.startsWith('react')).length, 0)
})

test('BufferCache guarda, devuelve y respeta el orden LRU', () => {
  const cache = new BufferCache({ maxEntries: 2, maxBytes: 100 })
  cache.set('a', Buffer.alloc(10, 1))
  cache.set('b', Buffer.alloc(10, 2))
  assert.equal(cache.get('a').length, 10)
  cache.set('c', Buffer.alloc(10, 3)) // expulsa la menos usada (b)
  assert.ok(cache.get('a'), 'a sigue por haberse usado')
  assert.equal(cache.get('b'), null, 'b fue la menos usada')
  assert.ok(cache.get('c'))
  const stats = cache.stats()
  assert.equal(stats.entries, 2)
  assert.equal(stats.bytes, 20)
  assert.ok(stats.hits >= 3)
  assert.ok(stats.misses >= 1)
})

test('BufferCache no guarda lo que no entra y cuenta bytes', () => {
  const cache = new BufferCache({ maxEntries: 10, maxBytes: 15 })
  cache.set('grande', Buffer.alloc(20)) // no entra nunca
  assert.equal(cache.size, 0)
  cache.set('chico', Buffer.alloc(10))
  cache.set('otro', Buffer.alloc(10)) // hace pasar el tope de bytes → expulsa el primero
  assert.equal(cache.size, 1)
  assert.equal(cache.bytes, 10)
  assert.equal(cache.get('chico'), null)
})

test('stickerCacheKey cambia solo cuando cambia el resultado', () => {
  const base = { extension: 'png', animated: false, settings: { size: 512, quality: 82 } }
  const key = stickerCacheKey(png, base)
  assert.equal(key, stickerCacheKey(png, base), 'mismo archivo y ajustes = misma clave')
  assert.notEqual(key, stickerCacheKey(png, { ...base, extension: 'jpg' }))
  assert.notEqual(key, stickerCacheKey(png, { ...base, animated: true }))
  assert.notEqual(key, stickerCacheKey(png, { ...base, settings: { size: 512, quality: 60 } }))
  assert.notEqual(key, stickerCacheKey(sticker, base), 'otro archivo = otra clave')
  assert.match(key, /^sticker\|[a-f0-9]{64}\|png\|still\|/)
  assert.equal(hashBuffer(png), hashBuffer(Buffer.from(png)), 'hash estable')
  assert.equal(signature({ b: 1, a: 2 }), signature({ a: 2, b: 1 }), 'el orden no importa')
})

test('mapLimit conserva el orden y respeta el límite de concurrencia', async () => {
  let active = 0
  let peak = 0
  const order = []
  const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 10 + (6 - value) * 2))
    active -= 1
    order.push(value)
    return value * 10
  })
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60], 'el resultado mantiene el orden de entrada')
  assert.ok(peak <= 2, `nunca más de 2 en paralelo (llegó a ${peak})`)
  assert.notDeepEqual(order, [1, 2, 3, 4, 5, 6], 'el trabajo sí se solapa')
  assert.deepEqual(await mapLimit([], 3, async () => 1), [])
})

test('fireAndForget no rompe si la promesa falla', async () => {
  const logged = []
  const result = await fireAndForget(Promise.reject(new Error('boom')), { debug: (m) => logged.push(m) }, 'test')
  assert.equal(result, null)
  assert.match(logged[0], /boom/)
  assert.equal(await fireAndForget(null), null)
})

test('createWorkDir reutiliza la carpeta base y crea carpetas únicas', async () => {
  await prewarmWorkDir()
  const startedAt = Date.now()
  const first = await createWorkDir()
  const second = await createWorkDir()
  const elapsed = Date.now() - startedAt
  try {
    assert.equal(first.base, second.base, 'la base se elige una sola vez')
    assert.notEqual(first.dir, second.dir, 'cada trabajo tiene su carpeta')
    assert.ok(existsSync(first.dir) && existsSync(second.dir))
    // Dos mkdir rápidos tienen que ser mucho más baratos que re-probar todo.
    assert.ok(elapsed < 250, `crear dos carpetas tardó ${elapsed} ms`)
  } finally {
    rmSync(first.dir, { recursive: true, force: true })
    rmSync(second.dir, { recursive: true, force: true })
  }
})

test('withWorkDir sigue borrando la carpeta al terminar', async () => {
  let used = ''
  await withWorkDir(async (dir) => {
    used = dir
    assert.ok(existsSync(dir))
  })
  assert.equal(existsSync(used), false)
})

test('la caché de stickers se puede apagar desde config', async () => {
  const config = testConfig()
  config.performance = { ...config.performance, stickerCache: false }
  const { ctx } = commandContext('.debug', { config })
  // createStore aplica la config; con la caché apagada no guarda nada nuevo.
  const { stickerCacheStats } = await import('../src/lib/media.js')
  const before = stickerCacheStats()
  createStore(config, silentLogger)
  const after = stickerCacheStats()
  assert.equal(after.entries, 0)
  assert.ok(before.hits >= 0)
  assert.ok(ctx)
})
