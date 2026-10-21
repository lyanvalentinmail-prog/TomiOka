import { isWebp, newPackId, readSticker, writeStickerMetadata } from '../lib/sticker.js'
import { truncate } from '../lib/text.js'
import { toStickerBuffer } from './take.js'

export default {
  name: 'steal',
  aliases: ['robar', 'copy', 'copiar'],
  category: 'stickers',
  description: 'Copiar un sticker.',
  usage: '.steal (responde a un sticker, foto o video)',
  examples: ['.steal'],
  async run(ctx) {
    const target = ctx.requireMedia(
      ['sticker', 'image', 'video', 'document'],
      'Responde a un *sticker* (o una foto/video) con *.steal* para copiarlo con el nombre del bot.'
    )

    if (target.kind !== 'sticker') await ctx.typing('composing')
    const { buffer, converted, emojis } = await toStickerBuffer(ctx, target)
    if (!isWebp(buffer)) throw new Error('El archivo recibido no es un sticker válido.')

    const info = await readSticker(buffer).catch(() => ({ metadata: null }))
    const packName = ctx.config.stickers.packName
    const packAuthor = ctx.config.stickers.packAuthor

    const out = await writeStickerMetadata(buffer, {
      packName,
      packAuthor,
      emojis: emojis?.length ? emojis : info.metadata?.emojis || [],
      packId: newPackId()
    })

    await ctx.sendSticker(out, { withMetadata: false })
    await ctx.reply(
      [
        '📋 *Sticker copiado*',
        `▸ Nombre: *${truncate(packName, 40)}*`,
        `▸ Autor: *${truncate(packAuthor, 40)}*`,
        converted ? '▸ Convertido a sticker desde el archivo enviado' : null
      ]
        .filter(Boolean)
        .join('\n')
    )

    return `steal → copiado${converted ? ' (convertido)' : ''}`
  }
}
