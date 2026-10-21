import { convertToSticker } from '../lib/media.js'
import { extractEmojis } from '../lib/text.js'
import { codePointToEmoji, downloadMix, findMix, indexInfo, randomMix } from '../lib/emojimix.js'

export default {
  name: 'emojimix',
  aliases: ['mix', 'emojimashup'],
  category: 'extras',
  description: 'Combinar emojis.',
  usage: '.emojimix 😀 🔥  (o sin emojis para una mezcla aleatoria)',
  examples: ['.emojimix 😺 🐼', '.emojimix'],
  async run(ctx) {
    const settings = ctx.config.emojimix
    if (!settings.enabled) throw new Error('emojimix está desactivado en config.json')

    const options = {
      cacheFile: settings.cacheFile,
      metadataUrl: settings.metadataUrl,
      mirrors: [
        'https://cdn.jsdelivr.net/gh/xsalazar/emoji-kitchen-backend@main/app/metadata.json',
        'https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/master/app/metadata.json'
      ],
      timeoutMs: settings.timeoutMs,
      logger: ctx.logger
    }

    const emojis = extractEmojis(ctx.argsText)
    if (emojis.length === 1) {
      throw new Error('Necesito *dos* emojis para combinarlos. Ejemplo: *.emojimix 😺 🐼*')
    }

    const firstRun = !indexInfo(options).loaded && !indexInfo(options).cached
    if (firstRun) {
      await ctx.reply(
        '⏳ Preparando el catálogo de *Emoji Kitchen* (solo la primera vez, ~50 MB). Dame un momento...'
      )
    }

    let mix
    let used = emojis.slice(0, 2)
    if (used.length === 2) {
      mix = await findMix(used[0], used[1], options)
      if (!mix) {
        throw new Error(
          `No encontré combinación para ${used[0]} + ${used[1]} 😔\nPrueba con otros emojis (caritas, animales, comidas y corazones funcionan mejor).`
        )
      }
    } else {
      mix = await randomMix(options)
      if (!mix) throw new Error('El catálogo de emojis está vacío. Intenta de nuevo más tarde.')
      used = mix.key.split('_').map((code) => codePointToEmoji(code))
    }

    const png = await downloadMix(mix.url)
    const result = await convertToSticker(png, {
      extension: 'png',
      animated: false,
      settings: ctx.config.stickers,
      logger: ctx.logger
    })

    await ctx.sendSticker(result.buffer, { emojis: used })
    return `emojimix ${used.join('+')}`
  }
}
