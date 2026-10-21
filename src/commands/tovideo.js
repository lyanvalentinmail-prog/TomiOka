import { stickerToVideo } from '../lib/media.js'

export default {
  name: 'tovideo',
  aliases: ['tomp4', 'stikervideo'],
  category: 'conversion',
  description: 'Convertir sticker a video.',
  usage: '.tovideo (responde a un sticker)',
  examples: ['.tovideo'],
  async run(ctx) {
    ctx.requireMedia(['sticker'], 'Responde a un *sticker* con *.tovideo* para pasarlo a video.')
    const buffer = await ctx.download()
    const { buffer: mp4, animated } = await stickerToVideo(buffer)

    await ctx.sendVideo(mp4, animated ? '🎬 Sticker animado convertido a video.' : '🎬 Sticker convertido a video.', {
      gifPlayback: false
    })
    return `tovideo ${animated ? 'animado' : 'estático'} ${Math.round(mp4.length / 1024)}KB`
  }
}
