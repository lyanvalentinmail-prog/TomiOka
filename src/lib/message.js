import {
  downloadMediaMessage,
  getContentType,
  normalizeMessageContent
} from '@whiskeysockets/baileys'

const KIND_BY_TYPE = {
  imageMessage: 'image',
  videoMessage: 'video',
  stickerMessage: 'sticker',
  documentMessage: 'document',
  audioMessage: 'audio',
  ptvMessage: 'video'
}

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/heic': 'heic'
}

/** Contenido real del mensaje (desenvuelve efímeros, ver una vez, etc.) */
export function getContent(message) {
  return normalizeMessageContent(message?.message)
}

export function getMessageType(message) {
  const content = getContent(message)
  return content ? getContentType(content) : undefined
}

/** Texto del mensaje o del pie de foto/video/documento */
export function getText(message) {
  const content = getContent(message)
  if (!content) return ''
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.ptvMessage?.caption ||
    ''
  )
}

/** Devuelve el objeto de media (imagen/video/sticker/documento) del contenido */
export function getMediaContent(content) {
  if (!content) return null
  const type = getContentType(content)
  const kind = KIND_BY_TYPE[type]
  if (!kind) return null
  return { kind, type, media: content[type] }
}

/** Datos del mensaje citado (si existe) */
export function getQuoted(message) {
  const content = getContent(message)
  if (!content) return null
  const type = getContentType(content)
  const contextInfo = content[type]?.contextInfo
  const quotedMessage = contextInfo?.quotedMessage
  if (!quotedMessage) return null

  const normalized = normalizeMessageContent(quotedMessage)
  const media = getMediaContent(normalized)
  return {
    key: {
      remoteJid: message.key.remoteJid,
      fromMe: contextInfo.participant === message.key.remoteJid ? false : undefined,
      id: contextInfo.stanzaId,
      participant: contextInfo.participant
    },
    participant: contextInfo.participant,
    message: quotedMessage,
    content: normalized,
    text: getText({ message: quotedMessage }),
    ...(media || {})
  }
}

/** Extensión a partir del mimetype o del nombre de archivo */
export function extensionFor({ mimetype, fileName } = {}) {
  const mime = String(mimetype || '').toLowerCase().split(';')[0].trim()
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]
  const fromName = String(fileName || '').split('.').pop()
  if (fromName && fromName.length <= 5 && fromName !== fileName) return fromName.toLowerCase()
  if (mime.startsWith('video/')) return 'mp4'
  if (mime.startsWith('image/')) return 'jpg'
  return 'bin'
}

/**
 * Descarga el media indicado, con un reintento para los medios "viejos"
 * que WhatsApp a veces no entrega a la primera.
 * @param {{message:object, key?:object}} source
 */
export async function downloadMedia(source, { sock, logger, maxBytes, retries = 1 } = {}) {
  if (!source?.message) throw new Error('No hay contenido multimedia para descargar')

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const buffer = await downloadMediaMessage(
        { key: source.key || {}, message: source.message },
        'buffer',
        {},
        {
          logger,
          reuploadRequest:
            typeof sock?.updateMediaMessage === 'function'
              ? sock.updateMediaMessage.bind(sock)
              : undefined
        }
      )
      if (!buffer || !buffer.length) throw new Error('descarga vacía')
      if (maxBytes && buffer.length > maxBytes) {
        throw new Error(
          `El archivo pesa ${(buffer.length / 1048576).toFixed(1)} MB y el límite es ` +
            `${Math.round(maxBytes / 1048576)} MB (config: stickers.maxInputMB).`
        )
      }
      return buffer
    } catch (error) {
      lastError = error
      // No reintentar si el archivo es demasiado grande
      if (String(error.message).includes('el límite es')) throw error
      logger?.warn?.(`Descarga falló (intento ${attempt + 1}/${retries + 1}): ${error.message}`)
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }

  const detail = String(lastError?.message || lastError || '').slice(0, 160)
  throw new Error(
    `No pude descargar el archivo de WhatsApp${detail ? ` (${detail})` : ''}. ` +
      'Suele pasar con medios muy viejos o reenviados: reenvíalo otra vez, o guárdalo y mándalo como documento. ' +
      'Si se repite con todo, revisa que la sesión siga activa (npm run doctor).'
  )
}

/** Tipo de media de un mensaje citado o del mensaje actual */
export function resolveMediaTarget(context) {
  if (context.quoted?.kind) {
    return {
      kind: context.quoted.kind,
      type: context.quoted.type,
      media: context.quoted.media,
      message: context.quoted.message,
      key: context.quoted.key,
      origin: 'quoted'
    }
  }
  if (context.current?.kind) {
    return {
      kind: context.current.kind,
      type: context.current.type,
      media: context.current.media,
      message: context.message.message,
      key: context.message.key,
      origin: 'message'
    }
  }
  return null
}
