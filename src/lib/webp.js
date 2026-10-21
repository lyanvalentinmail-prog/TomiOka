/**
 * Manipulación de WebP a nivel de bytes (chunks RIFF).
 *
 * Se usa para escribir los metadatos del sticker SIN re-muxear el archivo:
 * re-muxear con node-webpmux borraba el flag ALPHA del chunk VP8X en los
 * stickers animados, y WhatsApp los mostraba con fondo negro ("sticker
 * bugueado"). Acá solo se toca el chunk EXIF y los flags, y todo lo demás
 * (ANIM, ANMF, ALPH, VP8) queda byte por byte igual.
 */

export const VP8X_FLAGS = {
  ICCP: 0x20,
  ALPHA: 0x10,
  EXIF: 0x08,
  XMP: 0x04,
  ANIM: 0x02
}

export const ANIM_CHUNK = 'ANIM'
export const EXIF_CHUNK = 'EXIF'

const CHUNK_IDS = new Set(['VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L', 'EXIF', 'XMP '])

/** ¿Es un WebP válido (RIFF/WEBP)? */
export function isWebpBuffer(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 20 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
}

/**
 * Lee los chunks de un WebP.
 * @returns {{valid:boolean, size:number, declaredSize:number, chunks:Array<{id:string,size:number,data:Buffer}>}}
 */
export function parseWebp(buffer) {
  if (!isWebpBuffer(buffer)) {
    return { valid: false, size: buffer?.length ?? 0, declaredSize: 0, chunks: [] }
  }

  const declaredSize = buffer.readUInt32LE(4) + 8
  const chunks = []
  let offset = 12

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + size
    if (dataEnd > buffer.length) break
    chunks.push({ id, size, data: buffer.subarray(dataStart, dataEnd) })
    offset = dataEnd + (size & 1)
  }

  return {
    valid: true,
    size: buffer.length,
    declaredSize,
    sizeMismatch: declaredSize !== buffer.length,
    chunks
  }
}

/** Chunks internos de un frame ANMF (VP8/VP8L/ALPH) */
export function parseAnmfFrame(data) {
  if (!Buffer.isBuffer(data) || data.length < 16) return null
  const frame = {
    x: data.readUIntLE(0, 3) * 2,
    y: data.readUIntLE(3, 3) * 2,
    width: data.readUIntLE(6, 3) + 1,
    height: data.readUIntLE(9, 3) + 1,
    delay: data.readUIntLE(12, 3),
    blend: !(data[15] & 0b00000010),
    dispose: Boolean(data[15] & 0b00000001),
    chunks: []
  }
  let offset = 16
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > data.length) break
    frame.chunks.push({ id, size, data: data.subarray(start, end) })
    offset = end + (size & 1)
  }
  return frame
}

/** Escribe un chunk RIFF (con padding a número par) */
function buildChunk(id, data) {
  const header = Buffer.alloc(8)
  header.write(id, 0, 4, 'ascii')
  header.writeUInt32LE(data.length, 4)
  const padding = data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)
  return Buffer.concat([header, data, padding])
}

function buildRiff(chunks) {
  const body = Buffer.concat(chunks.map((chunk) => buildChunk(chunk.id, chunk.data)))
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WEBP', 8, 4, 'ascii')
  return Buffer.concat([header, body])
}

/** Dimensiones del canvas y datos de animación */
export function webpInfo(buffer) {
  const parsed = parseWebp(buffer)
  if (!parsed.valid) return null

  const vp8x = parsed.chunks.find((chunk) => chunk.id === 'VP8X')
  const anim = parsed.chunks.find((chunk) => chunk.id === ANIM_CHUNK)
  const frames = parsed.chunks
    .filter((chunk) => chunk.id === 'ANMF')
    .map((chunk) => parseAnmfFrame(chunk.data))
    .filter(Boolean)

  let width = 0
  let height = 0
  let flags = 0
  if (vp8x && vp8x.data.length >= 10) {
    flags = vp8x.data[0]
    width = vp8x.data.readUIntLE(4, 3) + 1
    height = vp8x.data.readUIntLE(7, 3) + 1
  } else if (frames.length) {
    width = frames[0].width
    height = frames[0].height
  } else {
    const vp8 = parsed.chunks.find((chunk) => chunk.id === 'VP8 ')
    const vp8l = parsed.chunks.find((chunk) => chunk.id === 'VP8L')
    if (vp8 && vp8.data.length >= 10) {
      width = vp8.data.readUInt16LE(6) & 0x3fff
      height = vp8.data.readUInt16LE(8) & 0x3fff
    } else if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
      const bits = vp8l.data.readUInt32LE(1)
      width = (bits & 0x3fff) + 1
      height = ((bits >> 14) & 0x3fff) + 1
    }
  }

  const hasAlphaChunk =
    parsed.chunks.some((chunk) => chunk.id === 'ALPH') ||
    frames.some((frame) => frame.chunks.some((chunk) => chunk.id === 'ALPH')) ||
    parsed.chunks.some((chunk) => chunk.id === 'VP8L' && chunk.data.length > 4 && (chunk.data[4] & 0x10))

  return {
    parsed,
    width,
    height,
    flags,
    animated: frames.length > 0 || Boolean(flags & VP8X_FLAGS.ANIM),
    frames,
    frameCount: frames.length,
    totalDelay: frames.reduce((sum, frame) => sum + frame.delay, 0),
    hasAlpha: Boolean(flags & VP8X_FLAGS.ALPHA),
    hasAlphaChunk,
    loops: anim && anim.data.length >= 6 ? anim.data.readUInt16LE(4) : null,
    backgroundColor: anim && anim.data.length >= 4 ? anim.data.readUInt32LE(0) : null
  }
}

/** Reconstruye el VP8X con los flags correctos (sin perder ALPHA) */
function rebuildVp8x(oldData, { flags, width, height }) {
  const data = Buffer.from(oldData && oldData.length >= 10 ? oldData : Buffer.alloc(10))
  data[0] = flags
  data[1] = 0
  data[2] = 0
  data[3] = 0
  data.writeUIntLE(width - 1, 4, 3)
  data.writeUIntLE(height - 1, 7, 3)
  return data
}

/**
 * Escribe (o reemplaza) el chunk EXIF de un WebP preservando todo el resto.
 * Corrige además el flag ALPHA del VP8X y deja el fondo de la animación
 * transparente, que es lo que espera WhatsApp.
 *
 * @param {Buffer} buffer WebP de entrada
 * @param {Buffer} exifBuffer contenido del chunk EXIF (cabecera + JSON)
 * @returns {Buffer}
 */
export function injectExif(buffer, exifBuffer) {
  if (!isWebpBuffer(buffer)) throw new Error('El archivo no es un WebP válido')
  if (!Buffer.isBuffer(exifBuffer) || !exifBuffer.length) throw new Error('EXIF vacío')

  const info = webpInfo(buffer)
  if (!info) throw new Error('No se pudo leer el WebP')

  const chunks = []

  for (const chunk of info.parsed.chunks) {
    if (chunk.id === EXIF_CHUNK) continue // se reemplaza
    chunks.push({ id: chunk.id, data: chunk.data })
  }

  const flags =
    (info.flags & (VP8X_FLAGS.ICCP | VP8X_FLAGS.XMP)) |
    (info.animated ? VP8X_FLAGS.ANIM : 0) |
    VP8X_FLAGS.EXIF |
    (info.hasAlphaChunk || info.hasAlpha ? VP8X_FLAGS.ALPHA : 0)

  const vp8xIndex = chunks.findIndex((chunk) => chunk.id === 'VP8X')
  const vp8x = rebuildVp8x(
    vp8xIndex >= 0 ? chunks[vp8xIndex].data : null,
    { flags, width: info.width || 512, height: info.height || 512 }
  )

  if (vp8xIndex >= 0) {
    chunks[vp8xIndex] = { id: 'VP8X', data: vp8x }
  } else {
    chunks.unshift({ id: 'VP8X', data: vp8x })
  }

  // Fondo transparente en animaciones (evita el "marco" blanco/negro)
  const animationIndex = chunks.findIndex((chunk) => chunk.id === ANIM_CHUNK)
  if (animationIndex >= 0) {
    const animData = Buffer.from(chunks[animationIndex].data)
    if (animData.length >= 4) animData.writeUInt32LE(0x00000000, 0)
    chunks[animationIndex] = { id: 'ANIM', data: animData }
  }

  chunks.push({ id: EXIF_CHUNK, data: exifBuffer })

  return buildRiff(chunks)
}

/** Elimina el chunk EXIF (si existe) */
export function stripExif(buffer) {
  if (!isWebpBuffer(buffer)) return buffer
  const info = webpInfo(buffer)
  if (!info) return buffer
  const chunks = info.parsed.chunks
    .filter((chunk) => chunk.id !== EXIF_CHUNK)
    .map((chunk) => ({ id: chunk.id, data: chunk.data }))
  if (chunks.length === info.parsed.chunks.length) return buffer

  const vp8xIndex = chunks.findIndex((chunk) => chunk.id === 'VP8X')
  if (vp8xIndex >= 0) {
    const flags = (info.flags & ~VP8X_FLAGS.EXIF) | (info.hasAlphaChunk ? VP8X_FLAGS.ALPHA : 0)
    chunks[vp8xIndex] = {
      id: 'VP8X',
      data: rebuildVp8x(chunks[vp8xIndex].data, {
        flags,
        width: info.width || 512,
        height: info.height || 512
      })
    }
  }
  return buildRiff(chunks)
}

/** Devuelve el JSON de metadatos del sticker (o null) */
export function readExifPayload(buffer, headerLength = 0) {
  if (!isWebpBuffer(buffer)) return null
  const info = webpInfo(buffer)
  if (!info) return null
  const exif = info.parsed.chunks.find((chunk) => chunk.id === EXIF_CHUNK)
  if (!exif) return null

  const raw = exif.data
  const candidates = []

  if (headerLength > 0 && raw.length > headerLength) candidates.push(raw.subarray(headerLength))
  candidates.push(raw)

  for (const candidate of candidates) {
    const text = candidate.toString('utf8')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        /* prueba la siguiente variante */
      }
    }
  }
  return null
}

/**
 * Revisa que el sticker cumpla lo que exige WhatsApp y que no tenga los
 * defectos típicos (alpha perdido, frames rotos, tamaño incorrecto).
 * @returns {{valid:boolean, issues:string[], warnings:string[], info:object|null}}
 */
export function auditSticker(buffer, { maxSize = 512, maxBytes = null } = {}) {
  const issues = []
  const warnings = []

  if (!isWebpBuffer(buffer)) {
    return { valid: false, issues: ['no es un WebP (RIFF/WEBP)'], warnings, info: null }
  }

  const info = webpInfo(buffer)
  if (!info) return { valid: false, issues: ['no se pudieron leer los chunks'], warnings, info: null }

  if (info.parsed.sizeMismatch) issues.push('el tamaño declarado en RIFF no coincide con el archivo')
  if (!info.parsed.chunks.some((chunk) => chunk.id === 'VP8X')) {
    warnings.push('no tiene chunk VP8X')
  }
  if (!info.width || !info.height) issues.push('no se pudieron leer las dimensiones')
  else if (info.width > maxSize || info.height > maxSize) {
    issues.push(`mide ${info.width}x${info.height} (máximo ${maxSize}x${maxSize})`)
  } else if (info.width !== info.height) {
    warnings.push(`no es cuadrado (${info.width}x${info.height})`)
  }

  if (info.animated) {
    if (info.frameCount < 2) issues.push('no tiene cuadros suficientes para ser animado')
    if (info.frames.some((frame) => frame.delay <= 0)) issues.push('hay cuadros sin duración')
    if (info.frames.some((frame) => !frame.chunks.length)) issues.push('hay cuadros vacíos')
    if (info.loops === null) warnings.push('no tiene chunk ANIM (loop)')
  }

  // El bloque EXIF de WhatsApp es un TIFF mínimo: bytes 14-17 = largo del
  // JSON y 18-21 = offset del valor (22). Si el largo queda en 0, WhatsApp no
  // puede mostrar el nombre del pack ("no se puede ver la información").
  const exifChunk = info.parsed.chunks.find((chunk) => chunk.id === EXIF_CHUNK)
  if (exifChunk) {
    const data = exifChunk.data
    const isStickerExif =
      data.length >= 22 && data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data.readUInt16LE(10) === 0x5741
    if (isStickerExif) {
      const length = data.readUInt32LE(14)
      const offset = data.readUInt32LE(18)
      if (offset < 22 || offset > data.length) {
        issues.push('los metadatos EXIF apuntan fuera del bloque')
      } else if (length === 0) {
        issues.push('los metadatos EXIF no declaran su tamaño (WhatsApp no puede leerlos)')
      } else if (offset + length > data.length) {
        issues.push('los metadatos EXIF están truncados')
      }
    }
    if (!(info.flags & VP8X_FLAGS.EXIF)) warnings.push('tiene EXIF pero el flag EXIF está apagado')
  }

  if (info.hasAlphaChunk && !info.hasAlpha) {
    issues.push('tiene transparencia pero el flag ALPHA está apagado (se vería con fondo negro)')
  }

  if (maxBytes && buffer.length > maxBytes) {
    issues.push(`pesa ${Math.round(buffer.length / 1024)} KB (límite ${Math.round(maxBytes / 1024)} KB)`)
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    info: {
      width: info.width,
      height: info.height,
      animated: info.animated,
      frameCount: info.frameCount,
      totalDelay: info.totalDelay,
      hasAlpha: info.hasAlpha,
      loops: info.loops,
      bytes: buffer.length,
      chunks: info.parsed.chunks.map((chunk) => chunk.id)
    }
  }
}
