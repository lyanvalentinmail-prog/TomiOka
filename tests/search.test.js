import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from '../src/handler.js'
import { findCommand } from '../src/commands/index.js'
import { looksLikePackCode } from '../src/commands/searchpack.js'
import { parseSearchArgs } from '../src/commands/search.js'
import { SearchStore } from '../src/lib/searches.js'
import { resetSearchEndpoints } from '../src/lib/sticker-search.js'
import { commandContext, fakeSock, silentLogger, testConfig } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const sticker = readFileSync(path.join(here, 'fixtures/sticker-static.webp'))

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const webp = () => new Response(sticker, { status: 200, headers: { 'content-type': 'image/webp' } })

function stubFetch(routes) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    calls.push({ url: target, headers: options.headers || {} })
    for (const [matcher, responder] of routes) {
      const match = typeof matcher === 'string' ? target.includes(matcher) : matcher.test(target)
      if (!match) continue
      const value = typeof responder === 'function' ? await responder(target, options) : responder
      return value instanceof Response ? value : json(value)
    }
    return new Response('no encontrado', { status: 404 })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    }
  }
}

const STICKERS_PAYLOAD = {
  result: {
    stickers: [
      {
        stickerUrl: 'https://cdn.example.com/uno.webp',
        packId: 'AA11BB',
        packName: 'Gatitos',
        authorName: 'tomi',
        tags: ['🐱']
      },
      {
        stickerUrl: 'https://cdn.example.com/dos.webp',
        packId: 'AA11BB',
        packName: 'Gatitos',
        authorName: 'tomi',
        tags: []
      }
    ]
  }
}

const PACKS_PAYLOAD = {
  result: [
    { packId: 'CC22DD', name: 'Gatos graciosos', authorName: 'michi', stickerCount: 12, isAnimated: false },
    { packId: 'EE33FF', name: 'Perritos', authorName: 'tomi', stickerCount: 8, isAnimated: true }
  ]
}

const DETAIL_PAYLOAD = {
  result: {
    name: 'Gatos graciosos',
    authorName: 'michi',
    packId: 'CC22DD',
    resourceVersion: 3,
    resourceUrlPrefix: 'https://cdn.example.com/pack/CC22DD/3/',
    stickers: [
      { fileName: '1.webp', isAnimated: false, tags: ['🐱'] },
      { fileName: '2.webp', isAnimated: false, tags: ['😹'] }
    ]
  }
}

function searchConfig(overrides = {}) {
  const config = testConfig()
  config.search = {
    ...config.search,
    enabled: true,
    baseUrl: 'https://api.sticker.ly',
    userAgent: 'test-agent/1.0',
    timeoutMs: 5000,
    maxResults: 2,
    packStickerLimit: 30,
    ...overrides
  }
  return config
}

const sentOf = (sock, kind) => sock.sent.filter((item) => item.content?.[kind])
const textsOf = (sock) => sock.sent.filter((item) => typeof item.content?.text === 'string').map((item) => item.content.text)

test('parseSearchArgs separa texto, cantidad y página', () => {
  assert.deepEqual(parseSearchArgs('gatitos'), { query: 'gatitos', count: null, page: 1 })
  assert.deepEqual(parseSearchArgs('anime 5'), { query: 'anime', count: 5, page: 1 })
  assert.deepEqual(parseSearchArgs('-p 3 memes'), { query: 'memes', count: null, page: 3 })
  assert.deepEqual(parseSearchArgs('anime 99'), { query: 'anime 99', count: null, page: 1 }, 'más de 10 no es cantidad')
  assert.deepEqual(parseSearchArgs(''), { query: '', count: null, page: 1 })
})

test('looksLikePackCode distingue códigos de búsquedas', () => {
  assert.equal(looksLikePackCode('OD5GZR'), true)
  assert.equal(looksLikePackCode('https://sticker.ly/s/OD5GZR'), true)
  assert.equal(looksLikePackCode('gatitos'), false)
  assert.equal(looksLikePackCode('Anime'), false)
  assert.equal(looksLikePackCode('gatos graciosos'), false)
})

test('.search manda los stickers encontrados y cierra el progreso', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([
    [/\/search\/sticker/, STICKERS_PAYLOAD],
    [/cdn\.example\.com\/.*\.webp/, webp]
  ])
  try {
    const { ctx, sock } = commandContext('.search gatitos', { config: searchConfig() })
    const summary = await findCommand('search').run(ctx)

    assert.match(summary, /search "gatitos" 2 sticker/)
    assert.equal(sentOf(sock, 'sticker').length, 2, 'envía dos stickers')
    const texts = textsOf(sock)
    assert.ok(texts.some((text) => /Buscando \*gatitos\*/.test(text)), 'avisa que está buscando')
    assert.ok(texts.some((text) => /✅ \*2\* sticker/.test(text)), 'resume el resultado')
    assert.ok(texts.some((text) => /Gatitos/.test(text)), 'nombra el paquete de origen')
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('.search sin texto explica cómo usarlo', async () => {
  const { ctx } = commandContext('.search', { config: searchConfig() })
  await assert.rejects(() => findCommand('search').run(ctx), /Escribe qué quieres buscar/)
})

test('.search sin resultados no manda stickers y lo dice', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([[/\/search\/sticker/, { result: { stickers: [] } }]])
  try {
    const { ctx, sock } = commandContext('.search dinosaurio', { config: searchConfig() })
    const summary = await findCommand('search').run(ctx)
    assert.match(summary, /sin resultados/)
    assert.equal(sentOf(sock, 'sticker').length, 0)
    assert.ok(textsOf(sock).some((text) => /No encontré stickers/.test(text)))
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('.search explica el bloqueo del servicio', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([[/\/search\/sticker/, () => new Response('nope', { status: 403 })]])
  try {
    const { ctx } = commandContext('.search gatitos', { config: searchConfig() })
    await assert.rejects(() => findCommand('search').run(ctx), /rechazó la búsqueda \(403\)/)
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('.search respeta search.enabled = false', async () => {
  const { ctx } = commandContext('.search gatitos', { config: searchConfig({ enabled: false }) })
  await assert.rejects(() => findCommand('search').run(ctx), /desactivada/)
})

test('.searchpack lista paquetes y guarda la selección por chat', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([[/\/search\/pack/, PACKS_PAYLOAD]])
  try {
    const config = searchConfig()
    const store = createStore(config, silentLogger)
    const { ctx, sock } = commandContext('.searchpack gatitos', { config, store })
    const summary = await findCommand('searchpack').run(ctx)

    assert.match(summary, /2 paquete/)
    const texts = textsOf(sock)
    const list = texts.find((text) => text.includes('Paquetes de'))
    assert.ok(list, 'manda la lista')
    assert.match(list, /1️⃣ \*Gatos graciosos\*/)
    assert.match(list, /2️⃣ \*Perritos\*/)
    assert.match(list, /\.searchpack 1/)
    assert.match(list, /privado/)
    assert.equal(store.searches.get(ctx.chatJid).results.length, 2)
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('.searchpack <número> descarga el paquete elegido como .wasticker', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([
    [/\/search\/pack/, PACKS_PAYLOAD],
    [/\/stickerPack\/CC22DD/, DETAIL_PAYLOAD],
    [/cdn\.example\.com\/.*\.webp/, webp]
  ])
  try {
    const config = searchConfig()
    const store = createStore(config, silentLogger)
    const { ctx, sock } = commandContext('.searchpack gatitos', { config, store })
    await findCommand('searchpack').run(ctx)

    const second = commandContext('.searchpack 1', { config, store, sock })
    const summary = await findCommand('searchpack').run(second.ctx)

    assert.match(summary, /searchpack "Gatos graciosos" 2 sticker/)
    const documents = sentOf(sock, 'document')
    assert.equal(documents.length, 1, 'sin soporte nativo manda el .wasticker')
    assert.match(documents[0].content.fileName, /\.wasticker$/)
    assert.match(documents[0].content.caption, /Gatos graciosos/)
    const texts = textsOf(sock)
    assert.ok(texts.some((text) => /descargando \d+\/2/.test(text)), 'muestra el progreso')
    assert.ok(texts.some((text) => /✅ \*Gatos graciosos\* enviado/.test(text)))
    assert.equal(store.searches.get(ctx.chatJid), null, 'la selección se consume')
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('.searchpack envía el paquete nativo cuando WhatsApp lo permite', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([
    [/\/search\/pack/, PACKS_PAYLOAD],
    [/\/stickerPack\/CC22DD/, DETAIL_PAYLOAD],
    [/cdn\.example\.com\/.*\.webp/, webp]
  ])
  try {
    const config = searchConfig()
    const store = createStore(config, silentLogger)
    const sock = fakeSock()
    const relayed = []
    sock.waUploadToServer = async () => ({ directPath: '/v/test', mediaUrl: 'https://mmg.whatsapp.net/v/test' })
    sock.relayMessage = async (jid, message) => {
      relayed.push({ jid, message })
      return 'native-1'
    }

    const { ctx } = commandContext('.searchpack gatitos', { config, store, sock })
    await findCommand('searchpack').run(ctx)
    const second = commandContext('.searchpack 1', { config, store, sock })
    await findCommand('searchpack').run(second.ctx)

    assert.equal(relayed.length, 1, 'usa el mensaje nativo')
    assert.ok(relayed[0].message.stickerPackMessage, 'relayea un stickerPackMessage')
    assert.equal(relayed[0].message.stickerPackMessage.name, 'Gatos graciosos')
    assert.equal(sentOf(sock, 'document').length, 0, 'no manda el respaldo')
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('.searchpack get <código> importa un paquete privado por su código', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([
    [/\/stickerPack\/CC22DD/, DETAIL_PAYLOAD],
    [/cdn\.example\.com\/.*\.webp/, webp]
  ])
  try {
    const config = searchConfig()
    const { ctx, sock } = commandContext('.searchpack get CC22DD', { config })
    const summary = await findCommand('searchpack').run(ctx)
    assert.match(summary, /Gatos graciosos/)
    assert.equal(sentOf(sock, 'document').length, 1)
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('.searchpack 9 sin búsqueda previa explica el flujo', async () => {
  const config = searchConfig()
  const { ctx } = commandContext('.searchpack 9', { config })
  await assert.rejects(() => findCommand('searchpack').run(ctx), /No hay ninguna búsqueda reciente/)
})

test('.searchpack cancel limpia la búsqueda guardada', async () => {
  const config = searchConfig()
  const store = createStore(config, silentLogger)
  store.searches.save('59891111111@s.whatsapp.net', {
    query: 'gatos',
    kind: 'packs',
    results: [{ id: 'CC22DD', name: 'Gatos' }]
  })
  const { ctx, sock } = commandContext('.searchpack cancel', { config, store })
  await findCommand('searchpack').run(ctx)
  assert.equal(store.searches.get('59891111111@s.whatsapp.net'), null)
  assert.ok(textsOf(sock).some((text) => /Búsqueda descartada/.test(text)))
})

test('.searchpack sin argumentos muestra los ejemplos', async () => {
  const { ctx } = commandContext('.searchpack', { config: searchConfig() })
  await assert.rejects(() => findCommand('searchpack').run(ctx), /Dime qué paquete buscas/)
})

test('SearchStore vence las búsquedas y recorta el tamaño', () => {
  let now = 1_000_000
  const store = new SearchStore({ ttlMinutes: 1, maxEntries: 2, now: () => now })
  store.save('a@s', { query: 'uno', results: [{ id: 'A' }] })
  assert.equal(store.get('a@s').query, 'uno')
  assert.deepEqual(store.pick('a@s', 1).item, { id: 'A' })
  assert.equal(store.pick('a@s', 2).item, null)

  now += 61_000
  assert.equal(store.get('a@s'), null, 'vence sola')

  store.save('a@s', { results: [{ id: '1' }] })
  store.save('b@s', { results: [{ id: '2' }] })
  store.save('c@s', { results: [{ id: '3' }] })
  assert.equal(store.size, 2, 'respeta maxEntries')
  assert.equal(store.get('a@s'), null, 'saca la más vieja')
})
