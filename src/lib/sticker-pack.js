/**
 * Paquete de stickers nativo de WhatsApp.
 *
 * En vez de mandar el `.wasticker` como archivo (que hay que importar a mano),
 * se arma el mensaje `stickerPackMessage`: WhatsApp muestra la tarjeta del
 * pack con el botón para agregarlo. El paquete viaja como ZIP cifrado y
 * subido a los servidores de WhatsApp con el tipo de media "sticker-pack".
 *
 * El formato sigue la implementación de referencia de Baileys (PR #1561):
 * un ZIP con los stickers nombrados por su hash, el ícono de la bandeja y los
 * metadatos del pack en el propio mensaje.
 */
import { createHash } from 'node:crypto'
import { stat, unlink } from 'node:fs/promises'
import {
  MEDIA_HKDF_KEY_MAPPING,
  MEDIA_PATH_MAP,
  encryptedStream,
  proto
} from '@whiskeysockets/baileys'
import { createZip } from './zip.js'

export const STICKER_PACK_MEDIA_TYPE = 'sticker-pack'
export const STICKER_PACK_PATH = '/mms/sticker-pack'
export const STICKER_PACK_HKDF = 'Sticker Pack'

/**
 * Baileys no conoce el tipo de media "sticker-pack"; sus tablas son objetos
 * exportados, así que los completamos una sola vez. Con esto `encryptedStream`
 * deriva las claves con el HKDF correcto ("WhatsApp Sticker Pack Keys") y
 * `waUploadToServer` sube el paquete a la ruta que espera WhatsApp.
 */
export function ensureStickerPackMediaTypes() {
  if (!MEDIA_PATH_MAP[STICKER_PACK_MEDIA_TYPE]) {
    MEDIA_PATH_MAP[STICKER_PACK_MEDIA_TYPE] = STICKER_PACK_PATH
  }
  if (!MEDIA_HKDF_KEY_MAPPING[STICKER_PACK_MEDIA_TYPE]) {
    MEDIA_HKDF_KEY_MAPPING[STICKER_PACK_MEDIA_TYPE] = STICKER_PACK_HKDF
  }
  return MEDIA_HKDF_KEY_MAPPING[STICKER_PACK_MEDIA_TYPE] === STICKER_PACK_HKDF
}

/**
 * `encryptedStream` devuelve antes de que el archivo termine de escribirse en
 * disco. Esperamos a que esté completo para no subir un paquete cortado.
 */
async function waitForFile(filePath, expectedBytes, timeoutMs = 10000) {
  const started = Date.now()
  for (;;) {
    try {
      const stats = await stat(filePath)
      if (stats.size >= expectedBytes) return stats.size
    } catch {
      /* todavía no existe */
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error('El paquete cifrado no terminó de escribirse a tiempo')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Nombre que WhatsApp espera dentro del ZIP: base64(sha256) + .webp */
export function packStickerFileName(buffer) {
  return `${createHash('sha256').update(buffer).digest('base64').replace(/\//g, '-')}.webp`
}

/**
 * Arma el ZIP del pack (el mismo formato que un `.wasticker`).
 * Incluye `contents.json` para que el archivo también sirva como respaldo
 * importable si el mensaje nativo no se puede enviar.
 */
export function buildStickerPackZip({
  stickers = [],
  tray = null,
  trayFileName,
  packId,
  name,
  publisher,
  description = ''
} = {}) {
  if (!stickers.length) throw new Error('El pack necesita al menos un sticker')
  if (!packId) throw new Error('Falta el id del pack')

  const files = []
  const contents = []

  for (const sticker of stickers) {
    const fileName = packStickerFileName(sticker.buffer)
    files.push({ name: fileName, data: sticker.buffer })
    contents.push({
      image_file: fileName,
      emojis: sticker.emojis?.length ? sticker.emojis.slice(0, 3) : ['🌊'],
      isAnimated: Boolean(sticker.animated)
    })
  }

  const trayIconFileName = tray ? trayFileName || `${packId}.webp` : null
  if (tray && trayIconFileName) files.push({ name: trayIconFileName, data: tray })

  const anyAnimated = contents.some((item) => item.isAnimated)
  files.unshift({
    name: 'contents.json',
    data: Buffer.from(
      JSON.stringify(
        {
          android_play_store_link: 'https://play.google.com/store/apps/details?id=com.whatsapp.stickers',
          ios_app_download_link: 'https://apps.apple.com/app/whatsapp-messenger/id310633997',
          image_data_version: '1',
          avoid_cache: false,
          sticker_packs: [
            {
              identifier: packId,
              name,
              publisher,
              publisher_email: '',
              publisher_website: '',
              privacy_policy_website: '',
              license_agreement_website: '',
              image_data_version: '1',
              ...(trayIconFileName ? { tray_image_file: trayIconFileName } : {}),
              animated_sticker_pack: anyAnimated,
              pack_description: description,
              stickers: contents
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    )
  })

  return {
    zip: createZip(files),
    files,
    trayIconFileName,
    stickers: contents.map(({ image_file, isAnimated, emojis }) => ({
      fileName: image_file,
      mimetype: 'image/webp',
      isAnimated,
      isLottie: false,
      emojis,
      accessibilityLabel: '‎'
    }))
  }
}

/**
 * Cifra y sube el ZIP y devuelve el `stickerPackMessage` listo para relay.
 *
 * @param {object} options
 * @param {Buffer} options.zip paquete (.wasticker) ya armado
 * @param {Array} options.stickers metadatos de los stickers
 * @param {string} options.trayIconFileName nombre del ícono dentro del ZIP
 * @param {Function} options.upload (filePath, opts) => {directPath}
 */
export async function prepareStickerPackMessage({
  packId,
  name,
  publisher,
  description = '',
  zip,
  stickers,
  trayIconFileName,
  logger,
  upload,
  mediaKeyTimestamp = Math.floor(Date.now() / 1000)
} = {}) {
  if (!zip?.length) throw new Error('Falta el paquete para enviar')
  if (!Array.isArray(stickers) || !stickers.length) throw new Error('El pack no tiene stickers')
  if (typeof upload !== 'function') throw new Error('No hay cómo subir el paquete')

  ensureStickerPackMediaTypes()

  const encrypted = await encryptedStream(zip, STICKER_PACK_MEDIA_TYPE, { logger })
  await waitForFile(encrypted.encFilePath, Math.ceil(zip.length / 16) * 16 + 10)

  let uploaded
  try {
    uploaded = await upload(encrypted.encFilePath, {
      mediaType: STICKER_PACK_MEDIA_TYPE,
      fileEncSha256B64: encrypted.fileEncSha256.toString('base64'),
      timeoutMs: 120000
    })
  } finally {
    await unlink(encrypted.encFilePath).catch(() => {})
  }

  const directPath = uploaded?.directPath || uploaded?.direct_path
  if (!directPath) throw new Error('WhatsApp no devolvió la ruta del paquete')

  return proto.Message.StickerPackMessage.fromObject({
    stickerPackId: packId,
    name,
    publisher,
    packDescription: description,
    stickerPackOrigin: proto.Message.StickerPackMessage.StickerPackOrigin.USER_CREATED,
    stickerPackSize: zip.length,
    stickers,
    fileSha256: encrypted.fileSha256,
    fileEncSha256: encrypted.fileEncSha256,
    mediaKey: encrypted.mediaKey,
    directPath,
    fileLength: encrypted.fileLength,
    mediaKeyTimestamp,
    ...(trayIconFileName ? { trayIconFileName } : {})
  })
}
