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
 */

/** Ventana en la que WhatsApp acepta editar un mensaje */
export const EDIT_WINDOW_MS = 14 * 60 * 1000

/** Texto con el que quedan los menús anteriores */
export const RETIRED_MENU_TEXT = 'Menu eliminado.'

const MAX_PER_SLOT = 5

/** Guarda las keys de los mensajes enviados, por chat y ranura */
export class LiveMessages {
  constructor({ editWindowMs = EDIT_WINDOW_MS, maxSlots = 500 } = {}) {
    this.editWindowMs = editWindowMs
    this.maxSlots = maxSlots
    this.slots = new Map()
  }

  static key(chatJid, slot) {
    return `${chatJid}::${slot}`
  }

  /** Entradas guardadas (la más nueva primero) */
  entries(chatJid, slot) {
    return this.slots.get(LiveMessages.key(chatJid, slot)) || []
  }

  /** Guarda uno o varios mensajes enviados en la ranura */
  remember(chatJid, slot, sent) {
    const list = (Array.isArray(sent) ? sent : [sent]).filter((item) => item?.key)
    if (!list.length) return []
    const key = LiveMessages.key(chatJid, slot)
    const previous = this.slots.get(key) || []
    const now = Date.now()
    const added = list.map((item) => ({ key: item.key, at: now }))
    const merged = [...added, ...previous].slice(0, MAX_PER_SLOT)
    // Map conserva el orden de inserción: al borrar y volver a setear, la
    // ranura pasa al final y las más viejas se descartan primero.
    this.slots.delete(key)
    this.slots.set(key, merged)
    while (this.slots.size > this.maxSlots) {
      this.slots.delete(this.slots.keys().next().value)
    }
    return merged
  }

  forget(chatJid, slot) {
    this.slots.delete(LiveMessages.key(chatJid, slot))
  }

  clear() {
    this.slots.clear()
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
 * Deja los mensajes de la ranura como `text` ("Menu eliminado.").
 * Si el mensaje es muy viejo para editarse, se elimina para todos.
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
    if (store.isEditable(entry)) {
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
