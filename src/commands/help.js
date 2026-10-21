import { loadMenuImage } from '../lib/banner.js'
import { buildCommandHelp, buildMenu } from '../menu.js'

/**
 * Límite de texto que WhatsApp acepta como pie de foto.
 * Si el menú es más largo, la imagen se envía aparte.
 */
const CAPTION_LIMIT = 1000

export default {
  name: 'help',
  aliases: ['menu', 'comandos', 'ayuda', 'h'],
  category: 'extras',
  description: 'Ver los comandos disponibles.',
  usage: '.help  ·  .help sticker',
  examples: ['.help', '.help sticker'],
  async run(ctx) {
    const requested = (ctx.args[0] || '').replace(/^[./!#]/, '').toLowerCase()

    if (requested) {
      const command = ctx.commands?.get(requested)
      if (!command) {
        throw new Error(`No existe el comando *${requested}*. Usa *.help* para ver el menú.`)
      }
      await ctx.reply(buildCommandHelp({ config: ctx.config, command }))
      return `help ${command.name}`
    }

    const menu = buildMenu({
      config: ctx.config,
      commands: ctx.commands,
      sender: { label: ctx.pushName || ctx.senderNumber, jid: ctx.senderJid }
    })

    // Menú con banner (imagen de Drive, URL o archivo local)
    const banner = await loadMenuImage(ctx.config, { logger: ctx.logger })
    if (banner) {
      const asCaption = ctx.config.menu.sendAsCaption !== false
      if (asCaption && menu.length <= CAPTION_LIMIT) {
        await ctx.sendImage(banner.buffer, menu)
        return `menu con imagen (${banner.type}, ${banner.fromCache ? 'caché' : 'descargada'})`
      }
      await ctx.sendImage(banner.buffer, '')
      await ctx.reply(menu)
      return `menu con imagen aparte (${banner.type})`
    }

    await ctx.reply(menu)
    return 'menu (sin imagen)'
  }
}
