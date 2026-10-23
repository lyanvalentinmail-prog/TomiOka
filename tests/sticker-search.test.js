import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SearchError,
  collectPacks,
  collectStickers,
  downloadSticker,
  friendlySearchError,
  normalizePack,
  packInfoEndpointCandidates,
  parsePackId,
  resetSearchEndpoints,
  resolvePack,
  searchEndpointCandidates,
  searchPacks,
  searchSettings,
  searchStickers,
  stickerExtension
} from '../src/lib/sticker-search.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const stickerFile = readFileSync(path.join(here, 'fixtures/sticker-static.webp'))

const SEARCH_CONFIG = {
  search: {
    enabled: true,
    provider: 'stickerly',
    baseUrl: 'http://api.sticker.ly',
    userAgent: 'test-agent/1.0',
    timeoutMs: 5000,
    maxResults: 3,
    packStickerLimit: 30
  }
}

/** Respuesta JSON falsa */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

/**
 * Sustituye `fetch` por rutas controladas. Cada ruta es
 * [texto|RegExp, respuesta|función]. Devuelve las URLs pedidas.
 */
function stubFetch(routes) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    calls.push({ url: target, headers: options.headers || {}, method: options.method || 'GET' })
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

const PACK_DETAIL = {
  result: {
    name: 'chibi umaru anime',
    authorName: 'marinska',
    packId: 'OD5GZR',
    isAnimated: false,
    resourceVersion: 11,
    resourceUrlPrefix: 'https://stickerly.pstatic.net/sticker_pack/oWpnyLVms9NUiqUZJzktAA/OD5GZR/11/',
    stickers: [
      { fileName: '1786246945465.png', isAnimated: false, tags: ['anime', 'chibi'] },
      { fileName: '1786246945466.webp', isAnimated: true, tags: ['anime'] }
    ]
  }
}

const SEARCH_STICKERS_PAYLOAD = {
  result: {
    stickers: [
      {
        stickerId: 'a1',
        packId: 'AA11BB',
        packName: 'Gatitos',
        authorName: 'tomi',
        stickerUrl: 'https://cdn.example.com/sticker/uno.webp',
        isAnimated: false,
        tags: ['🐱']
      },
      {
        stickerId: 'a2',
        packId: 'AA11BB',
        packName: 'Gatitos',
        authorName: 'tomi',
        stickerUrl: 'https://cdn.example.com/sticker/dos.webp',
        isAnimated: false,
        tags: []
      }
    ]
  }
}

const SEARCH_PACKS_PAYLOAD = {
  result: {
    stickerPacks: [
      {
        packId: 'CC22DD',
        name: 'Gatos graciosos',
        authorName: 'michi',
        stickerCount: 12,
        isAnimated: false,
        thumbnailUrl: 'https://cdn.example.com/pack/cover.webp'
      },
      {
        packId: 'EE33FF',
        name: 'Perritos',
        authorName: 'tomi',
        stickerCount: 8,
        isAnimated: true,
        thumbnailUrl: 'https://cdn.example.com/pack/dog.webp'
      }
    ]
  }
}

test('parsePackId acepta enlaces de Sticker.ly y códigos sueltos', () => {
  assert.equal(parsePackId('https://sticker.ly/s/OD5GZR'), 'OD5GZR')
  assert.equal(parsePackId('sticker.ly/s/od5gzr'), 'OD5GZR')
  assert.equal(parsePackId('https://sticker.ly/pack/AB12CD?utm=1'), 'AB12CD')
  assert.equal(parsePackId('OD5GZR'), 'OD5GZR')
  assert.equal(parsePackId('abc123'), 'ABC123')
  assert.equal(parsePackId('gatitos'), null, 'una palabra en minúsculas es una búsqueda, no un código')
  assert.equal(parsePackId(''), null)
})

test('stickerExtension sale de la URL y cae en webp', () => {
  assert.equal(stickerExtension('https://x/y/foto.png'), 'png')
  assert.equal(stickerExtension('https://x/y/anima.WebP?sig=1'), 'webp')
  assert.equal(stickerExtension('https://x/y/video.mp4'), 'mp4')
  assert.equal(stickerExtension('https://x/y/sin-extension'), 'webp')
})

test('normalizePack arma los stickers con resourceUrlPrefix + fileName', () => {
  const pack = normalizePack(PACK_DETAIL)
  assert.equal(pack.id, 'OD5GZR')
  assert.equal(pack.name, 'chibi umaru anime')
  assert.equal(pack.author, 'marinska')
  assert.equal(pack.count, 2)
  assert.equal(pack.stickers.length, 2)
  assert.equal(
    pack.stickers[0].url,
    'https://stickerly.pstatic.net/sticker_pack/oWpnyLVms9NUiqUZJzktAA/OD5GZR/11/1786246945465.png'
  )
  assert.equal(pack.stickers[1].animated, true, 'respeta isAnimated del sticker')
  assert.deepEqual(pack.stickers[0].tags, ['anime', 'chibi'])
  assert.equal(pack.url, 'https://sticker.ly/s/OD5GZR')
})

test('collectPacks y collectStickers leen respuestas de búsqueda distintas', () => {
  const packs = collectPacks(SEARCH_PACKS_PAYLOAD)
  assert.equal(packs.length, 2)
  assert.deepEqual(packs.map((pack) => pack.id), ['CC22DD', 'EE33FF'])
  assert.equal(packs[0].count, 12)
  assert.equal(packs[1].animated, true)

  const stickers = collectStickers(SEARCH_STICKERS_PAYLOAD)
  assert.equal(stickers.length, 2)
  assert.equal(stickers[0].packName, 'Gatitos')
  assert.equal(stickers[0].url, 'https://cdn.example.com/sticker/uno.webp')
  assert.deepEqual(stickers[0].tags, ['🐱'])

  // Un paquete no se confunde con un sticker suelto
  assert.equal(collectStickers(PACK_DETAIL).length, 0)
})

test('searchEndpointCandidates arma URLs con query, página y tamaño', () => {
  const urls = searchEndpointCandidates({ kind: 'packs', query: 'gatos', page: 2, limit: 5, config: SEARCH_CONFIG })
  assert.ok(urls.length >= 3, 'prueba varias rutas')
  const first = new URL(urls[0])
  assert.equal(first.origin, 'http://api.sticker.ly')
  assert.equal(first.searchParams.get('query'), 'gatos')
  assert.equal(first.searchParams.get('page'), '2')
  assert.equal(first.searchParams.get('size'), '5')

  const packUrls = packInfoEndpointCandidates('od5gzr', { config: SEARCH_CONFIG })
  assert.ok(packUrls.some((url) => url.includes('/stickerPack/od5gzr')))
  assert.ok(packUrls.some((url) => url.includes('/stickerPack/OD5GZR')), 'prueba también en mayúsculas')
})

test('searchStickers normaliza la respuesta y recuerda la ruta que funciona', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([
    [/\/v3\/search\/sticker\?/, () => new Response('no', { status: 404 })],
    [/\/v3\.1\/search\/sticker\?/, SEARCH_STICKERS_PAYLOAD]
  ])
  try {
    const found = await searchStickers({ query: 'gatitos', limit: 2, config: SEARCH_CONFIG })
    assert.equal(found.query, 'gatitos')
    assert.equal(found.results.length, 2)
    assert.equal(found.results[0].url, 'https://cdn.example.com/sticker/uno.webp')
    assert.ok(stub.calls.some((call) => call.url.includes('/v3/search/sticker')))
    assert.ok(stub.calls.some((call) => call.url.includes('/v3.1/search/sticker')))
    assert.equal(stub.calls[0].headers['user-agent'], 'test-agent/1.0', 'se identifica como la app')
    assert.ok(stub.calls[0].headers['x-duid'], 'envía el device ID')

    // La segunda vez arranca por la ruta que funcionó (sin pagar el 404)
    stub.calls.length = 0
    await searchStickers({ query: 'perritos', limit: 1, config: SEARCH_CONFIG })
    assert.ok(stub.calls[0].url.includes('/v3.1/search/sticker'), 'recuerda la ruta buena')
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('searchPacks usa POST con keyword y cursor', async () => {
  resetSearchEndpoints()
  const stub = stubFetch([[/\/stickerPack\/search/, SEARCH_PACKS_PAYLOAD]])
  try {
    const found = await searchPacks({ query: 'gatos', limit: 1, config: SEARCH_CONFIG })
    assert.equal(found.results.length, 1)
    assert.equal(found.results[0].name, 'Gatos graciosos')
    assert.equal(found.results[0].id, 'CC22DD')
    // Verificar que usó POST
    const postCall = stub.calls.find((c) => c.method === 'POST')
    assert.ok(postCall, 'la búsqueda de packs usa POST')
    assert.ok(postCall.url.includes('/stickerPack/search'))
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('searchStickers aplana los paquetes cuando la búsqueda GET falla y cae en POST', async () => {
  resetSearchEndpoints()
  // GET falla (404), pero POST tiene packs con stickers
  const stub = stubFetch([
    // GET de stickers falla
    [/\/search\/sticker/, () => new Response('no', { status: 404 })],
    // POST de packs funciona
    [/\/stickerPack\/search/, {
      result: {
        stickerPacks: [{
          packId: 'AA11BB',
          name: 'Gatitos',
          authorName: 'tomi',
          isAnimated: false,
          resourceUrlPrefix: 'https://cdn.example.com/pack/AA11BB/1/',
          stickers: [
            { fileName: '1.webp', isAnimated: false, tags: ['🐱'] },
            { fileName: '2.webp', isAnimated: false, tags: ['😺'] }
          ]
        }]
      }
    }]
  ])
  try {
    const found = await searchStickers({ query: 'chibi', limit: 3, config: SEARCH_CONFIG })
    assert.equal(found.results.length, 2, 'usa los stickers del paquete')
    assert.equal(found.results[0].packName, 'Gatitos')
    assert.ok(found.results[0].url.endsWith('1.webp'))
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('resolvePack pide el detalle y explica cuando el código no existe', async () => {
  resetSearchEndpoints()
  const ok = stubFetch([[/\/stickerPack\/OD5GZR/, PACK_DETAIL]])
  try {
    const pack = await resolvePack('https://sticker.ly/s/OD5GZR', { config: SEARCH_CONFIG })
    assert.equal(pack.id, 'OD5GZR')
    assert.equal(pack.stickers.length, 2)
  } finally {
    ok.restore()
    resetSearchEndpoints()
  }

  const missing = stubFetch([]) // todo 404
  try {
    await assert.rejects(
      () => resolvePack('ZZ99ZZ', { config: SEARCH_CONFIG }),
      (error) => error instanceof SearchError && error.code === 'pack_not_found'
    )
  } finally {
    missing.restore()
    resetSearchEndpoints()
  }
})

test('downloadSticker baja el archivo con el user-agent de la app', async () => {
  const stub = stubFetch([
    [
      /sticker\/uno\.webp/,
      () => new Response(stickerFile, { status: 200, headers: { 'content-type': 'image/webp' } })
    ]
  ])
  try {
    const buffer = await downloadSticker({ url: 'https://cdn.example.com/sticker/uno.webp' }, { config: SEARCH_CONFIG })
    assert.ok(Buffer.isBuffer(buffer))
    assert.equal(buffer.length, stickerFile.length)
    assert.equal(stub.calls[0].headers['user-agent'], 'test-agent/1.0')
  } finally {
    stub.restore()
  }
})

test('searchStickers valida texto, estado y servidor', async () => {
  await assert.rejects(
    () => searchStickers({ query: '   ', config: SEARCH_CONFIG }),
    (error) => error instanceof SearchError && error.code === 'empty_query'
  )
  await assert.rejects(
    () => searchStickers({ query: 'gatos', config: { search: { ...SEARCH_CONFIG.search, enabled: false } } }),
    (error) => error instanceof SearchError && error.code === 'disabled'
  )
  const stub = stubFetch([[/./, () => new Response('boom', { status: 500 })]])
  try {
    await assert.rejects(() => searchStickers({ query: 'gatos', config: SEARCH_CONFIG }))
  } finally {
    stub.restore()
    resetSearchEndpoints()
  }
})

test('provider "custom" usa customBaseUrl y sus rutas', () => {
  const config = {
    search: {
      ...SEARCH_CONFIG.search,
      provider: 'custom',
      baseUrl: 'http://api.sticker.ly',
      customBaseUrl: 'https://mi-servidor.example/'
    }
  }
  const urls = searchEndpointCandidates({ kind: 'packs', query: 'gatos', config })
  assert.ok(urls.every((url) => url.startsWith('https://mi-servidor.example/')))
  assert.ok(urls.some((url) => url.includes('/search/pack')))
  const info = packInfoEndpointCandidates('ABC123', { config })
  assert.ok(info.some((url) => url.startsWith('https://mi-servidor.example/packs/ABC123')))
})

test('searchSettings normaliza y acota los valores', () => {
  const settings = searchSettings({
    search: { maxResults: 99, timeoutMs: 10, packStickerLimit: 500, sessionMinutes: 0 }
  })
  assert.equal(settings.maxResults, 10)
  assert.equal(settings.timeoutMs, 2000)
  assert.equal(settings.packStickerLimit, 30)
  assert.equal(settings.sessionMinutes, 1)
  assert.equal(settings.baseUrl, 'http://api.sticker.ly')
  assert.equal(searchSettings({ search: { baseUrl: 'http://x.example///' } }).baseUrl, 'http://x.example')
})

test('friendlySearchError explica cada falla en castellano', () => {
  assert.match(friendlySearchError(new Error('HTTP 404')), /cambió la ruta/i)
  assert.match(friendlySearchError(Object.assign(new Error('x'), { status: 404 })), /cambió la ruta/)
  assert.match(friendlySearchError(Object.assign(new Error('x'), { status: 429 })), /limitando/)
  assert.match(friendlySearchError(new Error('fetch failed')), /No hay conexión/)
  assert.match(friendlySearchError(new Error('This operation was aborted')), /tardó demasiado/)
  assert.match(friendlySearchError(new SearchError('e', { code: 'pack_not_found' })), /e/)
})
