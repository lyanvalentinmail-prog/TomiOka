import { downloadWithYtDlp, validateDownloadUrl } from '../lib/downloaders.js'

export default {
  name: 'ytmp3',
  aliases: ['ytmp-3', 'youtube-mp3'],
  category: 'descargas',
  description: 'Descargar el audio de YouTube en MP3.',
  usage: '.ytmp3 <enlace>',
  examples: ['.ytmp3 https://youtu.be/VIDEO_ID'],
  async run(ctx) {
    const url = validateDownloadUrl(
      'youtube',
      ctx.argsText,
      `Uso: ${ctx.prefix}ytmp3 <enlace de YouTube>`
    )
    await ctx.reply('🌊 Extrayendo audio de *YouTube* en MP3...')
    const file = await downloadWithYtDlp({
      platform: 'youtube',
      mediaType: 'audio',
      url,
      logger: ctx.logger
    })
    await ctx.sock.sendMessage(
      ctx.chatJid,
      {
        audio: file.buffer,
        mimetype: 'audio/mpeg',
        fileName: file.fileName,
        ptt: false
      },
      { quoted: ctx.msg }
    )
    return 'audio de YouTube descargado'
  }
}
