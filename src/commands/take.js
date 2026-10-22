import { convertToSticker } from '../lib/media.js'
import { extensionFor } from '../lib/message.js'
import { isAnimatedExtension } from '../lib/ffmpeg.js'
import { isWebp, newPackId, readSticker, writeStickerMetadata } from '../lib/sticker.js'
import { splitNameAuthor, truncate } from '../lib/text.js'

const KINDS = ['sticker', 'image', 'video', 'document']

const HELP =
  'Responde a un *sticker* (o a una foto/video) con *.take Nombre | Autor* para cambiarle el nombre y el autor.'

/**
 * Devuelve un WebP válido a partir del media recibido.
 * Si el usuario responde a una foto o un video, primero se convierte en sticker.
 */
export async function toStickerBuffer(ctx, target, { animated = null } = {}) {
  // Validación temprana: evita descargar archivos que no se pueden convertir
  if (target.kind === 'document' && !/^(image|video)\//.test(target.media?.mimetype || '')) {
    throw new Error(
      'Ese documento no es una imagen ni un video: manda el archivo como foto o video para poder convertirlo.'
    )
  }

  const buffer = await ctx.download(target)
  if (target.kind === 'sticker' || isWebp(buffer)) {
    return { buffer, converted: false, emojis: await emojisOf(buffer) }
  }

  const extension = extensionFor(target.media)
  const isAnimated =
    animated ??
    (target.kind === 'video' ||
      isAnimatedExtension(extension) ||
      String(target.media?.mimetype || '').includes('gif'))

  const result = await convertToSticker(buffer, {
    extension,
    animated: isAnimated,
    settings: ctx.config.stickers,
    logger: ctx.logger
  })
  return { buffer: result.buffer, converted: true, emojis: [], warning: result.warning }
}

async function emojisOf(buffer) {
  try {
    const info = await readSticker(buffer)
    return info.metadata?.emojis || []
  } catch {
    return []
  }
}

export default {
  name: 'take',
  aliases: ['autor', 'rename', 'packname'],
  category: 'conversion',
  description: 'Cambiar nombre o autor del sticker.',
  usage: '.take Nombre | Autor (responde a un sticker, foto o video)',
  examples: ['.take Tomioka | 🌊💙', '.take Mi pack'],
  async run(ctx) {
    const target = ctx.requireMedia(KINDS, HELP)

    const { name, author } = splitNameAuthor(ctx.argsText, {
      name: ctx.config.stickers.packName,
      author: ctx.config.stickers.packAuthor
    })
    if (!name) throw new Error('Necesito un nombre. Ejemplo: *.take Olas del mar | Tomi*')

    if (target.kind !== 'sticker') await ctx.typing('composing')
    const { buffer, converted, emojis } = await toStickerBuffer(ctx, target)

    // Un pack-id nuevo hace que WhatsApp refresque el nombre del pack
    const out = await writeStickerMetadata(buffer, {
      packName: name,
      packAuthor: author,
      emojis,
      packId: newPackId()
    })

    await ctx.sendSticker(out, { withMetadata: false })

    const lines = [
      '💙 *Sticker actualizado*',
      `▸ Nombre: *${truncate(name, 40)}*`,
      `▸ Autor: *${truncate(author, 40)}*`
    ]
    if (converted) lines.push('▸ Convertido a sticker desde el archivo enviado')
    lines.push('_Si WhatsApp sigue mostrando el nombre viejo: borra el sticker del chat y vuelve a enviarlo._')

    await ctx.reply(lines.join('\n'))
    return `take → ${truncate(name, 24)} / ${truncate(author, 24)}${converted ? ' (convertido)' : ''}`
  }
}

export { toStickerBuffer as toSticker, emojisOf }
