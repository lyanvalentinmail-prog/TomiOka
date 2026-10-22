import { downloadWithYtDlp, validateDownloadUrl } from '../lib/downloaders.js'

export default {
  name: 'pinterest',
  aliases: ['pin', 'pinterestdl', 'pindl', 'pinvideo'],
  category: 'descargas',
  description: 'Descargar un video (o la imagen) de un pin de Pinterest.',
  usage: '.pinterest <enlace>',
  examples: [
    '.pinterest https://www.pinterest.com/pin/123456789012/',
    '.pinterest https://pin.it/AbC1dEfGh'
  ],
  async run(ctx) {
    const url = validateDownloadUrl(
      'pinterest',
      ctx.argsText,
      `Uso: ${ctx.prefix}pinterest <enlace de Pinterest>`
    )
    await ctx.reply('⏳ Descargando pin de *Pinterest*...')
    const file = await downloadWithYtDlp({
      platform: 'pinterest',
      mediaType: 'video',
      url,
      logger: ctx.logger
    })

    // Un pin puede ser video o foto: se envía según lo que devolvió yt-dlp.
    if (file.kind === 'image') {
      await ctx.sendImage(file.buffer, '✅ Imagen de Pinterest descargada')
      return 'imagen de Pinterest descargada'
    }
    await ctx.sendVideo(file.buffer, '✅ Video de Pinterest descargado')
    return 'video de Pinterest descargado'
  }
}
