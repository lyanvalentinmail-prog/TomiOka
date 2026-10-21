import { loadMenuImage } from '../lib/banner.js'
import { RETIRED_MENU_TEXT } from '../lib/live-messages.js'
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

    // Todos los menús anteriores se retiran para que no se acumulen en el
    // chat: los de texto quedan editados como "Menu eliminado." y los que
    // llevan banner (foto) se eliminan para todos, porque WhatsApp no
    // permite editar una foto hasta convertirla en texto.
    await ctx.retireLive('menu', RETIRED_MENU_TEXT)

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
        const sent = await ctx.sendImage(banner.buffer, menu)
        // Es una foto: al pedir otro menú se elimina, no se edita a texto
        ctx.rememberLive('menu', sent, { kind: 'media' })
        return `menu con imagen (${banner.type}, ${banner.fromCache ? 'caché' : 'descargada'})`
      }
      const image = await ctx.sendImage(banner.buffer, '')
      const text = await ctx.reply(menu)
      ctx.rememberLive('menu', image, { kind: 'media' })
      ctx.rememberLive('menu', text, { kind: 'text' })
      return `menu con imagen aparte (${banner.type})`
    }

    const sent = await ctx.reply(menu)
    ctx.rememberLive('menu', sent, { kind: 'text' })
    return 'menu (sin imagen)'
  }
}
