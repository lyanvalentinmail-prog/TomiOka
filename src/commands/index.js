import emojimix from './emojimix.js'
import gif from './gif.js'
import help from './help.js'
import pack from './pack.js'
import steal from './steal.js'
import sticker from './sticker.js'
import take from './take.js'
import toimg from './toimg.js'
import tovideo from './tovideo.js'

export const commandList = [sticker, gif, toimg, tovideo, take, steal, emojimix, pack, help]

/** Mapa nombre/alias -> comando */
export const commands = new Map()

for (const command of commandList) {
  if (!command?.name || typeof command.run !== 'function') {
    throw new Error(`Comando inválido: ${command?.name || 'sin nombre'}`)
  }
  if (commands.has(command.name)) throw new Error(`Comando duplicado: ${command.name}`)
  commands.set(command.name, command)
  for (const alias of command.aliases || []) {
    if (commands.has(alias)) throw new Error(`Alias duplicado: ${alias}`)
    commands.set(alias, command)
  }
}

export function findCommand(name) {
  if (!name) return null
  return commands.get(String(name).toLowerCase()) || null
}

export function isCommandRegistered(command) {
  return commandList.includes(command)
}

export default commands
