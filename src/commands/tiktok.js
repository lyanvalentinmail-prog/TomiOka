import { downloadWithYtDlp, validateDownloadUrl } from '../lib/downloaders.js'

export default {
  name: 'tiktok',
  aliases: ['tiktokdl', 'ttdl'],
  category: 'descargas',
  description: 'Descargar un video de TikTok.',
  usage: '.tiktok <enlace>',
  examples: ['.tiktok https://www.tiktok.com/@usuario/video/123'],
  async run(ctx) {
    const url = validateDownloadUrl(
      'tiktok',
      ctx.argsText,
      `Uso: ${ctx.prefix}tiktok <enlace de TikTok>`
    )
    await ctx.reply('⏳ Descargando video de *TikTok*...')
    const file = await downloadWithYtDlp({
      platform: 'tiktok',
      mediaType: 'video',
      url,
      logger: ctx.logger
    })
    await ctx.sendVideo(file.buffer, '✅ Video de TikTok descargado')
    return 'video de TikTok descargado'
  }
}
