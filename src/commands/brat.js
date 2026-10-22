import { createTextSticker } from '../lib/text-sticker.js'

export default {
  name: 'brat',
  aliases: [],
  category: 'stickers',
  description: 'Crear un sticker estilo Brat desde un texto.',
  usage: '.brat <texto>',
  examples: ['.brat tomioka'],
  async run(ctx) {
    const text = ctx.argsText.trim()
    if (!text) throw new Error(`Uso: ${ctx.prefix}brat <texto>`)
    const result = await createTextSticker(text, {
      mode: 'brat',
      settings: ctx.config.stickers,
      logger: ctx.logger
    })
    await ctx.sendSticker(result.buffer)
    return 'sticker Brat creado'
  }
}
