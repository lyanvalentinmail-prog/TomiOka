import { convertToSticker } from '../lib/media.js'
import { extensionFor } from '../lib/message.js'

export default {
  name: 'gif',
  aliases: ['stikergif', 'togif'],
  category: 'stickers',
  description: 'Convertir un GIF en sticker.',
  usage: '.gif (responde a un GIF o video)',
  examples: ['.gif'],
  async run(ctx) {
    const target = ctx.requireMedia(
      ['video', 'document', 'sticker', 'image'],
      'Responde a un *GIF* (o video) con *.gif* para convertirlo en sticker animado.'
    )

    const buffer = await ctx.download(target)
    const extension = extensionFor(target.media)

    const isDocument = target.kind === 'document'
    if (isDocument && !/^(video|image)\//.test(target.media?.mimetype || '')) {
      throw new Error('El documento no es un GIF o video compatible.')
    }

    const result = await convertToSticker(buffer, {
      extension,
      animated: true,
      settings: ctx.config.stickers,
      logger: ctx.logger
    })

    await ctx.sendSticker(result.buffer)

    const parts = ['✅ Sticker animado creado']
    if (result.warning) parts.push(result.warning)
    return parts.join(' · ')
  }
}
