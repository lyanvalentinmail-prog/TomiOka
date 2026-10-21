import crypto from 'node:crypto'
import webpmux from 'node-webpmux'

const { Image } = webpmux

/** Cabecera EXIF que WhatsApp espera antes del JSON del sticker */
export const EXIF_HEADER = Buffer.from([
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x16, 0x00, 0x00, 0x00
])

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

/** Lee dimensiones / animación / metadatos de un WebP */
export async function readSticker(buffer) {
  const image = new Image()
  await image.load(buffer)
  const exif = image.exif
  let metadata = null
  if (exif && exif.length > EXIF_HEADER.length) {
    try {
      metadata = JSON.parse(exif.subarray(EXIF_HEADER.length).toString('utf8'))
    } catch {
      metadata = null
    }
  }
  return {
    animated: Boolean(image.hasAnim),
    width: image.width,
    height: image.height,
    metadata
  }
}

export async function isAnimatedWebp(buffer) {
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
 * @returns {Promise<Buffer>} nuevo webp
 */
export async function writeStickerMetadata(buffer, options = {}) {
  const image = new Image()
  await image.load(buffer)
  const payload = buildExifPayload({ ...options, isAnimated: Boolean(image.hasAnim) })
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  image.exif = Buffer.concat([EXIF_HEADER, json])
  const out = await image.save(null, { exif: true })
  if (!out || !Buffer.isBuffer(out)) {
    throw new Error('No se pudo escribir el sticker (webpmux devolvió un resultado vacío)')
  }
  return out
}

/**
 * Separa un WebP animado en cuadros individuales (WebP independientes).
 * Sirve de respaldo cuando FFmpeg no sabe leer WebP animados.
 */
export async function demuxWebpFrames(buffer) {
  const image = new Image()
  await image.load(buffer)
  if (!image.hasAnim) {
    return { animated: false, frames: [buffer], delays: [100] }
  }
  const frames = await image.demux({ buffers: true })
  const delays = (image.frames || []).map((frame) => Number(frame.delay) || 100)
  return { animated: true, frames, delays }
}

/** Comprueba que el buffer sea realmente un WebP */
export function isWebp(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}
