import { createTextSticker } from '../lib/text-sticker.js'

export default {
  name: 'ttp',
  aliases: [],
  category: 'stickers',
  description: 'Crear un sticker de texto con borde.',
  usage: '.ttp <texto>',
  examples: ['.ttp hola'],
  async run(ctx) {
    const text = ctx.argsText.trim()
    if (!text) throw new Error(`Uso: ${ctx.prefix}ttp <texto>`)
    const result = await createTextSticker(text, {
      mode: 'ttp',
      settings: ctx.config.stickers,
      logger: ctx.logger
    })
    await ctx.sendSticker(result.buffer)
    return 'sticker TTP creado'
  }
}
