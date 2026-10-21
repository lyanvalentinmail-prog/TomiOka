import crypto from 'node:crypto'
import webpmux from 'node-webpmux'
import {
  auditSticker,
  injectExif,
  isWebpBuffer,
  readExifPayload,
  webpInfo
} from './webp.js'

const { Image } = webpmux

/**
 * Cabecera EXIF (TIFF/UserComment) que WhatsApp espera antes del JSON.
 *
 * Los bytes 14-17 son el *largo* del valor y los 18-21 el offset del valor
 * (22, justo después de esta cabecera). La cabecera de acá es la plantilla con
 * el largo en 0: hay que usar `buildExifChunk`, que lo completa. Si el largo
 * queda en 0, WhatsApp muestra "no se puede ver la información del sticker".
 */
export const EXIF_HEADER = Buffer.from([
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x16, 0x00, 0x00, 0x00
])

/** Offset del campo "largo del valor" dentro de la cabecera EXIF */
export const EXIF_LENGTH_OFFSET = 14

/**
 * Arma el contenido del chunk EXIF: cabecera + JSON del sticker, con el campo
 * de largo completado (en bytes UTF-8, no en caracteres).
 * @param {object} payload metadatos del sticker
 * @returns {Buffer}
 */
export function buildExifChunk(payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const exif = Buffer.alloc(EXIF_HEADER.length + json.length)
  EXIF_HEADER.copy(exif, 0)
  exif.writeUInt32LE(json.length, EXIF_LENGTH_OFFSET)
  json.copy(exif, EXIF_HEADER.length)
  return exif
}

export const DEFAULT_PACK = 'TomiOka'
export const DEFAULT_AUTHOR = '◢🌊◣ 𝕿𝖔𝖒𝖎𝖐𝖆'

export function newPackId() {
  return crypto.randomBytes(16).toString('hex')
}

/** Metadatos JSON que se guardan dentro del WebP */
export function buildExifPayload({
  packName = DEFAULT_PACK,
  packAuthor = DEFAULT_AUTHOR,
  emojis = [],
  packId = newPackId(),
  sourceUrl = '',
  isAnimated = false
} = {}) {
  return {
    'sticker-pack-id': packId,
    'sticker-pack-name': String(packName).slice(0, 60),
    'sticker-pack-publisher': String(packAuthor).slice(0, 60),
    emojis: Array.isArray(emojis) && emojis.length ? emojis.slice(0, 3) : ['🌊'],
    'android-app-store-link': 'https://play.google.com/store/apps/details?id=com.whatsapp',
    'ios-app-store-link': 'https://apps.apple.com/app/whatsapp-messenger/id310633997',
    'is-animated': Boolean(isAnimated),
    ...(sourceUrl ? { 'source-url': sourceUrl } : {})
  }
}

/**
 * Lee dimensiones / animación / metadatos de un WebP.
 * Usa el parser de chunks propio y, si algo falla, cae a node-webpmux.
 */
export async function readSticker(buffer) {
  const info = webpInfo(buffer)
  if (info) {
    return {
      animated: Boolean(info.animated),
      width: info.width,
      height: info.height,
      frameCount: info.frameCount,
      hasAlpha: info.hasAlpha,
      metadata: readExifPayload(buffer, EXIF_HEADER.length)
    }
  }

  // Respaldo con webpmux
  const image = new Image()
  await image.load(buffer)
  return {
    animated: Boolean(image.hasAnim),
    width: image.width,
    height: image.height,
    frameCount: image.frames?.length ?? 0,
    hasAlpha: Boolean(image.hasAlpha),
    metadata: readExifPayload(buffer, EXIF_HEADER.length)
  }
}

export async function isAnimatedWebp(buffer) {
  const info = webpInfo(buffer)
  if (info) return Boolean(info.animated)
  try {
    const image = new Image()
    await image.load(buffer)
    return Boolean(image.hasAnim)
  } catch {
    return false
  }
}

/**
 * Inserta/reemplaza los metadatos EXIF del sticker.
 *
 * Importante: NO re-muxea el archivo. Escribir los metadatos con node-webpmux
 * borraba el flag ALPHA del VP8X en los stickers animados y WhatsApp los
 * mostraba con fondo negro. Acá se copian todos los chunks tal cual y solo se
 * reemplaza el EXIF (corrigiendo el flag ALPHA y el fondo de la animación).
 *
 * @returns {Promise<Buffer>} nuevo webp
 */
export async function writeStickerMetadata(buffer, options = {}) {
  if (!isWebpBuffer(buffer)) {
    throw new Error('El archivo no es un WebP válido: no se le pueden escribir metadatos.')
  }

  const info = webpInfo(buffer)
  const payload = buildExifPayload({
    ...options,
    isAnimated: options.isAnimated ?? Boolean(info?.animated)
  })
  const exif = buildExifChunk(payload)

  const out = injectExif(buffer, exif)

  // Verificación: el sticker debe seguir siendo válido y conservar los cuadros
  const audit = auditSticker(out, { maxBytes: options.maxBytes ?? null })
  const framesOk = !info?.animated || audit.info?.frameCount === info.frameCount
  if (!audit.info || !framesOk) {
    throw new Error(
      `No se pudieron escribir los metadatos sin romper el sticker (${audit.issues.join(', ') || 'cuadros perdidos'})`
    )
  }
  if (audit.issues.length) {
    throw new Error(`El sticker quedó inválido: ${audit.issues.join(', ')}`)
  }

  return out
}

/**
 * Separa un WebP animado en cuadros individuales (WebP independientes).
 * Respaldo para cuando FFmpeg no sabe leer WebP animados.
 */
export async function demuxWebpFrames(buffer) {
  const info = webpInfo(buffer)
  const image = new Image()
  await image.load(buffer)
  if (!info?.animated && !image.hasAnim) {
    return { animated: false, frames: [buffer], delays: [100] }
  }
  const frames = await image.demux({ buffers: true })
  const delays = (image.frames || []).map((frame) => Number(frame.delay) || 100)
  return { animated: true, frames, delays }
}

/** Comprueba que el buffer sea realmente un WebP */
export function isWebp(buffer) {
  return isWebpBuffer(buffer)
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

export { auditSticker }
