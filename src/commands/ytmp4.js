import { downloadWithYtDlp, validateDownloadUrl } from '../lib/downloaders.js'

export default {
  name: 'ytmp4',
  aliases: ['ytmp-4', 'youtube-mp4'],
  category: 'descargas',
  description: 'Descargar un video de YouTube en MP4.',
  usage: '.ytmp4 <enlace>',
  examples: ['.ytmp4 https://youtu.be/VIDEO_ID'],
  async run(ctx) {
    const url = validateDownloadUrl(
      'youtube',
      ctx.argsText,
      `Uso: ${ctx.prefix}ytmp4 <enlace de YouTube>`
    )
    await ctx.reply('🌊 Descargando video de *YouTube* en MP4...')
    const file = await downloadWithYtDlp({
      platform: 'youtube',
      mediaType: 'video',
      url,
      logger: ctx.logger
    })
    await ctx.sendVideo(file.buffer, '💧 Video de YouTube descargado 💙')
    return 'video de YouTube descargado'
  }
}
