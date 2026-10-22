import { convertToSticker } from '../lib/media.js'
import { auditSticker, isWebpBuffer } from '../lib/webp.js'
import {
  downloadSticker,
  friendlySearchError,
  searchSettings,
  searchStickers,
  stickerExtension
} from '../lib/sticker-search.js'
import { truncate } from '../lib/text.js'

const MAX_SEND = 10

/** Ranura del mensaje de progreso: una por chat y remitente */
const searchSlot = (ctx) => `search:${ctx.senderJid}`

/**
 * Separa el texto de búsqueda de las opciones:
 *   `.search gatitos`          → texto
 *   `.search gatitos 5`        → 5 stickers
 *   `.search -p 2 gatitos`     → página 2
 */
export function parseSearchArgs(argsText = '') {
  let text = String(argsText || '').trim()
  let page = 1
  let count = null

  const pageMatch = text.match(/(?:^|\s)(?:--pagina|--page|-p)\s*(\d{1,3})(?=\s|$)/i)
  if (pageMatch) {
    page = Math.min(50, Math.max(1, Number(pageMatch[1]) || 1))
    text = `${text.slice(0, pageMatch.index)} ${text.slice(pageMatch.index + pageMatch[0].length)}`.trim()
  }

  const countMatch = text.match(/(?:^|\s)(\d{1,2})$/)
  if (countMatch) {
    const value = Number(countMatch[1])
    if (value >= 1 && value <= MAX_SEND) {
      count = value
      text = text.slice(0, countMatch.index).trim()
    }
  }

  return { query: text.replace(/\s+/g, ' ').trim(), count, page }
}

/**
 * Baja un sticker de la búsqueda y lo deja listo para WhatsApp.
 *
 * Si ya viene en WebP válido y liviano se usa tal cual (después `sendSticker`
 * le escribe el EXIF); si no, se convierte como cualquier foto/GIF/video.
 */
export async function stickerBufferFromUrl(ctx, url, { animated = false } = {}) {
  const buffer = await downloadSticker({ url }, { config: ctx.config, logger: ctx.logger })
  const extension = stickerExtension(url)
  const isWebp = isWebpBuffer(buffer)
  const isAnimated =
    Boolean(animated) ||
    extension === 'gif' ||
    (isWebp && Boolean(auditSticker(buffer, { maxSize: 512 }).info?.animated))

  const settings = ctx.config.stickers || {}
  const maxBytes = (isAnimated ? settings.maxAnimatedKB || 500 : settings.maxStaticKB || 100) * 1024
  const audit = auditSticker(buffer, { maxSize: 512, maxBytes })

  // Ya es un sticker de WhatsApp: no hace falta re-codificar nada.
  if (isWebp && !audit.issues.length && buffer.length <= maxBytes) return buffer

  const converted = await convertToSticker(buffer, {
    extension,
    animated: isAnimated,
    settings,
    logger: ctx.logger
  })
  return converted.buffer
}

export default {
  name: 'search',
  aliases: ['ssearch', 'buscar', 'sticker-search', 'searchsticker'],
  category: 'stickers',
  description: 'Buscar y enviar stickers de Sticker.ly (públicos o privados).',
  usage: '.search <texto> [cantidad]',
  examples: ['.search gatitos', '.search anime 5', '.search -p 2 memes'],
  async run(ctx) {
    const settings = searchSettings(ctx.config)
    if (!settings.enabled) {
      throw new Error('La búsqueda de stickers está desactivada (`search.enabled` en config.json).')
    }

    const { query, count, page } = parseSearchArgs(ctx.argsText)
    if (!query) {
      throw new Error(
        'Escribe qué quieres buscar.\n\n*Ejemplos:*\n▸ `.search gatitos`\n▸ `.search anime 5` (manda 5)\n▸ `.search -p 2 memes` (página 2)'
      )
    }

    const limit = Math.min(MAX_SEND, count || settings.maxResults)
    await ctx.sendLive(searchSlot(ctx), `🔎 Buscando *${truncate(query, 40)}*…`)

    let found
    try {
      found = await searchStickers({ query, page, limit, config: ctx.config, logger: ctx.logger })
    } catch (error) {
      const message = friendlySearchError(error)
      await ctx.finishLive(searchSlot(ctx), `💦 No pude buscar *${truncate(query, 40)}*.`)
      throw new Error(message)
    }

    if (!found.results.length) {
      await ctx.finishLive(
        searchSlot(ctx),
        `💧 No encontré stickers para *${truncate(query, 40)}*. Prueba con otra palabra.`
      )
      return `search "${query}" sin resultados`
    }

    let sent = 0
    const failures = []
    for (const sticker of found.results) {
      try {
        const buffer = await stickerBufferFromUrl(ctx, sticker.url, { animated: sticker.animated })
        const packName = sticker.packName || 'TomiOka Search'
        const packAuthor = sticker.author || 'Sticker.ly'
        await ctx.sendSticker(buffer, {
          packName: truncate(packName, 60),
          packAuthor: truncate(packAuthor, 30),
          emojis: (sticker.tags || []).slice(0, 3),
          withMetadata: true
        })
        sent += 1
      } catch (error) {
        failures.push(error)
        ctx.logger?.warn?.(`No se pudo enviar el sticker ${sticker.url}: ${error.message}`)
      }
    }

    const first = found.results[0]
    const source = first?.packName
      ? `\n▸ De *${truncate(first.packName, 40)}*${first.author ? ` · 👤 ${truncate(first.author, 24)}` : ''}`
      : ''
    const summary = sent
      ? `✅ *${sent}* sticker(s) de «${truncate(query, 40)}»${source}\n▸ Página ${page} · \`.search ${truncate(query, 20)} ${Math.min(MAX_SEND, limit + 3)}\` para más`
      : `💦 No pude descargar los stickers de «${truncate(query, 40)}».`

    await ctx.finishLive(searchSlot(ctx), summary)

    if (!sent) {
      const reason = failures[0] ? friendlySearchError(failures[0]) : 'El servicio no devolvió archivos.'
      throw new Error(`${reason}\n\nPrueba con otra búsqueda o usa *.debug* si el problema sigue.`)
    }

    return `search "${query}" ${sent} sticker(s) pág. ${page}`
  }
}
