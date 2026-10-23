import { HttpError, fetchBuffer, fetchJson, postJson } from './http.js'
import { randomBytes } from 'node:crypto'

/**
 * 🔎 Búsqueda de stickers y paquetes.
 *
 * Fuente por defecto: la API móvil de **Sticker.ly**, que es donde están los
 * paquetes públicos y los privados (un paquete privado se abre con su código,
 * por ejemplo `https://sticker.ly/s/OD5GZR`).
 *
 * Esa API no está documentada y sus rutas cambian de vez en cuando, así que
 * acá se prueban varias rutas candidatas en orden y se recuerda la que
 * funcionó (igual que hace `lib/ai.js` con el gateway de OpenCode). Además la
 * respuesta se normaliza de forma tolerante: se recorren los objetos del JSON
 * buscando los que "parecen" un paquete o un sticker, sin depender de un
 * esquema fijo.
 *
 * Con `search.provider = "custom"` se puede apuntar a una API propia que
 * devuelva el mismo formato (`{ result: [...] }` o `{ data: [...] }`).
 */

const DEFAULT_TIMEOUT = 20000
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

export const DEFAULT_SEARCH_SETTINGS = {
  enabled: true,
  provider: 'stickerly',
  baseUrl: 'http://api.sticker.ly',
  customBaseUrl: '',
  // La API móvil solo responde a clientes que se identifican como la app.
  userAgent: 'androidapp.stickerly/1.17.3 (Redmi 7; U; Android 29; es-ES; es;)',
  referer: 'https://sticker.ly/',
  timeoutMs: DEFAULT_TIMEOUT,
  maxResults: 3,
  sessionMinutes: 10,
  packStickerLimit: 30,
  maxBytes: DEFAULT_MAX_BYTES,
  language: 'es'
}

/** Error con contexto para poder explicar qué falló sin volcar un stack */
export class SearchError extends Error {
  constructor(message, { status = null, url = '', code = 'search_failed' } = {}) {
    super(message)
    this.name = 'SearchError'
    this.status = status
    this.url = url
    this.code = code
  }
}

const clampInt = (value, min, max, fallback) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

/** Normaliza la sección `search` de config.json (o lo que llegue) */
export function searchSettings(config = {}) {
  const source = config?.search ?? config ?? {}
  const provider = String(source.provider || DEFAULT_SEARCH_SETTINGS.provider).toLowerCase()
  const baseUrl = String(
    provider === 'custom'
      ? source.customBaseUrl || source.baseUrl || ''
      : source.baseUrl || DEFAULT_SEARCH_SETTINGS.baseUrl
  )
    .trim()
    .replace(/\/+$/, '')

  return {
    ...DEFAULT_SEARCH_SETTINGS,
    ...source,
    provider: provider === 'custom' ? 'custom' : 'stickerly',
    baseUrl,
    customBaseUrl: String(source.customBaseUrl || '').trim().replace(/\/+$/, ''),
    userAgent: String(source.userAgent || DEFAULT_SEARCH_SETTINGS.userAgent),
    referer: String(source.referer || DEFAULT_SEARCH_SETTINGS.referer),
    timeoutMs: clampInt(source.timeoutMs, 2000, 120000, DEFAULT_TIMEOUT),
    maxResults: clampInt(source.maxResults, 1, 10, 3),
    sessionMinutes: clampInt(source.sessionMinutes, 1, 240, 10),
    packStickerLimit: clampInt(source.packStickerLimit, 1, 30, 30),
    maxBytes: clampInt(source.maxBytes, 256 * 1024, 32 * 1024 * 1024, DEFAULT_MAX_BYTES),
    language: String(source.language || 'es')
  }
}

/* ── generación de device ID ────────────────────────────────────────── */

/** Genera un device ID hexadecimal (16 caracteres) para el header `x-duid` */
export function generateDeviceId() {
  return randomBytes(8).toString('hex')
}

/* ── rutas candidatas ───────────────────────────────────────────────
 * Se prueban en orden; la primera que responde queda memorizada para no
 * pagar los 404 en cada búsqueda.
 *
 * Basado en la API real de Sticker.ly (verificada con scrapers funcionales
 * de 2025-2026):
 *   - Búsqueda: POST /v3.1/stickerPack/search?withAnimation=true
 *   - Detalle:  GET  /v3.1/stickerPack/{id}
 *   - Recomendados: GET /v3.1/stickerPack/recommend?withAnimation=true
 */

/** Rutas candidatas para búsqueda de packs (POST) */
const SEARCH_PACK_PATHS = [
  '/v3.1/stickerPack/search?withAnimation=true',
  '/v3.1/stickerPack/search',
  '/v3/stickerPack/search?withAnimation=true',
  '/v3/stickerPack/search',
  '/v2/search/pack'
]

/** Rutas candidatas para búsqueda de stickers individuales (GET) */
const SEARCH_STICKER_PATHS = [
  '/v3/search/sticker',
  '/v3.1/search/sticker',
  '/v3/search/stickers',
  '/v3.1/search/stickers',
  '/v2/search/sticker'
]

const PACK_INFO_PATHS = [
  '/v3.1/stickerPack/{id}',
  '/v3/stickerPack/{id}',
  '/v3.1/stickerpack/{id}',
  '/v3/pack/{id}'
]

const CUSTOM_PATHS = {
  stickers: ['/search/sticker', '/stickers/search', '/search/stickers'],
  packs: ['/search/pack', '/packs/search', '/search/packs'],
  packInfo: ['/packs/{id}', '/pack/{id}']
}

const preferredPath = { stickers: null, packs: null, packInfo: null }

/** Solo para tests: olvida la ruta que había funcionado */
export function resetSearchEndpoints() {
  preferredPath.stickers = null
  preferredPath.packs = null
  preferredPath.packInfo = null
}

function ordered(paths, kind) {
  const preferred = preferredPath[kind]
  if (!preferred || !paths.includes(preferred)) return paths
  return [preferred, ...paths.filter((path) => path !== preferred)]
}

/** Lista de URLs a probar para una búsqueda de stickers (GET fallback) */
export function searchEndpointCandidates({ kind = 'stickers', query = '', page = 1, limit = 3, config = {} } = {}) {
  const settings = searchSettings(config)
  const paths = settings.provider === 'custom'
    ? (kind === 'packs' ? CUSTOM_PATHS.packs : CUSTOM_PATHS.stickers)
    : (kind === 'packs' ? SEARCH_PACK_PATHS : SEARCH_STICKER_PATHS)

  return ordered(paths, kind).map((path) => {
    const params = new URLSearchParams({
      query,
      q: query,
      page: String(page),
      size: String(limit),
      limit: String(limit),
      lang: settings.language,
      language: settings.language
    })
    // Si el path ya tiene query string, unir con '&' en vez de duplicar '?'
    const separator = path.includes('?') ? '&' : '?'
    return `${settings.baseUrl}${path}${separator}${params.toString()}`
  })
}

/** Lista de URLs a probar para el detalle de un paquete */
export function packInfoEndpointCandidates(packId, { config = {} } = {}) {
  const settings = searchSettings(config)
  const id = String(packId || '').trim()
  const paths = settings.provider === 'custom' ? CUSTOM_PATHS.packInfo : PACK_INFO_PATHS
  const variants = [id, id.toUpperCase()]
  const urls = []
  for (const template of ordered(paths, 'packInfo')) {
    for (const variant of variants) {
      urls.push(`${settings.baseUrl}${template.replace('{id}', encodeURIComponent(variant))}`)
    }
  }
  return [...new Set(urls)]
}

/* ── identificación de códigos y enlaces ───────────────────────────── */

/**
 * Saca el código de un paquete desde un enlace de Sticker.ly o un código
 * suelto. Acepta `https://sticker.ly/s/OD5GZR`, `sticker.ly/s/od5gzr`,
 * `https://sticker.ly/pack/OD5GZR`, `sticker.ly/s/OD5GZR?utm=…` y `OD5GZR`.
 * @returns {string|null}
 */
export function parsePackId(input) {
  const text = String(input || '').trim()
  if (!text) return null

  const fromUrl = text.match(/sticker\.ly\/(?:s|pack|p)\/([A-Za-z0-9_-]{3,32})/i)
  if (fromUrl) return fromUrl[1].toUpperCase()

  // Un código suelto: alfanumérico, sin espacios ni palabras de comando
  if (/^[A-Za-z0-9_-]{3,32}$/.test(text) && /\d/.test(text)) return text.toUpperCase()
  if (/^[A-Za-z0-9_-]{3,32}$/.test(text) && /[A-Z]/.test(text) && /[a-z]/.test(text)) {
    return text.toUpperCase()
  }
  return null
}

/** Extensión del archivo a partir de la URL (sin querystring) */
export function stickerExtension(url = '') {
  const clean = String(url).split(/[?#]/)[0]
  const match = clean.match(/\.([a-z0-9]{2,5})$/i)
  const extension = match ? match[1].toLowerCase() : 'webp'
  return ['webp', 'png', 'gif', 'jpg', 'jpeg', 'mp4'].includes(extension) ? extension : 'webp'
}

/* ── extracción tolerante del JSON ────────────────────────────────── */

const MEDIA_FIELDS = [
  'url',
  'imageUrl',
  'image_url',
  'stickerUrl',
  'sticker_url',
  'fileUrl',
  'file_url',
  'mediaUrl',
  'media_url',
  'thumbnail',
  'thumbnailUrl',
  'thumbnail_url'
]

const MEDIA_EXTENSION = /\.(webp|png|gif|jpe?g)$/i

function looksLikeMediaUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) && MEDIA_EXTENSION.test(value.split('?')[0])
}

function allStrings(value) {
  return Object.values(value || {}).filter((item) => typeof item === 'string')
}

function mediaUrlOf(object, prefix = '') {
  for (const field of MEDIA_FIELDS) {
    if (looksLikeMediaUrl(object?.[field])) return object[field]
  }
  const fileName = object?.fileName || object?.file_name || object?.filename
  if (typeof fileName === 'string' && MEDIA_EXTENSION.test(fileName)) {
    const base =
      prefix ||
      object?.resourceUrlPrefix ||
      object?.resource_url_prefix ||
      object?.baseUrl ||
      object?.base_url ||
      ''
    if (base) return `${String(base).replace(/\/+$/, '')}/${fileName.replace(/^\/+/, '')}`
    if (/^https?:\/\//i.test(fileName)) return fileName
  }
  // Algún campo con pinta de URL de imagen (nombre desconocido)
  return allStrings(object).find(looksLikeMediaUrl) || null
}

/** Recorre cualquier estructura y devuelve todos los objetos encontrados */
function walkObjects(value, visit, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit, depth + 1)
    return
  }
  visit(value)
  for (const item of Object.values(value)) walkObjects(item, visit, depth + 1)
}

function pick(object, fields, fallback = '') {
  for (const field of fields) {
    const value = object?.[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return fallback
}

/** Normaliza un paquete (detalle `stickerPack` o resultado de búsqueda) */
export function normalizePack(raw = {}) {
  const result = raw?.result && typeof raw.result === 'object' && !Array.isArray(raw.result)
    ? { ...raw.result }
    : raw
  const prefix = String(
    result.resourceUrlPrefix ||
      result.resource_url_prefix ||
      result.prefix ||
      result.baseUrl ||
      result.base_url ||
      ''
  )

  const rawStickers = Array.isArray(result.stickers)
    ? result.stickers
    : Array.isArray(result.stickerList)
      ? result.stickerList
      : []

  const stickers = rawStickers
    .map((sticker) => {
      const url = mediaUrlOf(sticker, prefix)
      if (!url) return null
      const tags = Array.isArray(sticker?.tags)
        ? sticker.tags
        : Array.isArray(sticker?.emojis)
          ? sticker.emojis
          : []
      return {
        url,
        fileName: String(sticker?.fileName || url.split('/').pop() || 'sticker.webp'),
        animated: Boolean(sticker?.isAnimated ?? sticker?.animated ?? result.isAnimated ?? result.animated),
        tags: tags.filter((tag) => typeof tag === 'string')
      }
    })
    .filter(Boolean)

  const id = String(
    pick(result, ['packId', 'pack_id', 'id', 'code'], '') || ''
  ).toUpperCase()
  const name = String(pick(result, ['name', 'packName', 'pack_name', 'title'], id || 'Paquete'))
  const author = String(
    pick(result, ['authorName', 'author_name', 'author', 'publisher', 'username'], 'Sticker.ly')
  )
  const count = Number(
    pick(result, ['stickerCount', 'sticker_count', 'stickersCount', 'count', 'total'], stickers.length)
  )

  return {
    id,
    name,
    author,
    animated: Boolean(result.isAnimated ?? result.animated),
    count: Number.isFinite(count) && count > 0 ? count : stickers.length,
    thumbnail: mediaUrlOf(result, prefix) || stickers[0]?.url || null,
    url: id ? `https://sticker.ly/s/${id}` : '',
    stickers,
    source: 'stickerly'
  }
}

/** Normaliza los paquetes que vengan en una respuesta de búsqueda */
export function collectPacks(payload) {
  const found = new Map()
  walkObjects(payload, (object) => {
    const hasStickerList = Array.isArray(object.stickers) || Array.isArray(object.stickerList)
    const id = pick(object, ['packId', 'pack_id'], '')
    const looksLikePack =
      (id && (hasStickerList || object.stickerCount != null || object.name)) ||
      (hasStickerList && object.name)
    if (!looksLikePack) return
    const pack = normalizePack(object)
    if (!pack.id || found.has(pack.id)) return
    found.set(pack.id, pack)
  })
  return [...found.values()]
}

/** Normaliza stickers sueltos (búsqueda por sticker) */
export function collectStickers(payload) {
  const found = new Map()
  walkObjects(payload, (object) => {
    const url = mediaUrlOf(object, object?.resourceUrlPrefix || object?.resource_url_prefix || '')
    if (!url) return
    // Un paquete no es un sticker suelto
    if (Array.isArray(object.stickers) || Array.isArray(object.stickerList)) return
    const packId = String(pick(object, ['packId', 'pack_id'], '')).toUpperCase()
    const key = `${url}|${packId}`
    if (found.has(key)) return
    found.set(key, {
      url,
      packId,
      packName: String(pick(object, ['packName', 'pack_name', 'name', 'title'], '')),
      author: String(pick(object, ['authorName', 'author_name', 'author', 'publisher'], '')),
      animated: Boolean(object?.isAnimated ?? object?.animated),
      tags: (Array.isArray(object?.tags) ? object.tags : Array.isArray(object?.emojis) ? object.emojis : [])
        .filter((tag) => typeof tag === 'string')
    })
  })
  return [...found.values()]
}

/* ── llamadas HTTP ────────────────────────────────────────────────── */

function searchHeaders(settings) {
  return {
    'user-agent': settings.userAgent,
    accept: 'application/json',
    referer: settings.referer,
    'accept-language': settings.language,
    'x-duid': generateDeviceId(),
    connection: 'Keep-Alive'
  }
}

async function tryCandidates(urls, kind, { settings, logger } = {}) {
  const failures = []
  for (const url of urls) {
    try {
      const payload = await fetchJson(url, {
        timeoutMs: settings.timeoutMs,
        retries: 0,
        headers: searchHeaders(settings)
      })
      const path = url.slice(settings.baseUrl.length).split('?')[0]
      preferredPath[kind] = path
      return payload
    } catch (error) {
      failures.push(error)
      const status = error?.status
      // Si el servidor dijo "no autorizado" o "sin conexión" no tiene sentido
      // seguir probando rutas: es el mismo host.
      if (status === 401 || status === 403) break
      if (!status && /fetch failed|ENOTFOUND|ECONN|abort/i.test(String(error?.message || ''))) break
      logger?.debug?.(`búsqueda: ${url} falló (${error?.message || error})`)
    }
  }
  throw failures.at(-1) || new SearchError('La búsqueda no respondió.')
}

/**
 * Búsqueda de packs por POST (la API real de Sticker.ly usa POST con
 * { keyword, cursor } en vez de query params).
 */
async function tryPostSearch(query, cursor, { settings, logger } = {}) {
  const paths = ordered(SEARCH_PACK_PATHS, 'packs')
  const failures = []

  for (const pathTemplate of paths) {
    // Extraer el path sin query string para el POST
    const [pathBase] = pathTemplate.split('?')
    const hasAnimation = pathTemplate.includes('withAnimation=true')
    const url = `${settings.baseUrl}${pathBase}${hasAnimation ? '?withAnimation=true' : ''}`

    try {
      const payload = await postJson(url, {
        body: { keyword: query, cursor },
        timeoutMs: settings.timeoutMs,
        retries: 0,
        headers: searchHeaders(settings)
      })
      preferredPath.packs = pathTemplate
      return payload
    } catch (error) {
      failures.push(error)
      const status = error?.status
      if (status === 401 || status === 403) break
      if (!status && /fetch failed|ENOTFOUND|ECONN|abort/i.test(String(error?.message || ''))) break
      logger?.debug?.(`búsqueda POST: ${url} falló (${error?.message || error})`)
    }
  }
  throw failures.at(-1) || new SearchError('La búsqueda no respondió.')
}

async function search({ kind, query, page = 1, limit = 3, config, logger }) {
  const settings = searchSettings(config)
  if (!settings.enabled) {
    throw new SearchError('La búsqueda de stickers está desactivada (`search.enabled` en config.json).', {
      code: 'disabled'
    })
  }
  const text = String(query || '').trim()
  if (!text) {
    throw new SearchError('Escribe qué quieres buscar, por ejemplo: *.search gatitos*', {
      code: 'empty_query'
    })
  }
  if (!settings.baseUrl) {
    throw new SearchError(
      'Falta `search.baseUrl` (o `search.customBaseUrl` con provider "custom") en config.json.',
      { code: 'missing_base_url' }
    )
  }

  let payload

  if (kind === 'packs') {
    // Para búsqueda de packs, usar POST con la API real de Sticker.ly
    const cursor = Math.max(0, (page - 1))
    if (settings.provider === 'custom') {
      // Para proveedor custom, usar GET con query params (API genérica)
      const urls = searchEndpointCandidates({ kind, query: text, page, limit, config })
      payload = await tryCandidates(urls, kind, { settings, logger })
    } else {
      payload = await tryPostSearch(text, cursor, { settings, logger })
    }
    const packs = collectPacks(payload)
    return { query: text, page, kind, results: packs.slice(0, limit) }
  }

  // Para búsqueda de stickers individuales: primero intentar GET directo,
  // si falla, usar POST de packs y aplanar los stickers
  const urls = searchEndpointCandidates({ kind: 'stickers', query: text, page, limit, config })

  try {
    payload = await tryCandidates(urls, 'stickers', { settings, logger })
  } catch (error) {
    // Si falla la búsqueda directa de stickers, usar la búsqueda de packs
    // y aplanar los stickers de los paquetes encontrados
    logger?.debug?.(`búsqueda de stickers GET falló, usando POST de packs: ${error?.message || error}`)
    const cursor = Math.max(0, (page - 1))
    payload = await tryPostSearch(text, cursor, { settings, logger })
  }

  const stickers = collectStickers(payload)
  if (stickers.length) return { query: text, page, kind: 'stickers', results: stickers.slice(0, limit) }

  // Algunas respuestas de "sticker" traen paquetes con sus stickers: se
  // aplanan para poder enviar stickers igual.
  const packs = collectPacks(payload)
  const flat = packs.flatMap((pack) =>
    pack.stickers.map((sticker) => ({
      url: sticker.url,
      packId: pack.id,
      packName: pack.name,
      author: pack.author,
      animated: sticker.animated,
      tags: sticker.tags
    }))
  )
  return { query: text, page, kind: 'stickers', results: flat.slice(0, limit) }
}

/** Busca stickers sueltos */
export function searchStickers({ query, page = 1, limit, config, logger } = {}) {
  const settings = searchSettings(config)
  return search({
    kind: 'stickers',
    query,
    page,
    limit: clampInt(limit, 1, 10, settings.maxResults),
    config,
    logger
  })
}

/** Busca paquetes de stickers */
export function searchPacks({ query, page = 1, limit, config, logger } = {}) {
  const settings = searchSettings(config)
  return search({
    kind: 'packs',
    query,
    page,
    limit: clampInt(limit, 1, 10, Math.max(5, settings.maxResults)),
    config,
    logger
  })
}

/** Trae el detalle de un paquete por código o enlace (sirve para los privados) */
export async function resolvePack(input, { config, logger } = {}) {
  const settings = searchSettings(config)
  const packId = parsePackId(input) || String(input || '').trim().toUpperCase()
  if (!packId) throw new SearchError('Necesito el código del paquete (ej: *OD5GZR*) o su enlace.', { code: 'missing_pack_id' })

  const urls = packInfoEndpointCandidates(packId, { config })
  let payload
  try {
    payload = await tryCandidates(urls, 'packInfo', { settings, logger })
  } catch (error) {
    if (error?.status === 404) {
      throw new SearchError(
        `No encontré el paquete *${packId}*. Revisa el código: si es privado, tiene que estar compartido con enlace.`,
        { status: 404, code: 'pack_not_found' }
      )
    }
    throw error
  }

  const pack = normalizePack(payload)
  if (!pack.stickers.length) {
    throw new SearchError(`El paquete *${pack.name || packId}* no tiene stickers descargables.`, {
      code: 'empty_pack'
    })
  }
  if (!pack.id) pack.id = packId
  return pack
}

/** Descarga el archivo de un sticker (webp/png/gif) */
export async function downloadSticker(sticker, { config, logger } = {}) {
  const settings = searchSettings(config)
  const url = typeof sticker === 'string' ? sticker : sticker?.url
  if (!url) throw new SearchError('El sticker no tiene una URL descargable.', { code: 'no_url' })
  try {
    return await fetchBuffer(url, {
      timeoutMs: settings.timeoutMs,
      maxBytes: settings.maxBytes,
      retries: 1,
      headers: {
        'user-agent': settings.userAgent,
        referer: settings.referer,
        accept: 'image/webp,image/png,image/*,*/*'
      }
    })
  } catch (error) {
    logger?.debug?.(`descarga del sticker falló: ${url} (${error.message})`)
    throw error
  }
}

/** Mensaje claro para el usuario a partir del error real */
export function friendlySearchError(error, { provider = 'Sticker.ly' } = {}) {
  const raw = String(error?.message || error || '')
  // `HttpError` trae `.status`, pero algunos fallos (o errores ya formateados)
  // solo dicen el código en el texto: se aceptan las dos formas.
  const status = error?.status || Number(raw.match(/\b([45]\d{2})\b/)?.[1]) || null
  if (error?.code === 'disabled' || error?.code === 'empty_query' || error?.code === 'missing_pack_id') {
    return raw
  }
  if (error?.code === 'pack_not_found') return raw
  if (status === 401 || status === 403) {
    return `${provider} rechazó la búsqueda (${status}). Puede ser un bloqueo temporal de la red o de la IP del equipo.`
  }
  if (status === 404 || status === 405 || status === 501) {
    return `${provider} cambió la ruta de búsqueda (HTTP ${status}). Revisa \`search.baseUrl\` en config.json o usa el proveedor "custom".`
  }
  if (status === 429) return `${provider} está limitando los pedidos (HTTP 429). Espera un momento y vuelve a intentar.`
  if (/abort|timeout/i.test(raw)) return `La búsqueda tardó demasiado (${Math.round(Number(raw.match(/\d+/)?.[0]) || 0)}). Revisa el internet del equipo.`
  if (/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(raw)) {
    return `No hay conexión con ${provider}. Revisa el internet del equipo.`
  }
  return `No se pudo completar la búsqueda: ${raw}`
}

// `HttpError` se reexporta para que los comandos puedan distinguirlo
export { HttpError }
