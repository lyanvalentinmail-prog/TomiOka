import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { downloadToFile, fetchBuffer } from './http.js'

const INDEX_VERSION = 2

/**
 * Formato de las URLs del catálogo:
 * https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u1f600/u1f600_u1f525.png
 */
const KITCHEN_URL =
  /emojikitchen\/(\d{8})\/(u[0-9a-z-]+)\/(u[0-9a-z-]+)_(u[0-9a-z-]+)\.png/gi

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

/**
 * Extrae combinaciones de un fragmento de texto del metadata.json.
 * Es tolerante a cortes: solo descarta los últimos caracteres (overlap).
 * @param {string} text
 * @param {Map<string,{url:string,date:string}>} combos
 */
export function collectCombos(text, combos = new Map()) {
  if (!text) return combos
  KITCHEN_URL.lastIndex = 0
  for (const match of text.matchAll(KITCHEN_URL)) {
    const [, date, folder, left, right] = match
    const leftCode = normalizeCode(left)
    const rightCode = normalizeCode(right)
    const key = `${leftCode}_${rightCode}`
    const current = combos.get(key)
    if (!current || date > current.date) {
      combos.set(key, {
        url: `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${folder}/${left}_${right}.png`,
        left: leftCode,
        right: rightCode,
        date
      })
    }
  }
  return combos
}

/**
 * Lee el metadata.json en streaming y arma el índice de combinaciones.
 * No carga el archivo completo en memoria.
 */
export async function parseMetadataFile(file, { combos = new Map(), onProgress } = {}) {
  const total = statSync(file).size
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 })
  let carry = ''
  let read = 0

  for await (const chunk of stream) {
    read += Buffer.byteLength(chunk, 'utf8')
    const text = carry + chunk
    const cut = Math.max(0, text.length - 512)
    collectCombos(text.slice(0, cut), combos)
    carry = text.slice(cut)
    onProgress?.(read, total)
  }
  collectCombos(carry, combos)
  return combos
}

function serializeCombos(combos) {
  const out = {}
  for (const [key, value] of combos) {
    out[key] = { url: value.url, date: value.date }
  }
  return out
}

function readIndex(file, logger) {
  if (!existsSync(file)) return null
  try {
    if (statSync(file).size < 20) return null
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !parsed.combos) return null
    return parsed
  } catch (error) {
    logger?.warn?.(`Índice de emojimix corrupto (${error.message}). Se reconstruirá.`)
    return null
  }
}

/**
 * Descarga (en streaming) y comprime el catálogo de Emoji Kitchen en un índice liviano.
 */
export async function buildIndex({
  metadataUrl,
  mirrors = [],
  cacheFile,
  logger,
  timeoutMs = 600000
} = {}) {
  const urls = [metadataUrl, ...mirrors].filter(Boolean)
  const dir = cacheFile ? path.dirname(cacheFile) : path.join(process.cwd(), 'data')
  mkdirSync(dir, { recursive: true })
  const tempFile = path.join(dir, 'emojimix-metadata.json.tmp')

  let lastError = null
  let usedUrl = null
  let combos = new Map()

  for (const url of urls) {
    logger?.info?.('Descargando catálogo de Emoji Kitchen (una sola vez, ~95 MB)...')
    let lastLog = 0
    try {
      await downloadToFile(url, tempFile, {
        timeoutMs,
        onProgress: (received, total) => {
          if (!total) return
          const percent = Math.floor((received / total) * 100)
          if (percent >= lastLog + 10 || percent === 100) {
            lastLog = percent - (percent % 10)
            logger?.info?.(
              `  ${percent}% (${(received / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB)`
            )
          }
        }
      })
      logger?.info?.('  procesando catálogo...')
      combos = await parseMetadataFile(tempFile, { combos: new Map() })
      usedUrl = url
      if (combos.size > 0) break
      throw new Error('el catálogo llegó vacío o con un formato desconocido')
    } catch (error) {
      lastError = error
      logger?.warn?.(`No se pudo preparar el catálogo desde ${url}: ${error.message}`)
      combos = new Map()
    } finally {
      rmSync(tempFile, { force: true })
    }
  }

  if (!usedUrl || combos.size === 0) {
    throw new Error(
      `No se pudo descargar el catálogo de emojimix: ${lastError?.message || 'sin conexión'}`
    )
  }

  const index = {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    source: usedUrl,
    total: combos.size,
    combos: serializeCombos(combos)
  }
  // Libera el Map: el índice ya está en un objeto plano más compacto
  combos.clear()

  if (cacheFile) {
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
    if (cached && cached.version >= 1 && cached.combos) {
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
 * @returns {{url:string, key:string, date:string}|null}
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
