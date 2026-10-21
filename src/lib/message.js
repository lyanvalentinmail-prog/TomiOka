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
 * Descarga el media indicado.
 * @param {{message:object, key?:object}} source
 */
export async function downloadMedia(source, { sock, logger, maxBytes } = {}) {
  if (!source?.message) throw new Error('No hay contenido multimedia para descargar')
  const buffer = await downloadMediaMessage(
    { key: source.key || {}, message: source.message },
    'buffer',
    {},
    {
      logger,
      reuploadRequest: sock?.updateMediaMessage
    }
  )
  if (!buffer || !buffer.length) throw new Error('La descarga del archivo quedó vacía')
  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`El archivo supera el límite permitido (${Math.round(maxBytes / 1048576)} MB)`)
  }
  return buffer
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
