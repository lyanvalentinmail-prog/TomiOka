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
import { mapLimit } from '../lib/concurrency.js'
import { deliverPack } from './pack.js'

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

    // Descargar y convertir en paralelo (3 a la vez)
    const prepared = await mapLimit(found.results, 3, async (sticker) => {
      try {
        const buffer = await stickerBufferFromUrl(ctx, sticker.url, { animated: sticker.animated })
        return {
          buffer,
          emojis: (sticker.tags || []).slice(0, 3),
          animated: sticker.animated
        }
      } catch (error) {
        ctx.logger?.warn?.(`No se pudo preparar el sticker ${sticker.url}: ${error.message}`)
        return null
      }
    })

    const validStickers = prepared.filter(Boolean)
    if (!validStickers.length) {
      await ctx.finishLive(searchSlot(ctx), `💦 No pude descargar los stickers de «${truncate(query, 40)}».`)
      throw new Error('No se pudo descargar ningún sticker. Prueba con otra búsqueda.')
    }

    // Enviar como paquete nativo con botón "Agregar a WhatsApp"
    const first = found.results[0]
    const packName = first?.packName || 'TomiOka Search'
    const packAuthor = first?.author || 'Sticker.ly'

    await ctx.sendLive(searchSlot(ctx), `⏳ Armando paquete de «${truncate(query, 40)}»…`)

    const { pack } = await deliverPack(ctx, {
      name: truncate(packName, 60),
      author: truncate(packAuthor, 30),
      stickers: validStickers,
      description: `Búsqueda: ${truncate(query, 40)}`
    })

    const source = first?.packName
      ? `\n▸ De *${truncate(first.packName, 40)}*${first.author ? ` · 👤 ${truncate(first.author, 24)}` : ''}`
      : ''
    const summary = `✅ Paquete «${truncate(packName, 40)}» enviado\n▸ ${pack.stickers.length} sticker(s)${source}\n▸ Página ${page} · \`.search ${truncate(query, 20)} ${Math.min(MAX_SEND, limit + 3)}\` para más`

    await ctx.finishLive(searchSlot(ctx), summary)

    return `search "${query}" pack ${pack.stickers.length} sticker(s) pág. ${page}`
  }
}
