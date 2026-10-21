import { convertToSticker } from '../lib/media.js'
import { extensionFor } from '../lib/message.js'
import { isAnimatedExtension } from '../lib/ffmpeg.js'
import { isWebp } from '../lib/sticker.js'

const MEDIA_KINDS = ['image', 'video', 'sticker', 'document']

export default {
  name: 'sticker',
  aliases: ['s', 'stiker', 'figu'],
  category: 'stickers',
  description: 'Crear sticker desde una imagen.',
  usage: '.sticker (responde a una imagen, video o GIF)',
  examples: ['.sticker', '.s'],
  async run(ctx) {
    const target = ctx.requireMedia(
      MEDIA_KINDS,
      'Responde a una *imagen*, *video*, *GIF* o *sticker* con *.sticker* para convertirlo.'
    )

    const buffer = await ctx.download(target)

    // Un sticker se reenvía con los metadatos del bot (sin recodificar)
    if (target.kind === 'sticker' || isWebp(buffer)) {
      await ctx.sendSticker(buffer)
      return 'sticker reenviado'
    }

    const extension = extensionFor(target.media)
    const animated =
      target.kind === 'video' ||
      isAnimatedExtension(extension) ||
      String(target.media?.mimetype || '').includes('gif')

    if (target.kind === 'document' && !/^(image|video)\//.test(target.media?.mimetype || '')) {
      throw new Error('El documento no es una imagen ni un video compatible.')
    }

    const result = await convertToSticker(buffer, {
      extension,
      animated,
      settings: ctx.config.stickers,
      logger: ctx.logger
    })

    await ctx.sendSticker(result.buffer)

    const parts = [`✅ ${animated ? 'Sticker animado' : 'Sticker'} creado`]
    if (result.warning) parts.push(result.warning)
    if (animated) parts.push('se recortó a los primeros segundos permitidos')
    return parts.join(' · ')
  }
}
