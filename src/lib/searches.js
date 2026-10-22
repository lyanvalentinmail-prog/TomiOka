/**
 * Estado temporal de las búsquedas.
 *
 * `.searchpack <texto>` devuelve una lista numerada y el usuario elige con
 * `.searchpack 2`. La lista se guarda por chat (no por usuario, para que en un
 * grupo el que pidió la búsqueda y quien responde no tengan que ser el mismo)
 * y se descarta sola al vencer, igual que las sesiones de `.pack`.
 */
export const MAX_ENTRIES = 500

export class SearchStore {
  /**
   * @param {{ttlMinutes?:number, maxEntries?:number, logger?:object, now?:() => number}} options
   */
  constructor({ ttlMinutes = 10, maxEntries = MAX_ENTRIES, logger = null, now = Date.now } = {}) {
    this.ttlMs = Math.max(1, Number(ttlMinutes) || 10) * 60 * 1000
    this.maxEntries = maxEntries
    this.logger = logger
    this.now = now
    this.entries = new Map()
  }

  /** Guarda el resultado de una búsqueda para el chat */
  save(chatJid, { query = '', kind = 'packs', results = [], provider = 'stickerly' } = {}) {
    const entry = {
      chatJid,
      query,
      kind,
      provider,
      results,
      createdAt: this.now()
    }
    this.entries.set(String(chatJid), entry)
    this.prune()
    return entry
  }

  /** Devuelve la última búsqueda del chat, o null si venció */
  get(chatJid) {
    const key = String(chatJid)
    const entry = this.entries.get(key)
    if (!entry) return null
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(key)
      return null
    }
    return entry
  }

  /** Un resultado concreto de la última búsqueda (1 = primero) */
  pick(chatJid, position) {
    const entry = this.get(chatJid)
    if (!entry) return { entry: null, item: null }
    const index = Number(position) - 1
    if (!Number.isInteger(index) || index < 0 || index >= entry.results.length) {
      return { entry, item: null }
    }
    return { entry, item: entry.results[index] }
  }

  clear(chatJid) {
    return this.entries.delete(String(chatJid))
  }

  get size() {
    return this.entries.size
  }

  /** Borra las vencidas y recorta si hay demasiadas */
  prune() {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > this.ttlMs) this.entries.delete(key)
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
  }
}

export default SearchStore
