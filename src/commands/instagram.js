import { downloadWithYtDlp, validateDownloadUrl } from '../lib/downloaders.js'

export default {
  name: 'instagram',
  aliases: ['ig', 'instagramdl', 'igdl'],
  category: 'descargas',
  description: 'Descargar un video o reel de Instagram.',
  usage: '.instagram <enlace>',
  examples: ['.instagram https://www.instagram.com/reel/ABC123/'],
  async run(ctx) {
    const url = validateDownloadUrl(
      'instagram',
      ctx.argsText,
      `Uso: ${ctx.prefix}instagram <enlace de Instagram>`
    )
    await ctx.reply('⏳ Descargando video de *Instagram*...')
    const file = await downloadWithYtDlp({
      platform: 'instagram',
      mediaType: 'video',
      url,
      logger: ctx.logger
    })
    await ctx.sendVideo(file.buffer, '✅ Video de Instagram descargado')
    return 'video de Instagram descargado'
  }
}
