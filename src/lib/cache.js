import { createHash } from 'node:crypto'

/**
 * Caché en memoria, con tope de cantidad y de bytes (LRU).
 *
 * Se usa para no repetir conversiones caras: si el mismo archivo se convierte
 * dos veces (por ejemplo `.sticker` y después `.take`, o el mismo sticker que
 * aparece en dos búsquedas), la segunda sale instantánea.
 */
export class BufferCache {
  /**
   * @param {{maxEntries?:number, maxBytes?:number, now?:() => number}} options
   */
  constructor({ maxEntries = 24, maxBytes = 32 * 1024 * 1024, now = Date.now } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 24)
    this.maxBytes = Math.max(0, Number(maxBytes) || 0)
    this.now = now
    this.entries = new Map() // key -> { value, meta, bytes, at }
    this.bytes = 0
    this.hits = 0
    this.misses = 0
  }

  get size() {
    return this.entries.size
  }

  /** @returns {Buffer|null} */
  get(key) {
    const entry = this.entries.get(key)
    if (!entry) {
      this.misses += 1
      return null
    }
    // LRU: al usarla pasa al final
    entry.at = this.now()
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.hits += 1
    return entry.value
  }

  /** Guarda un valor y devuelve cuántas entradas se descartaron */
  set(key, value, meta = {}) {
    if (!key || !Buffer.isBuffer(value)) return 0
    const bytes = value.length
    if (this.maxBytes && bytes > this.maxBytes) return 0 // no entra nunca: no se guarda

    if (this.entries.has(key)) {
      this.bytes -= this.entries.get(key).bytes
      this.entries.delete(key)
    }
    this.entries.set(key, { value, meta, bytes, at: this.now() })
    this.bytes += bytes

    let evicted = 0
    while (
      this.entries.size > this.maxEntries ||
      (this.maxBytes && this.bytes > this.maxBytes)
    ) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.bytes -= this.entries.get(oldest).bytes
      this.entries.delete(oldest)
      evicted += 1
    }
    return evicted
  }

  delete(key) {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.bytes -= entry.bytes
    this.entries.delete(key)
    return true
  }

  clear() {
    this.entries.clear()
    this.bytes = 0
  }

  stats() {
    const total = this.hits + this.misses
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Number((this.hits / total).toFixed(2)) : 0
    }
  }
}

/** sha256 en hex de un buffer (clave de caché barata y segura) */
export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Firma estable de un objeto plano (las claves se ordenan) */
export function signature(values = {}) {
  return Object.keys(values)
    .sort()
    .map((key) => `${key}=${JSON.stringify(values[key])}`)
    .join('&')
}

export default BufferCache
