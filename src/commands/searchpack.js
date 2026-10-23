import { deliverPack } from './pack.js'
import { stickerBufferFromUrl } from './search.js'
import { readSticker } from '../lib/sticker.js'
import {
  friendlySearchError,
  parsePackId,
  resolvePack,
  searchPacks,
  searchSettings
} from '../lib/sticker-search.js'
import { truncate } from '../lib/text.js'
import { mapLimit } from '../lib/concurrency.js'

const WAIT = new Set(['get', 'importar', 'descargar', 'link', 'pack', 'enviar'])
const CANCEL = new Set(['cancel', 'cancelar', 'salir', 'stop', 'limpiar'])
const COUNT_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

/** Ranura del mensaje de progreso: una por chat y remitente */
const packSlot = (ctx) => `searchpack:${ctx.senderJid}`

/**
 * Un código de paquete se reconoce por su forma: mayúsculas y números
 * (`OD5GZR`), o directamente porque es un enlace de Sticker.ly. Las palabras
 * normales (`gatitos`, `Anime`) van a la búsqueda.
 */
export function looksLikePackCode(text = '') {
  const value = String(text || '').trim()
  if (!value || /\s/.test(value)) return false
  if (/sticker\.ly\//i.test(value)) return Boolean(parsePackId(value))
  const code = parsePackId(value)
  if (!code) return false
  // Solo se acepta como código si tiene número y mayúscula: así "gatitos"
  // sigue siendo una búsqueda y "OD5GZR" se importa directo.
  return /\d/.test(value) && /[A-Z]/.test(value)
}

function packListMessage(query, results, page) {
  const lines = [`🔎 *Paquetes de «${truncate(query, 40)}»*`, '']
  results.forEach((pack, index) => {
    const number = COUNT_EMOJIS[index] || `${index + 1}.`
    const type = pack.animated ? 'animado' : 'estático'
    const count = pack.count ? `${pack.count} sticker(s)` : 'sticker(s)'
    lines.push(
      `${number} *${truncate(pack.name || 'Sin nombre', 42)}*`,
      `ㅤ▸ ${count} · ${type}${pack.author ? ` · 👤 ${truncate(pack.author, 24)}` : ''}`,
      `ㅤ▸ \`.searchpack ${index + 1}\``,
      ''
    )
  })
  lines.push(
    `💧 Elige uno con *.searchpack <número>* y lo envío como paquete nativo de WhatsApp.`,
    `🔐 ¿Es un paquete privado? Pega su enlace o escribe \`.searchpack get <código>\`.`,
    `▸ Página ${page} · \`.searchpack ${truncate(query, 20)} -p ${page + 1}\` para ver más`
  )
  return lines.join('\n')
}

async function importPack(ctx, { pack, target }) {
  const settings = searchSettings(ctx.config)
  const max = Math.min(
    settings.packStickerLimit,
    ctx.config.pack?.maxStickers || 30,
    pack.stickers.length
  )
  if (!max) throw new Error(`El paquete *${truncate(pack.name || target, 40)}* no tiene stickers descargables.`)

  const label = truncate(pack.name || 'paquete', 40)
  await ctx.sendLive(packSlot(ctx), `⏳ *${label}*: descargando 0/${max}…`)

  let done = 0
  const downloaded = await mapLimit(pack.stickers.slice(0, max), 4, async (sticker, index) => {
    try {
      const buffer = await stickerBufferFromUrl(ctx, sticker.url, { animated: sticker.animated })
      const info = await readSticker(buffer).catch(() => ({ animated: sticker.animated }))
      done += 1
      await ctx.sendLive(packSlot(ctx), `⏳ *${label}*: descargando ${done}/${max}…`)
      return {
        buffer,
        emojis: (sticker.tags || []).slice(0, 3),
        animated: Boolean(info?.animated || sticker.animated),
        index
      }
    } catch (error) {
      ctx.logger?.warn?.(`No se pudo descargar el sticker ${sticker.url}: ${error.message}`)
      return null
    }
  })

  const stickers = downloaded.filter(Boolean)
  if (!stickers.length) {
    await ctx.finishLive(packSlot(ctx), `💦 No pude descargar los stickers de *${label}*.`)
    throw new Error(
      'No se pudo descargar ningún sticker de ese paquete. Puede ser privado con el enlace vencido, ' +
        'o que el servicio esté bloqueando las descargas desde este equipo.'
    )
  }
  const missing = max - stickers.length
  if (missing > 0) {
    await ctx.sendLive(packSlot(ctx), `⏳ *${label}*: armando el paquete (${missing} sticker(s) no se pudieron bajar)…`)
  } else {
    await ctx.sendLive(packSlot(ctx), `⏳ *${label}*: armando el paquete…`)
  }

  const { pack: built } = await deliverPack(ctx, {
    name: truncate(pack.name || 'TomiOka Pack', 60),
    author: truncate(pack.author || 'Sticker.ly', 30),
    stickers,
    description: pack.id ? `Sticker.ly · ${pack.id}` : 'TomiOka Search'
  })

  await ctx.finishLive(
    packSlot(ctx),
    [
      `✅ *${label}* enviado`,
      `▸ ${built.stickers.length} sticker(s) · ${(built.zip.length / 1024).toFixed(0)} KB`,
      pack.author ? `▸ 👤 ${truncate(pack.author, 30)}` : '',
      pack.id ? `▸ 🔐 Código: \`${pack.id}\`` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )

  return `searchpack "${label}" ${built.stickers.length} stickers desde ${target}`
}

export default {
  name: 'searchpack',
  aliases: ['spack', 'packsearch', 'buscar-pack', 'pack-search'],
  category: 'stickers',
  description: 'Buscar paquetes de stickers o importar uno por código o enlace.',
  usage: '.searchpack <texto>  ·  .searchpack <número>  ·  .searchpack get <código|enlace>',
  examples: [
    '.searchpack gatitos',
    '.searchpack 2',
    '.searchpack get OD5GZR',
    '.searchpack https://sticker.ly/s/OD5GZR'
  ],
  async run(ctx) {
    const settings = searchSettings(ctx.config)
    if (!settings.enabled) {
      throw new Error('La búsqueda de stickers está desactivada (`search.enabled` en config.json).')
    }

    let text = String(ctx.argsText || '').trim()
    if (!text) {
      throw new Error(
        [
          'Dime qué paquete buscas o pásame su código.',
          '',
          '*Ejemplos:*',
          '▸ `.searchpack gatitos` — busca y lista',
          '▸ `.searchpack 2` — envía el paquete 2 de la última búsqueda',
          '▸ `.searchpack get OD5GZR` — importa un paquete por código',
          '▸ `.searchpack https://sticker.ly/s/OD5GZR` — o por enlace'
        ].join('\n')
      )
    }

    // --pagina N (no se confunde con la selección numérica)
    let page = 1
    const pageMatch = text.match(/(?:^|\s)(?:--pagina|--page|-p)\s*(\d{1,3})(?=\s|$)/i)
    if (pageMatch) {
      page = Math.min(50, Math.max(1, Number(pageMatch[1]) || 1))
      text = `${text.slice(0, pageMatch.index)} ${text.slice(pageMatch.index + pageMatch[0].length)}`.trim()
    }

    const [firstWord = '', ...rest] = text.split(/\s+/)
    const lower = firstWord.toLowerCase()

    // 1) Cancelar la búsqueda guardada
    if (CANCEL.has(lower)) {
      const cleared = ctx.store.searches?.clear(ctx.chatJid)
      await ctx.reply(cleared ? '💦 Búsqueda descartada.' : '💧 No había ninguna búsqueda guardada.')
      return 'searchpack cancel'
    }

    // 2) Importar: `.searchpack get 2 | get CODIGO | get enlace`
    if (WAIT.has(lower) && rest.length) {
      return importPack(ctx, { pack: await targetPack(ctx, rest.join(' ')), target: rest.join(' ') })
    }

    // 3) Elegir de la lista: `.searchpack 2`
    if (/^\d{1,3}$/.test(text)) {
      const position = Number(text)
      const entry = ctx.store.searches?.get(ctx.chatJid)
      if (!entry || entry.kind !== 'packs' || !entry.results.length) {
        throw new Error(
          'No hay ninguna búsqueda reciente. Primero busca con *.searchpack <texto>* y después eliges el número.'
        )
      }
      const pack = entry.results[position - 1]
      if (!pack) {
        throw new Error(
          `Solo hay ${entry.results.length} resultado(s) en «${truncate(entry.query, 30)}». Usa un número del 1 al ${entry.results.length}.`
        )
      }
      const full = pack.stickers?.length ? pack : await resolvePack(pack.id, { config: ctx.config, logger: ctx.logger })
      const result = await importPack(ctx, { pack: full, target: pack.id })
      ctx.store.searches?.clear(ctx.chatJid)
      return result
    }

    // 4) Enlace o código de paquete (sirve para los privados)
    if (looksLikePackCode(text)) {
      const pack = await resolvePack(text, { config: ctx.config, logger: ctx.logger }).catch((error) => {
        throw new Error(friendlySearchError(error))
      })
      return importPack(ctx, { pack, target: parsePackId(text) || text })
    }

    // 5) Búsqueda por texto → buscar y enviar el primer paquete automáticamente
    await ctx.sendLive(packSlot(ctx), `🔎 Buscando paquetes de *${truncate(text, 40)}*…`)
    let found
    try {
      found = await searchPacks({
        query: text,
        page,
        limit: Math.max(5, settings.maxResults),
        config: ctx.config,
        logger: ctx.logger
      })
    } catch (error) {
      await ctx.finishLive(packSlot(ctx), `💦 No pude buscar *${truncate(text, 40)}*.`)
      throw new Error(friendlySearchError(error))
    }

    if (!found.results.length) {
      await ctx.finishLive(
        packSlot(ctx),
        `💧 No encontré paquetes para *${truncate(text, 40)}*. Prueba con otra palabra o pega el enlace del paquete.`
      )
      return `searchpack "${text}" sin resultados`
    }

    // Enviar automáticamente el primer paquete encontrado
    const best = found.results[0]
    const full = best.stickers?.length ? best : await resolvePack(best.id, { config: ctx.config, logger: ctx.logger })
    await ctx.sendLive(packSlot(ctx), `✅ Encontré *${truncate(best.name || 'paquete', 40)}*. Descargando…`)
    const result = await importPack(ctx, { pack: full, target: best.id })
    return result
  }
}

/** Resuelve el destino de un `get` (número de la lista, código o enlace) */
async function targetPack(ctx, target) {
  if (/^\d{1,3}$/.test(target)) {
    const { entry, item } = ctx.store.searches?.pick(ctx.chatJid, Number(target)) || {}
    if (!entry || !item) {
      throw new Error(
        'Ese número no está en la última búsqueda. Busca primero con *.searchpack <texto>* o pasa el código del paquete.'
      )
    }
    return item.stickers?.length ? item : resolvePack(item.id, { config: ctx.config, logger: ctx.logger })
  }
  return resolvePack(target, { config: ctx.config, logger: ctx.logger }).catch((error) => {
    throw new Error(friendlySearchError(error))
  })
}
