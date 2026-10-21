import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { fetchBuffer } from './http.js'

const INDEX_VERSION = 1

/** "😀" -> "1f600" · "👨‍👩‍👧" -> "1f468-200d-1f469-200d-1f467" */
export function emojiToCodePoint(emoji) {
  return [...String(emoji ?? '')]
    .map((char) => char.codePointAt(0).toString(16))
    .join('-')
}

/** Limpia prefijos "u", mayúsculas y selectores de variación finales */
export function normalizeCode(code) {
  return String(code ?? '')
    .toLowerCase()
    .split('-')
    .map((part) => part.trim().replace(/^u\+?/, ''))
    .filter((part) => part && part !== 'fe0f')
    .join('-')
}

/** Variantes a probar para un emoji (con y sin selector de variación) */
export function codeVariants(emoji) {
  const exact = emojiToCodePoint(emoji)
  const normalized = normalizeCode(exact)
  return [...new Set([exact, normalized])]
}

/** "1f600" -> "😀" (para mostrar la combinación) */
export function codePointToEmoji(code) {
  try {
    const parts = String(code)
      .split('-')
      .filter(Boolean)
      .map((part) => parseInt(part, 16))
      .filter((value) => Number.isFinite(value))
    if (!parts.length) return ''
    return String.fromCodePoint(...parts)
  } catch {
    return ''
  }
}

export function pairKey(left, right) {
  return `${normalizeCode(left)}_${normalizeCode(right)}`
}

function readIndex(file, logger) {
  if (!existsSync(file)) return null
  try {
    const size = statSync(file).size
    if (size < 20) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !parsed.combos) return null
    return parsed
  } catch (error) {
    logger?.warn?.(`Índice de emojimix corrupto (${error.message}). Se reconstruirá.`)
    return null
  }
}

/**
 * Construye un índice liviano a partir del metadata.json de Emoji Kitchen.
 * Se guarda en caché para no volver a descargar 50 MB.
 */
export async function buildIndex({
  metadataUrl,
  mirrors = [],
  cacheFile,
  logger,
  timeoutMs = 180000
} = {}) {
  const urls = [metadataUrl, ...mirrors].filter(Boolean)
  let raw = null
  let usedUrl = null
  let lastError = null

  logger?.info?.('Descargando catálogo de Emoji Kitchen (solo la primera vez, ~50 MB)...')

  for (const url of urls) {
    try {
      raw = await fetchBuffer(url, { timeoutMs, maxBytes: 160 * 1024 * 1024, retries: 0 })
      usedUrl = url
      break
    } catch (error) {
      lastError = error
      logger?.warn?.(`No se pudo descargar ${url}: ${error.message}`)
    }
  }
  if (!raw) {
    throw new Error(
      `No se pudo descargar el catálogo de emojimix: ${lastError?.message || 'sin conexión'}`
    )
  }

  let json
  try {
    json = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`El catálogo de emojimix no es JSON válido: ${error.message}`)
  }
  raw = null

  const combos = {}
  const data = json?.data && typeof json.data === 'object' ? json.data : {}
  for (const [code, entry] of Object.entries(data)) {
    const combinations = entry?.combinations
    if (!combinations || typeof combinations !== 'object') continue
    for (const [other, list] of Object.entries(combinations)) {
      if (!Array.isArray(list) || list.length === 0) continue
      const latest = list.find((item) => item?.isLatest) || list[list.length - 1]
      if (!latest?.gStaticUrl) continue
      const left = normalizeCode(latest.leftEmojiCodepoint || code)
      const right = normalizeCode(latest.rightEmojiCodepoint || other)
      const key = `${left}_${right}`
      combos[key] = { url: latest.gStaticUrl, date: String(latest.date || '') }
    }
  }

  const index = {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    source: usedUrl,
    total: Object.keys(combos).length,
    combos
  }

  if (cacheFile) {
    const dir = path.dirname(cacheFile)
    mkdirSync(dir, { recursive: true })
    const tmp = `${cacheFile}.tmp`
    writeFileSync(tmp, JSON.stringify(index))
    renameSync(tmp, cacheFile)
  }

  logger?.info?.(`Catálogo de emojimix listo: ${index.total} combinaciones.`)
  return index
}

const state = { index: null, loading: null }

/**
 * Devuelve el índice (en memoria / caché / descarga).
 */
export async function ensureIndex(options = {}) {
  if (state.index) return state.index
  if (state.loading) return state.loading

  const { cacheFile, metadataUrl, mirrors = [], logger, timeoutMs } = options
  state.loading = (async () => {
    const cached = cacheFile ? readIndex(cacheFile, logger) : null
    if (cached && cached.version === INDEX_VERSION) {
      state.index = cached
      return cached
    }
    const built = await buildIndex({ metadataUrl, mirrors, cacheFile, logger, timeoutMs })
    state.index = built
    return built
  })()

  try {
    return await state.loading
  } finally {
    state.loading = null
  }
}

export function resetIndexCache() {
  state.index = null
  state.loading = null
}

/**
 * Busca la combinación de dos emojis.
 * @returns {{url:string, key:string}|null}
 */
export async function findMix(leftEmoji, rightEmoji, options = {}) {
  const index = await ensureIndex(options)
  const leftVariants = codeVariants(leftEmoji)
  const rightVariants = codeVariants(rightEmoji)

  for (const [a, b] of [
    [leftVariants, rightVariants],
    [rightVariants, leftVariants]
  ]) {
    for (const first of a) {
      for (const second of b) {
        const key = `${normalizeCode(first)}_${normalizeCode(second)}`
        const found = index.combos[key]
        if (found?.url) return { url: found.url, key, date: found.date }
      }
    }
  }
  return null
}

/** Combinación aleatoria del catálogo */
export async function randomMix(options = {}) {
  const index = await ensureIndex(options)
  const keys = Object.keys(index.combos)
  if (!keys.length) return null
  const key = keys[Math.floor(Math.random() * keys.length)]
  const found = index.combos[key]
  return { url: found.url, key, date: found.date }
}

/** Descarga la imagen PNG de la combinación */
export async function downloadMix(url, { timeoutMs = 30000 } = {}) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('URL de emojimix inválida')
  return fetchBuffer(url, { timeoutMs, maxBytes: 8 * 1024 * 1024, retries: 1 })
}

/** Información del índice para diagnóstico */
export function indexInfo(options = {}) {
  if (state.index) {
    return {
      loaded: true,
      total: state.index.total,
      createdAt: state.index.createdAt,
      source: state.index.source
    }
  }
  const cacheFile = options.cacheFile
  if (cacheFile && existsSync(cacheFile)) {
    return { loaded: false, cached: true, path: cacheFile }
  }
  return { loaded: false, cached: false }
}
