import { loadConfig } from '../src/config.js'
import { resolveFfmpeg } from '../src/lib/ffmpeg.js'
import { finishLiveMessage, retireLiveMessages, sendLiveMessage } from '../src/lib/live-messages.js'

export function testConfig(overrides = {}) {
  const config = loadConfig()
  return {
    ...config,
    ...overrides,
    behavior: { ...config.behavior, cooldownMs: 0, ...(overrides.behavior || {}) },
    stickers: { ...config.stickers, ...(overrides.stickers || {}) },
    pack: { ...config.pack, ...(overrides.pack || {}) }
  }
}

export const silentLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return silentLogger
  }
}

/** Socket falso que guarda los mensajes enviados */
export function fakeSock() {
  const sent = []
  const reactions = []
  const presence = []
  return {
    sent,
    reactions,
    presence,
    user: { id: '59890000000:1@s.whatsapp.net', name: 'TomiOka' },
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options })
      if (content?.react) reactions.push(content.react)
      return { key: { id: `msg-${sent.length}`, remoteJid: jid } }
    },
    async sendPresenceUpdate(mode, jid) {
      presence.push({ mode, jid })
    },
    async updateMediaMessage() {
      throw new Error('no soportado en tests')
    }
  }
}

/**
 * Agrega a un contexto de prueba los helpers de mensajes "vivos"
 * (editar el menú / el progreso del pack en vez de mandar otro mensaje).
 */
export function withLiveMessages(ctx, sock) {
  if (sock) ctx.sock = sock
  ctx.rememberLive = (slot, sent) => ctx.store?.messages?.remember(ctx.chatJid, slot, sent) || []
  ctx.sendLive = (slot, text, options) => sendLiveMessage(ctx, slot, text, options)
  ctx.retireLive = (slot, text) => retireLiveMessages(ctx, slot, text)
  ctx.finishLive = (slot, text) => finishLiveMessage(ctx, slot, text)
  return ctx
}

/** Solo los mensajes de texto enviados (ignora reacciones) */
export function sentTexts(sock) {
  return sock.sent.filter((item) => typeof item.content?.text === 'string')
}

/** Mensaje de texto falso */
export function textMessage(text, { jid = '59891111111@s.whatsapp.net', pushName = 'Tester' } = {}) {
  return {
    key: { remoteJid: jid, fromMe: false, id: `test-${Math.random().toString(36).slice(2)}` },
    pushName,
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000)
  }
}

export async function ffmpegAvailable() {
  const info = await resolveFfmpeg()
  return Boolean(info?.webp)
}
