/** Utilidades de texto / comandos */

/**
 * Separa "prefijo + comando + argumentos".
 * @returns {{prefix:string, command:string, args:string[], argsText:string, raw:string}|null}
 */
export function parseCommand(text, prefixes = ['.']) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const prefix = [...prefixes].sort((a, b) => b.length - a.length).find((p) => trimmed.startsWith(p))
  if (!prefix) return null

  const rest = trimmed.slice(prefix.length)
  if (!rest || /^\s/.test(rest)) return null

  const match = rest.match(/^(\S+)\s*([\s\S]*)$/)
  if (!match) return null

  const command = match[1].toLowerCase()
  const argsText = (match[2] || '').trim()
  const args = argsText ? argsText.split(/\s+/).filter(Boolean) : []

  return { prefix, command, args, argsText, raw: trimmed }
}

/** Divide un texto en unidades de grafema (emojis complejos incluidos) */
export function splitGraphemes(text) {
  const value = String(text ?? '')
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' })
    return [...segmenter.segment(value)].map((part) => part.segment)
  }
  return [...value]
}

/** Extrae los "emojis" (grafemas que no sean espacios ni texto latino) de un texto */
export function extractEmojis(text) {
  return splitGraphemes(text).filter((part) => /\p{Extended_Pictographic}/u.test(part))
}

/**
 * Divide argumentos que usan separador "," para nombre y autor.
 * ".take prueba,prueba" -> { name: 'prueba', author: 'prueba' }
 */
export function splitNameAuthor(argsText = '', { name = '', author = '' } = {}) {
  const raw = String(argsText || '').trim()
  if (!raw) return { name, author }
  const commaIndex = raw.indexOf(',')
  if (commaIndex === -1) {
    return { name: raw || name, author }
  }
  const parsedName = raw.slice(0, commaIndex).trim()
  const parsedAuthor = raw.slice(commaIndex + 1).trim()
  return {
    name: parsedName || name,
    author: parsedAuthor || author
  }
}

/** Corta un texto a un máximo de caracteres añadiendo "…" */
export function truncate(text, max = 60) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Normaliza el número de teléfono que llega en un JID ("549...:12@s.whatsapp.net")
 */
export function jidToNumber(jid = '') {
  return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '')
}

/** Formatea segundos como "1m 05s" */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  if (mins === 0) return `${secs}s`
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

/** Fecha legible en español (UY) */
export function formatDate(date = new Date()) {
  const d = new Date(date)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`
}

/** Convierte dígitos a dígitos "matemáticos en negrita" (𝟎𝟏, 𝟎𝟐...) */
export function boldDigits(value) {
  const map = ['𝟎', '𝟏', '𝟐', '𝟑', '𝟒', '𝟓', '𝟔', '𝟕', '𝟖', '𝟗']
  return String(value)
    .split('')
    .map((char) => (/[0-9]/.test(char) ? map[Number(char)] : char))
    .join('')
}

export function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined
  return list[Math.floor(Math.random() * list.length)]
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
