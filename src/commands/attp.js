import { createTextSticker } from '../lib/text-sticker.js'

export default {
  name: 'attp',
  aliases: [],
  category: 'stickers',
  description: 'Crear un sticker animado de texto con colores.',
  usage: '.attp <texto>',
  examples: ['.attp hola'],
  async run(ctx) {
    const text = ctx.argsText.trim()
    if (!text) throw new Error(`Uso: ${ctx.prefix}attp <texto>`)
    const result = await createTextSticker(text, {
      mode: 'attp',
      settings: ctx.config.stickers,
      logger: ctx.logger
    })
    await ctx.sendSticker(result.buffer)
    return 'sticker ATTP creado'
  }
}
