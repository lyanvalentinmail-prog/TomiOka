const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

const paint = (open, close = '\x1b[0m') => (text) =>
  enabled ? `${open}${text}${close}` : String(text)

export const c = {
  bold: paint('\x1b[1m'),
  dim: paint('\x1b[2m'),
  italic: paint('\x1b[3m'),
  red: paint('\x1b[31m'),
  green: paint('\x1b[32m'),
  yellow: paint('\x1b[33m'),
  blue: paint('\x1b[34m'),
  magenta: paint('\x1b[35m'),
  cyan: paint('\x1b[36m'),
  white: paint('\x1b[97m'),
  gray: paint('\x1b[90m'),
  bgBlue: paint('\x1b[44m\x1b[97m'),
  bgMagenta: paint('\x1b[45m\x1b[97m')
}

export const BOT_EMOJIS = ['💧', '🌊', '🐟', '💦', '💙']

export const sym = {
  ok: c.green('✔'),
  err: c.red('✖'),
  warn: c.yellow('▲'),
  info: c.cyan('ℹ'),
  arrow: c.magenta('➜'),
  wave: '🌊',
  drop: '💧',
  fish: '🐟',
  splash: '💦',
  heart: '💙',
  bolt: '💦',
  dot: c.gray('•')
}

/** Ignora secuencias ANSI para calcular longitud visible */
export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '')
}

/** Ancho visible (cuenta emojis anchos como 2) */
export function visibleWidth(text) {
  const plain = stripAnsi(text)
  let width = 0
  for (const char of plain) {
    const code = char.codePointAt(0)
    width += code >= 0x1100 ? 2 : 1
  }
  return width
}
