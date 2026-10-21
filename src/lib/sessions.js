/**
 * Sesiones de packs de stickers (en memoria, con expiración).
 * Un pack se arma respondiendo/pegando stickers en el chat y luego se descarga como ZIP.
 */
export class PackStore {
  constructor({ ttlMinutes = 10, maxStickers = 30, logger } = {}) {
    this.ttlMs = Math.max(1000, Number(ttlMinutes) * 60 * 1000)
    this.maxStickers = Math.max(1, maxStickers)
    this.logger = logger
    this.sessions = new Map()
    this.timer = setInterval(() => this.sweep(), 60 * 1000)
    this.timer.unref?.()
  }

  key(chatJid, senderJid) {
    return `${chatJid}::${senderJid}`
  }

  start({ chatJid, senderJid, name, author }) {
    const session = {
      id: this.key(chatJid, senderJid),
      chatJid,
      senderJid,
      name,
      author,
      stickers: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.sessions.set(session.id, session)
    return session
  }

  get(chatJid, senderJid) {
    const session = this.sessions.get(this.key(chatJid, senderJid))
    if (!session) return null
    if (Date.now() - session.updatedAt > this.ttlMs) {
      this.sessions.delete(session.id)
      return null
    }
    return session
  }

  /**
   * Busca una sesión activa del chat (opcionalmente de un remitente concreto).
   * Sirve para agregar stickers sin repetir comandos.
   */
  findByChat(chatJid, senderJid = null) {
    for (const session of this.sessions.values()) {
      if (session.chatJid !== chatJid) continue
      if (senderJid && session.senderJid !== senderJid) continue
      if (Date.now() - session.updatedAt > this.ttlMs) continue
      return session
    }
    return null
  }

  add(session, sticker) {
    if (!session) return { ok: false, reason: 'sin-sesion' }
    if (session.stickers.length >= this.maxStickers) {
      return { ok: false, reason: 'lleno' }
    }
    session.stickers.push(sticker)
    session.updatedAt = Date.now()
    return { ok: true, count: session.stickers.length }
  }

  finish(session) {
    if (!session) return null
    this.sessions.delete(session.id)
    return session
  }

  cancel(session) {
    if (!session) return false
    return this.sessions.delete(session.id)
  }

  sweep() {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > this.ttlMs) {
        this.sessions.delete(id)
        this.logger?.debug?.(`Sesión de pack expirada: ${id}`)
      }
    }
  }

  get size() {
    return this.sessions.size
  }

  destroy() {
    clearInterval(this.timer)
    this.sessions.clear()
  }
}

export default PackStore
