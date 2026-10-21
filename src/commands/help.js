import { fetchBuffer } from '../lib/http.js'
import { buildCommandHelp, buildMenu } from '../menu.js'

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

    if (ctx.config.menu.image) {
      try {
        const image = await fetchBuffer(ctx.config.menu.image, { timeoutMs: 20000, retries: 1 })
        await ctx.sendImage(image, menu)
        return 'menu con imagen'
      } catch (error) {
        ctx.logger?.warn?.(`No se pudo enviar la imagen del menú: ${error.message}`)
      }
    }

    await ctx.reply(menu)
    return 'menu'
  }
}
