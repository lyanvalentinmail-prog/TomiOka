import { getContent, getMediaContent, getQuoted, getText, downloadMedia, resolveMediaTarget } from './message.js'
import { parseCommand, jidToNumber, truncate } from './text.js'
import { writeStickerMetadata } from './sticker.js'
import { finishLiveMessage, retireLiveMessages, sendLiveMessage } from './live-messages.js'

/**
 * Contexto de un mensaje recibido. Expone helpers cómodos para los comandos.
 */
export class CommandContext {
  constructor({ sock, msg, config, logger, store, text }) {
    this.sock = sock
    this.msg = msg
    this.message = msg
    this.config = config
    this.logger = logger
    this.store = store

    this.chatJid = msg.key.remoteJid
    this.fromMe = Boolean(msg.key.fromMe)
    this.isGroup = String(this.chatJid || '').endsWith('@g.us')
    this.botJid = sock.user?.id || ''
    this.senderJid = this.isGroup
      ? msg.key.participant || this.chatJid
      : this.fromMe
        ? this.botJid
        : this.chatJid
    this.senderNumber = jidToNumber(this.senderJid)
    this.pushName = msg.pushName || ''
    this.isOwner =
      this.fromMe ||
      config.owner.numbers.includes(this.senderNumber)

    this.content = getContent(msg)
    this.current = getMediaContent(this.content)
    this.quoted = getQuoted(msg)
    this.text = typeof text === 'string' ? text : getText(msg)

    this.prefixes = config.prefixes
    const parsed = parseCommand(this.text, this.prefixes)
    this.parsed = parsed
    this.command = parsed?.command ?? null
    this.args = parsed?.args ?? []
    this.argsText = parsed?.argsText ?? ''
    this.prefix = parsed?.prefix ?? config.prefixes[0]
    this.startedAt = Date.now()

    this.mediaCache = new Map()
    this._replied = false
  }

  get botNumber() {
    return jidToNumber(this.botJid)
  }

  get latency() {
    return Date.now() - this.startedAt
  }

  /** Media a usar: primero el mensaje citado, luego el mensaje actual */
  get mediaTarget() {
    return resolveMediaTarget(this)
  }

  /** Devuelve el media si es de los tipos permitidos; si no, error amigable */
  requireMedia(allowedKinds, message = 'Responde a un sticker, imagen, GIF o video con este comando.') {
    const target = this.mediaTarget
    if (!target) throw new Error(message)
    if (allowedKinds && !allowedKinds.includes(target.kind)) {
      throw new Error(message)
    }
    return target
  }

  /** Descarga el buffer del media indicado (o del detectado) */
  async download(target = this.mediaTarget) {
    if (!target) throw new Error('No encontré ningún archivo multimedia en el mensaje.')
    const cacheKey = `${target.origin || 'current'}:${target.type}:${target.key?.id || ''}`
    if (this.mediaCache.has(cacheKey)) return this.mediaCache.get(cacheKey)

    const maxBytes = Math.max(1, this.config.stickers.maxInputMB || 30) * 1024 * 1024
    const buffer = await downloadMedia(
      { key: target.key || this.msg.key, message: target.message || this.msg.message },
      { sock: this.sock, logger: this.logger, maxBytes }
    )
    this.mediaCache.set(cacheKey, buffer)
    return buffer
  }

  /** Responde citando el mensaje del usuario */
  async reply(text, options = {}) {
    this._replied = true
    return this.sock.sendMessage(this.chatJid, { text }, { quoted: this.msg, ...options })
  }

  /** Responde sin citar (útil en grupos con mucho movimiento) */
  async send(text, options = {}) {
    return this.sock.sendMessage(this.chatJid, { text }, options)
  }

  async react(emoji) {
    try {
      return await this.sock.sendMessage(this.chatJid, {
        react: { text: emoji, key: this.msg.key }
      })
    } catch (error) {
      this.logger?.debug?.(`No se pudo reaccionar: ${error.message}`)
      return null
    }
  }

  async typing(mode = 'composing') {
    if (!this.config.behavior.sendTyping) return
    try {
      await this.sock.sendPresenceUpdate(mode, this.chatJid)
    } catch {
      /* no es crítico */
    }
  }

  /**
   * Envía un sticker aplicando los metadatos del pack.
   */
  async sendSticker(buffer, options = {}) {
    const {
      packName = this.config.stickers.packName,
      packAuthor = this.config.stickers.packAuthor,
      emojis = [],
      withMetadata = true,
      quoted = true
    } = options

    let output = buffer
    if (withMetadata) {
      try {
        output = await writeStickerMetadata(buffer, { packName, packAuthor, emojis })
      } catch (error) {
        this.logger?.warn?.(`No se pudo escribir el EXIF del sticker: ${error.message}`)
      }
    }
    return this.sock.sendMessage(
      this.chatJid,
      { sticker: output },
      quoted ? { quoted: this.msg } : undefined
    )
  }

  async sendImage(buffer, caption = '', options = {}) {
    return this.sock.sendMessage(
      this.chatJid,
      { image: buffer, caption, ...options },
      { quoted: this.msg }
    )
  }

  async sendVideo(buffer, caption = '', options = {}) {
    return this.sock.sendMessage(
      this.chatJid,
      { video: buffer, caption, ...options },
      { quoted: this.msg }
    )
  }

  /**
   * Guarda la key de un mensaje enviado en una ranura (para poder editarlo o
   * retirarlo después).
   */
  rememberLive(slot, sent) {
    return this.store?.messages?.remember(this.chatJid, slot, sent) || []
  }

  /** Edita el mensaje de la ranura o manda uno nuevo si no hay */
  sendLive(slot, text, options = {}) {
    return sendLiveMessage(this, slot, text, options)
  }

  /** Deja los mensajes de la ranura como "Menu eliminado." (o los elimina) */
  retireLive(slot, text) {
    return retireLiveMessages(this, slot, text)
  }

  /** Cierra la ranura con un texto final */
  finishLive(slot, text) {
    return finishLiveMessage(this, slot, text)
  }

  async sendDocument(buffer, fileName, mimetype = 'application/octet-stream', caption = '') {
    return this.sock.sendMessage(
      this.chatJid,
      { document: buffer, fileName, mimetype, caption },
      { quoted: this.msg }
    )
  }

  /** Nombre visible para logs */
  get displayName() {
    return truncate(this.pushName || this.senderNumber || 'desconocido', 32)
  }
}

export default CommandContext
