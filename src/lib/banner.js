import crypto from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from '../config.js'
import { fetchBuffer } from './http.js'

const DRIVE_ID_PATTERNS = [
  /drive\.google\.com\/file\/d\/([\w-]{10,})/i,
  /drive\.google\.com\/(?:open|uc)\?(?:[^#]*?)id=([\w-]{10,})/i,
  /docs\.google\.com\/[^/]+\/d\/([\w-]{10,})/i,
  /[?&]id=([\w-]{10,})/
]

/** Extrae el ID de un enlace de Google Drive (o null) */
export function driveFileId(url) {
  const value = String(url ?? '')
  for (const pattern of DRIVE_ID_PATTERNS) {
    const match = value.match(pattern)
    if (match) return match[1]
  }
  return null
}

/**
 * URLs candidatas para descargar la imagen.
 * Los enlaces de Drive se convierten a descarga directa (varias variantes).
 */
export function imageCandidates(source) {
  const raw = String(source ?? '').trim()
  if (!raw) return []
  if (raw.startsWith('data:image/')) return [raw]
  if (!/^https?:\/\//i.test(raw)) return [raw] // ruta local

  const id = driveFileId(raw)
  if (id) {
    return [
      `https://drive.google.com/uc?export=download&id=${id}`,
      `https://lh3.googleusercontent.com/d/${id}=w1600`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      raw
    ]
  }
  return [raw]
}

/** Detecta el tipo real de imagen por sus primeros bytes */
export function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  if (buffer.toString('ascii', 0, 3) === 'GIF') return 'gif'
  return null
}

function localPathFor(source) {
  const candidate = path.isAbsolute(source) ? source : path.join(ROOT, source)
  return existsSync(candidate) ? candidate : null
}

function cachePaths(config, source) {
  const hash = crypto.createHash('sha1').update(String(source)).digest('hex').slice(0, 12)
  const dir = path.join(config.paths.data, 'cache')
  return { dir, file: path.join(dir, `menu-image-${hash}`) }
}

function readCached(file, ttlMs) {
  if (!existsSync(file)) return null
  try {
    if (ttlMs > 0 && Date.now() - statSync(file).mtimeMs > ttlMs) return null
    const buffer = readFileSync(file)
    const type = sniffImageType(buffer)
    return type ? { buffer, type } : null
  } catch {
    return null
  }
}

/**
 * Carga la imagen del menú (banner): archivo local, data URI o URL (incluido Drive).
 * Guarda una copia en caché para no depender de la red en cada menú.
 * @returns {Promise<{buffer:Buffer, type:string, source:string, fromCache:boolean}|null>}
 */
export async function loadMenuImage(config, { logger, force = false } = {}) {
  const settings = config.menu || {}
  const source = String(settings.image ?? '').trim()
  if (!source) return null

  // 1) Archivo local
  if (!/^https?:\/\//i.test(source) && !source.startsWith('data:')) {
    const file = localPathFor(source)
    if (!file) {
      logger?.warn?.(`La imagen del menú no existe: ${source}`)
      return null
    }
    const buffer = readFileSync(file)
    const type = sniffImageType(buffer)
    if (!type) {
      logger?.warn?.(`La imagen del menú no es válida: ${file}`)
      return null
    }
    return { buffer, type, source: file, fromCache: false }
  }

  // 2) data URI
  if (source.startsWith('data:')) {
    const base64 = source.split(',')[1] || ''
    const buffer = Buffer.from(base64, 'base64')
    const type = sniffImageType(buffer)
    return type ? { buffer, type, source: 'data-uri', fromCache: false } : null
  }

  // 3) Caché
  const cache = cachePaths(config, source)
  // imageCacheMinutes: 0 desactiva la lectura de caché (siempre descarga)
  const ttlMs = Math.max(0, Number(settings.imageCacheMinutes ?? 720)) * 60 * 1000
  if (!force && ttlMs > 0) {
    const cached = readCached(cache.file, ttlMs)
    if (cached) return { ...cached, source, fromCache: true }
  }

  // 4) Descarga (con variantes para enlaces de Drive)
  const timeoutMs = Number(settings.imageTimeoutMs ?? 25000)
  let lastError = null
  for (const url of imageCandidates(source)) {
    try {
      const buffer = await fetchBuffer(url, {
        timeoutMs,
        maxBytes: 10 * 1024 * 1024,
        retries: 0,
        headers: { accept: 'image/*,*/*' }
      })
      const type = sniffImageType(buffer)
      if (!type) throw new Error('el contenido descargado no es una imagen')
      mkdirSync(cache.dir, { recursive: true })
      writeFileSync(cache.file, buffer)
      return { buffer, type, source: url, fromCache: false }
    } catch (error) {
      lastError = error
      logger?.debug?.(`Banner: ${url} falló (${error.message})`)
    }
  }

  // 5) Última opción: caché vencida
  const stale = readCached(cache.file, 0)
  if (stale) {
    logger?.warn?.('Banner: no se pudo actualizar, se usa la copia en caché.')
    return { ...stale, source, fromCache: true }
  }

  logger?.warn?.(
    `No se pudo cargar la imagen del menú: ${lastError?.message || 'error desconocido'}. ` +
      'Revisa que el archivo de Drive sea público ("cualquiera con el enlace").'
  )
  return null
}

/** Borra la caché del banner (útil después de cambiar la imagen en Drive) */
export function clearMenuImageCache(config) {
  const dir = path.join(config.paths.data, 'cache')
  if (!existsSync(dir)) return 0
  let removed = 0
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('menu-image-')) continue
    try {
      rmSync(path.join(dir, name), { force: true })
      removed += 1
    } catch {
      /* ignora errores de permisos */
    }
  }
  return removed
}
