import { readSticker, writeStickerMetadata } from '../lib/sticker.js'
import { splitNameAuthor, truncate } from '../lib/text.js'

export default {
  name: 'take',
  aliases: ['autor', 'rename', 'packname'],
  category: 'conversion',
  description: 'Cambiar nombre o autor del sticker.',
  usage: '.take Nombre | Autor (responde a un sticker)',
  examples: ['.take Tomioka | 🌊', '.take Mi pack'],
  async run(ctx) {
    ctx.requireMedia(
      ['sticker'],
      'Responde a un *sticker* con *.take Nombre | Autor* para cambiarle el nombre y el autor.'
    )
    const buffer = await ctx.download()
    const info = await readSticker(buffer)
    const emojis = info.metadata?.emojis || []

    const hasArgs = Boolean(ctx.argsText)
    const { name, author } = splitNameAuthor(ctx.argsText, {
      name: ctx.config.stickers.packName,
      author: ctx.config.stickers.packAuthor
    })

    const out = await writeStickerMetadata(buffer, {
      packName: name,
      packAuthor: author,
      emojis,
      packId: info.metadata?.['sticker-pack-id']
    })
    await ctx.sendSticker(out, { withMetadata: false })

    return hasArgs
      ? `take → ${truncate(name, 24)} / ${truncate(author, 24)}`
      : 'take → metadatos por defecto'
  }
}
