import { stickerToImage } from '../lib/media.js'
import { isAnimatedWebp } from '../lib/sticker.js'

export default {
  name: 'toimg',
  aliases: ['toimage', 'stickerimg', 'img'],
  category: 'conversion',
  description: 'Convertir sticker a imagen.',
  usage: '.toimg (responde a un sticker)',
  examples: ['.toimg'],
  async run(ctx) {
    ctx.requireMedia(['sticker'], 'Responde a un *sticker* con *.toimg* para pasarlo a imagen.')
    const buffer = await ctx.download()
    const animated = await isAnimatedWebp(buffer)
    const png = await stickerToImage(buffer)

    await ctx.sendImage(
      png,
      animated ? '💧 Imagen generada (primer cuadro del sticker animado).' : '💧 Sticker convertido a imagen.'
    )
    return `toimg ${animated ? 'animado→png (frame 1)' : 'png'} ${Math.round(png.length / 1024)}KB`
  }
}
