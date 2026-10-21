import { boldDigits, pickRandom, truncate } from './lib/text.js'

const FILLER = 'ㅤ' // HANGUL FILLER (espacio invisible aesthetic)

const SEPARATOR = `${FILLER}${FILLER}࿚ׄ࿙ֹ࿚᮫᜔۬፟֟࿙ֹ࿚ׄ࿙`

/**
 * Comandos de una categoría. Si la categoría no define `commands`
 * (o la lista está vacía) se muestran TODOS los comandos registrados.
 * @returns {Array<object>} comandos sin duplicados y en orden de registro
 */
export function resolveCategoryCommands(category, commands = new Map()) {
  // Los comandos "hidden" (como .debug) no se listan en el menú
  const all = [...new Set((commands ?? new Map()).values())].filter((command) => !command.hidden)
  const wanted = Array.isArray(category?.commands) ? category.commands.filter(Boolean) : []
  if (!wanted.length) return all

  const selected = []
  for (const name of wanted) {
    const command = commands.get(String(name).toLowerCase())
    if (command && !command.hidden && !selected.includes(command)) selected.push(command)
  }
  return selected
}

function header({ name }) {
  return [
    `${FILLER}➢${FILLER}︵ ₊˚๑ ꒰♯🌊⸝⸝${name}─𓉳 ꒱`,
    `${FILLER}⌞${FILLER}≪⁹⁹${FILLER}⁙${FILLER}${name}${FILLER}◌`,
    `${FILLER}${FILLER}${FILLER}𓆩 💧 𓆪`,
    `${FILLER}${FILLER}${FILLER}𝓜𝓮𝓷𝓾 𝓭𝓮 𝓬𝓸𝓶𝓪𝓷𝓭𝓸𝓼`,
    `${FILLER}${FILLER}${FILLER}( ᵕ ᴗ ᵕ )♡`,
    SEPARATOR,
    `${FILLER}🌊${FILLER}׃${FILLER} 𝕴𝐍𝐅𝐎𝐑𝐌𝐀𝐂𝐈𝐎𝐍 ${FILLER}׃`,
    `${FILLER}${FILLER}𓂃 𝖻𝗈𝗍 𝗂𝗇𝖿𝗈𝗋𝗆𝖺𝗍𝗂𝗈𝗇 𓂃`,
    `${FILLER}𖦹${FILLER}𝖭𝖺𝗆𝖾${FILLER}⁙    ${name}`
  ]
}

function infoBlock(context) {
  const { config, sender } = context
  const { bot } = config
  const lines = [
    `${FILLER}𖦹${FILLER}𝖳𝖾𝖺m${FILLER}⁙    ${bot.team}`,
    `${FILLER}𖦹${FILLER}𝖯𝗋𝖾𝖿𝗂x${FILLER}⁙${FILLER}${config.prefixes[0]}`,
    `${FILLER}𖦹${FILLER}𝖲𝗍𝖺𝗍𝗎𝗌${FILLER}⁙${FILLER}${bot.status}`,
    `${FILLER}𖦹${FILLER}𝖵𝖾𝗋𝗌𝗂𝗈𝗇${FILLER}⁙${FILLER}${boldDigits(bot.version)}`
  ]

  if (config.menu.showUser && sender?.label) {
    lines.push(`${FILLER}𖦹${FILLER}𝖴𝗌𝖾𝗋${FILLER}⁙${FILLER}${truncate(sender.label, 28)}`)
  }
  lines.push(`${FILLER}𖦹${FILLER}𝖧𝖾𝗅𝗉${FILLER}⁙${FILLER}${config.prefixes[0]}help <comando>`)
  lines.push(`${FILLER}${FILLER}${FILLER}(˶ᵔ ᵕ ᵔ˶) .ᐟ`, SEPARATOR)
  return lines
}

function categoryBlock(category, index, { config, commands }) {
  const prefix = config.prefixes[0]
  const [left, right] = category.divider || ['💧', '🌊']
  const number = boldDigits(String(index + 1).padStart(2, '0'))

  const lines = [
    `${FILLER}${FILLER}◢ ${number} ◣`,
    `${category.emoji || '🌊'}${FILLER}׃${FILLER} 𝕮𝖆𝖙𝖊𝖌𝖔𝖗𝖎𝖆${number} ${FILLER}׃`,
    `${FILLER}${FILLER}𓂃 ${category.description || '𝖼𝗈𝗆𝖺𝗇𝖽𝗈𝗌'} 𓂃`,
    `${FILLER}${FILLER}${FILLER}${category.kaomoji || '( ᵕ ᵗ ᵕ )'}`
  ]

  // Solo el comando (sin descripción), uno por línea y sin espacios en blanco
  for (const command of resolveCategoryCommands(category, commands)) {
    lines.push(`୨ৎ${FILLER}${prefix}${command.name}`)
  }

  lines.push(
    `${FILLER}${FILLER}࿙${left}࿚${FILLER}𓆩 ${right} 𓆪`,
    `${FILLER}${FILLER}${FILLER}( ᴗ͈ˬᴗ͈)${FILLER}⁙`,
    SEPARATOR
  )
  return lines
}

function footer({ config }) {
  const { bot, menu } = config
  const phrase = pickRandom(menu.phrases) || ''

  return [
    `${FILLER}${FILLER}${FILLER}𓆩${FILLER}🌊${FILLER}𓆪`,
    `${FILLER}${FILLER} 𝕰𝐍𝐃 𝐎𝐅 𝐌𝐄𝐍𝐔`,
    `${FILLER}${FILLER}${FILLER}( ᴗ͈ˬᴗ͈) ♡`,
    `${FILLER}${FILLER}「 ${phrase} 」`,
    `${FILLER}⌞${FILLER}≪⁹⁹${FILLER}⁙${FILLER}${bot.name}`,
    `${FILLER}${FILLER}${FILLER}𝖾𝗌𝗍.${FILLER}${boldDigits(bot.year)}`,
    `${FILLER}${FILLER}࿚ׄ࿚${FILLER}𓆩 🌊 𓆪${FILLER}࿙ׄ࿚`
  ]
}

/**
 * Construye el menú completo: sin líneas vacías y con todos los comandos
 * agrupados en las categorías definidas en config.json.
 * @param {{config:object, commands:Map<string,object>, sender?:{label?:string, jid?:string}}} options
 */
export function buildMenu({ config, commands = new Map(), sender = {} }) {
  const categories = config.menu.categories?.length
    ? config.menu.categories
    : [{ emoji: '🌊', description: '𝖼𝗈𝗆𝖺𝗇𝖽𝗈𝗌', kaomoji: '( ᵕ ᵗ ᵕ )', commands: [] }]

  const lines = [
    ...header({ name: config.bot.name }),
    ...infoBlock({ config, sender }),
    ...categories.flatMap((category, index) => categoryBlock(category, index, { config, commands })),
    ...footer({ config })
  ]
  return lines.join('\n')
}

/** Tarjeta de ayuda de un comando concreto (compacta, sin líneas vacías) */
export function buildCommandHelp({ config, command }) {
  const prefix = config.prefixes[0]
  const lines = [
    `${FILLER}𓆩 💧 𓆪${FILLER}𝕮𝖔𝖒𝖆𝖓𝖉𝖔`,
    `${FILLER}𖦹${FILLER}𝖭𝗈𝗆𝖻𝗋𝖾${FILLER}⁙${FILLER}${prefix}${command.name}`,
    `${FILLER}𖦹${FILLER}𝖣𝖾𝗌𝖼𝗋𝗂𝗉𝖼𝗂𝗈́𝗇${FILLER}⁙${FILLER}${command.description || '-'}`,
    `${FILLER}𖦹${FILLER}𝖴𝗌𝗈${FILLER}⁙${FILLER}${command.usage || `${prefix}${command.name}`}`,
    command.aliases?.length
      ? `${FILLER}𖦹${FILLER}𝖠𝗅𝗂𝖺𝗌${FILLER}⁙${FILLER}${command.aliases
          .map((alias) => `${prefix}${alias}`)
          .join(' ')}`
      : null,
    ...(command.examples || []).map((example) => `${FILLER}${FILLER}❥${FILLER}${example}`),
    `${FILLER}${FILLER}${FILLER}( ᴗ͈ˬᴗ͈) ♡`,
    `${FILLER}${FILLER}࿚ׄ࿙ֹ࿚᮫᜔۬፟֟࿙ֹ࿚ׄ࿙`
  ]
  return lines.filter((line) => line !== null).join('\n')
}

export { FILLER, SEPARATOR }
