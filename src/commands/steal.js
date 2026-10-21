import { readSticker, writeStickerMetadata, newPackId } from '../lib/sticker.js'

export default {
  name: 'steal',
  aliases: ['robar', 'copy', 'copiar'],
  category: 'stickers',
  description: 'Copiar un sticker.',
  usage: '.steal (responde a un sticker)',
  examples: ['.steal'],
  async run(ctx) {
    ctx.requireMedia(
      ['sticker'],
      'Responde a un *sticker* con *.steal* para copiarlo con el nombre del bot.'
    )
    const buffer = await ctx.download()
    const info = await readSticker(buffer)

    const out = await writeStickerMetadata(buffer, {
      packName: ctx.config.stickers.packName,
      packAuthor: ctx.config.stickers.packAuthor,
      emojis: info.metadata?.emojis || [],
      packId: newPackId()
    })

    await ctx.sendSticker(out, { withMetadata: false })
    return 'steal → copiado'
  }
}
