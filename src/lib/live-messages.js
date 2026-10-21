/**
 * Mensajes "vivos": el bot recuerda la key del mensaje que ya mandó en una
 * ranura (el menú, el progreso de `.pack`, el diagnóstico…) y en vez de mandar
 * otro mensaje igual lo **edita**.
 *
 * - `sendLive()`  → edita el mensaje de la ranura o manda uno nuevo si no hay.
 * - `retireLive()` → deja los mensajes viejos como "Menu eliminado." (o los
 *   elimina si ya no se pueden editar).
 * - `finishLive()` → cierra la ranura con un texto final.
 *
 * WhatsApp solo permite editar mensajes recientes, así que pasado un rato se
 * manda uno nuevo o se elimina el viejo para todos.
 *
 * Ojo con los mensajes con media (el menú con banner es una foto con pie):
 * WhatsApp no permite editar una foto para convertirla en un texto, así que
 * esa "edición" se ignora y el banner viejo queda en el chat. Por eso cada
 * entrada guarda su `kind` y al retirar:
 *   - texto  → se edita a "Menu eliminado."
 *   - imagen → se elimina para todos (no puede pasar a ser solo texto)
 *
 * La ranura `menu` se guarda además en disco (si se pasa `persistFile`):
 * así, aunque se reinicie el bot, el próximo `.menu` todavía recuerda y
 * retira los menús que quedaron de la ejecución anterior.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Ventana en la que WhatsApp acepta editar un mensaje */
export const EDIT_WINDOW_MS = 14 * 60 * 1000

/** Texto con el que quedan los menús anteriores */
export const RETIRED_MENU_TEXT = 'Menu eliminado.'

const MAX_PER_SLOT = 5

/** Ranuras que sobreviven a un reinicio del bot (guardadas en disco) */
const PERSISTED_SLOTS = new Set(['menu'])

/** Más allá de ~2 días WhatsApp ya no deja borrar para todos: se descarta */
const PERSISTED_MAX_AGE_MS = 48 * 60 * 60 * 1000

const MEDIA_MESSAGE_TYPES = new Set([
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'stickerMessage',
  'audioMessage',
  'ptvMessage'
])

/**
 * ¿El mensaje enviado es una foto/video/etc.? Se deduce de la respuesta de
 * Baileys (`{ key, message: { imageMessage: … } }`). Los sockets de prueba
 * devuelven solo la key, así que ahí el `kind` se pasa a mano al guardar.
 */
export function inferLiveKind(sent) {
  const message = sent?.message || sent?.content || null
  if (message && typeof message === 'object') {
    for (const type of Object.keys(message)) {
      if (MEDIA_MESSAGE_TYPES.has(type)) return 'media'
    }
  }
  return 'text'
}

/** Guarda las keys de los mensajes enviados, por chat y ranura */
export class LiveMessages {
  constructor({ editWindowMs = EDIT_WINDOW_MS, maxSlots = 500, persistFile = null } = {}) {
    this.editWindowMs = editWindowMs
    this.maxSlots = maxSlots
    this.persistFile = persistFile
    this.slots = new Map()
    this.loadPersisted()
  }

  /** ¿Esta ranura se guarda en disco para sobrevivir a un reinicio? */
  isPersisted(slot) {
    return Boolean(this.persistFile) && PERSISTED_SLOTS.has(slot)
  }

  /** Lee del disco los menús guardados por una ejecución anterior */
  loadPersisted() {
    if (!this.persistFile || !existsSync(this.persistFile)) return
    try {
      const parsed = JSON.parse(readFileSync(this.persistFile, 'utf8'))
      const now = Date.now()
      for (const [key, entries] of parsed?.slots || []) {
        const slot = String(key).split('::').at(-1)
        if (!PERSISTED_SLOTS.has(slot) || !Array.isArray(entries)) continue
        const clean = entries
          .filter(
            (entry) =>
              entry?.key?.id && Number.isFinite(entry.at) && now - entry.at < PERSISTED_MAX_AGE_MS
          )
          .map((entry) => ({
            key: entry.key,
            at: entry.at,
            kind: entry.kind === 'media' ? 'media' : 'text'
          }))
          .slice(0, MAX_PER_SLOT)
        if (clean.length) this.slots.set(key, clean)
      }
    } catch {
      /* archivo dañado o ilegible: se empieza de cero, sin romper el bot */
    }
  }

  /** Guarda en disco solo las ranuras persistidas (hoy, el menú) */
  savePersisted() {
    if (!this.persistFile) return
    try {
      const slots = [...this.slots.entries()].filter(([key]) =>
        PERSISTED_SLOTS.has(String(key).split('::').at(-1))
      )
      mkdirSync(path.dirname(this.persistFile), { recursive: true })
      writeFileSync(this.persistFile, JSON.stringify({ version: 1, slots }))
    } catch {
      /* si no se puede escribir, el menú igual funciona en memoria */
    }
  }

  static key(chatJid, slot) {
    return `${chatJid}::${slot}`
  }

  /** Entradas guardadas (la más nueva primero) */
  entries(chatJid, slot) {
    return this.slots.get(LiveMessages.key(chatJid, slot)) || []
  }

  /**
   * Guarda uno o varios mensajes enviados en la ranura.
   * `kind` indica qué es cada mensaje ('text' por defecto, 'media' para
   * fotos/videos): al retirarlo, el texto se edita y la media se elimina.
   * Si no se pasa, se deduce de la respuesta de Baileys.
   */
  remember(chatJid, slot, sent, { kind = null } = {}) {
    const list = (Array.isArray(sent) ? sent : [sent]).filter((item) => item?.key)
    if (!list.length) return []
    const key = LiveMessages.key(chatJid, slot)
    const previous = this.slots.get(key) || []
    const now = Date.now()
    const added = list.map((item) => ({
      key: item.key,
      at: now,
      kind: kind || inferLiveKind(item)
    }))
    const merged = [...added, ...previous].slice(0, MAX_PER_SLOT)
    // Map conserva el orden de inserción: al borrar y volver a setear, la
    // ranura pasa al final y las más viejas se descartan primero.
    this.slots.delete(key)
    this.slots.set(key, merged)
    while (this.slots.size > this.maxSlots) {
      this.slots.delete(this.slots.keys().next().value)
    }
    if (this.isPersisted(slot)) this.savePersisted()
    return merged
  }

  forget(chatJid, slot) {
    this.slots.delete(LiveMessages.key(chatJid, slot))
    if (this.isPersisted(slot)) this.savePersisted()
  }

  clear() {
    this.slots.clear()
    if (this.persistFile) this.savePersisted()
  }

  /** ¿El mensaje todavía se puede editar? */
  isEditable(entry, now = Date.now()) {
    return Boolean(entry?.key) && now - entry.at < this.editWindowMs
  }
}

const keyOf = (sent) => sent?.key || null

function rememberResponse(store, chatJid, slot, sent, fallback) {
  if (!store) return
  if (sent) store.remember(chatJid, slot, sent)
  else if (fallback) store.remember(chatJid, slot, fallback)
}

/**
 * Manda un texto a la ranura: si hay un mensaje reciente lo edita, si no manda
 * uno nuevo.
 * @returns {Promise<{edited:boolean, response:object|null}>}
 */
export async function sendLiveMessage(ctx, slot, text, { quoted = true } = {}) {
  const store = ctx.store?.messages
  const jid = ctx.chatJid
  const [last] = store?.entries(jid, slot) || []

  if (store && last && store.isEditable(last)) {
    try {
      // Ojo: la respuesta de una edición trae su propia key. Hay que seguir
      // apuntando al mensaje original, que es el que se puede volver a editar.
      const response = await ctx.sock.sendMessage(jid, { text, edit: last.key })
      return { edited: true, response }
    } catch (error) {
      ctx.logger?.debug?.(`No se pudo editar el mensaje de "${slot}": ${error.message}`)
      store.forget(jid, slot)
    }
  }

  const response = quoted ? await ctx.reply(text) : await ctx.send(text)
  rememberResponse(store, jid, slot, response)
  return { edited: false, response }
}

/**
 * Retira TODOS los mensajes de la ranura (por ejemplo, al pedir un menú
 * nuevo se retiran todos los menús anteriores del chat).
 *
 * - Los de texto quedan editados como `text` ("Menu eliminado.").
 * - Los de media (el menú con banner) se eliminan para todos: WhatsApp no
 *   permite editar una foto hasta convertirla en texto, así que intentar
 *   editarla no hace nada y el banner viejo quedaría en el chat.
 * - Si un texto es muy viejo para editarse, también se elimina para todos.
 * @returns {Promise<number>} cuántos mensajes se pudieron retirar
 */
export async function retireLiveMessages(ctx, slot, text = RETIRED_MENU_TEXT) {
  const store = ctx.store?.messages
  if (!store) return 0

  const jid = ctx.chatJid
  const entries = store.entries(jid, slot)
  store.forget(jid, slot)

  let handled = 0
  for (const entry of entries) {
    if (!entry.key) continue
    const isMedia = entry.kind && entry.kind !== 'text'
    if (!isMedia && store.isEditable(entry)) {
      try {
        await ctx.sock.sendMessage(jid, { text, edit: entry.key })
        handled += 1
        continue
      } catch (error) {
        ctx.logger?.debug?.(`No se pudo editar el mensaje anterior: ${error.message}`)
      }
    }
    try {
      await ctx.sock.sendMessage(jid, { delete: entry.key })
      handled += 1
    } catch (error) {
      ctx.logger?.debug?.(`No se pudo eliminar el mensaje anterior: ${error.message}`)
    }
  }
  return handled
}

/**
 * Cierra la ranura con un texto final: lo edita si se puede y, si no, manda un
 * mensaje nuevo. Nunca deja el progreso viejo colgado.
 */
export async function finishLiveMessage(ctx, slot, text) {
  const store = ctx.store?.messages
  const jid = ctx.chatJid
  const [last] = store?.entries(jid, slot) || []
  store?.forget(jid, slot)

  if (store && last && store.isEditable(last)) {
    try {
      const response = await ctx.sock.sendMessage(jid, { text, edit: last.key })
      return { edited: true, response }
    } catch (error) {
      ctx.logger?.debug?.(`No se pudo editar el mensaje final de "${slot}": ${error.message}`)
    }
  }

  const response = await ctx.reply(text)
  return { edited: false, response }
}

export { keyOf }
