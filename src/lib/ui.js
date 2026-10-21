import { c, sym, visibleWidth } from './colors.js'

export const BANNER = String.raw`
 ████████╗ ██████╗ ███╗   ███╗██╗ ██████╗ ██╗  ██╗ █████╗
 ╚══██╔══╝██╔═══██╗████╗ ████║██║██╔═══██╗██║ ██╔╝██╔══██╗
    ██║   ██║   ██║██╔████╔██║██║██║   ██║█████╔╝ ███████║
    ██║   ██║   ██║██║╚██╔╝██║██║██║   ██║██╔═██╗ ██╔══██║
    ██║   ╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║  ██╗██║  ██║
    ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝`

const stamp = () => c.gray(new Date().toLocaleTimeString('es-UY', { hour12: false }))

export function log(message) {
  process.stdout.write(`${message}\n`)
}

export function raw(message) {
  process.stdout.write(`${message}\n`)
}

export function info(message) {
  log(`${stamp()} ${sym.info}  ${message}`)
}

export function ok(message) {
  log(`${stamp()} ${sym.ok}  ${c.green(message)}`)
}

export function warn(message) {
  log(`${stamp()} ${sym.warn}  ${c.yellow(message)}`)
}

export function error(message) {
  log(`${stamp()} ${sym.err}  ${c.red(message)}`)
}

export function step(message) {
  log(`${stamp()} ${c.cyan(String(message))}`)
}

export function title(text) {
  const line = `${sym.wave} ${c.bold(text)}`
  log('')
  log(c.cyan('─'.repeat(Math.min(58, Math.max(28, visibleWidth(text) + 8)))))
  log(line)
  log(c.cyan('─'.repeat(Math.min(58, Math.max(28, visibleWidth(text) + 8)))))
}

export function banner({ name, team, version, prefix, login } = {}) {
  log('')
  log(c.cyan(BANNER))
  log('')
  log(`   ${c.bold(c.magenta('TomiOka Bot'))} ${c.gray('·')} ${c.white(`v${version ?? '1.0'}`)} ${c.gray('· Baileys + Termux')}`)
  if (name) log(`   ${sym.drop} ${c.bold(name)}`)
  if (team) log(`   ${c.gray('team')} ${team}`)
  if (prefix) log(`   ${c.gray('prefix')} ${c.white(Array.isArray(prefix) ? prefix.join(' ') : prefix)}`)
  if (login) log(`   ${c.gray('login')} ${c.white(login)}`)
  log('')
}

export function box(lines = [], { color = c.cyan, padding = 1 } = {}) {
  const width = Math.max(...lines.map((line) => visibleWidth(line)), 20) + padding * 2
  const flat = (text) => `${' '.repeat(padding)}${text}${' '.repeat(Math.max(0, width - visibleWidth(text) - padding))}`
  log(color(`╭${'─'.repeat(width)}╮`))
  for (const line of lines) log(`${color('│')}${flat(line)}${color('│')}`)
  log(color(`╰${'─'.repeat(width)}╯`))
}

export function pairCode(code) {
  const pretty = String(code).replace(/^(.{4})(.*)$/, '$1-$2')
  log('')
  log(c.bgMagenta(`  CÓDIGO DE VINCULACIÓN: ${pretty}  `))
  log('')
  log(c.gray('  WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo →'))
  log(c.gray('  "Vincular con número de teléfono" e ingresa el código.'))
  log('')
}

export function progress(label, current, total) {
  const width = 24
  const ratio = total > 0 ? Math.min(1, current / total) : 0
  const filled = Math.round(width * ratio)
  const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
  const pct = String(Math.round(ratio * 100)).padStart(3, ' ')
  process.stdout.write(`\r${c.cyan(label)} ${bar} ${pct}%`)
  if (ratio >= 1) process.stdout.write('\n')
}

export { c, sym }
