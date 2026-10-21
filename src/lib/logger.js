import pino from 'pino'
import { c, sym } from './colors.js'

const LEVEL_COLORS = {
  10: c.gray,
  20: c.blue,
  30: c.green,
  40: c.yellow,
  50: c.red,
  60: c.magenta
}

const LEVEL_LABELS = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal'
}

function formatRecord(record) {
  const level = record.level ?? 30
  const paint = LEVEL_COLORS[level] || c.white
  const time = new Date(record.time ?? Date.now()).toLocaleTimeString('es-UY', { hour12: false })
  const mod = record.mod ? c.gray(`[${record.mod}]`) : ''
  const msg = typeof record.msg === 'string' ? record.msg : String(record.msg ?? '')
  const details = { ...record }
  delete details.level
  delete details.time
  delete details.pid
  delete details.hostname
  delete details.msg
  delete details.mod
  const extra = Object.keys(details).length
    ? ' ' + c.gray(JSON.stringify(details).slice(0, 400))
    : ''
  return `${c.gray(time)} ${paint(LEVEL_LABELS[level] || 'info')} ${mod} ${msg}${extra}`
}

/** Stream que imprime los logs de pino de forma legible y sin JSON */
const prettyStream = {
  write(line) {
    try {
      const record = JSON.parse(line)
      process.stdout.write(`${formatRecord(record)}\n`)
    } catch {
      process.stdout.write(line)
    }
  }
}

export function createLogger(level = 'info', baileysLevel = 'silent') {
  const appLogger = pino({ level, base: undefined }, prettyStream)
  // Logger aparte para Baileys: normalmente silencioso para no llenar la terminal
  const baileysLogger = pino({ level: baileysLevel, base: undefined }, prettyStream)
  return { logger: appLogger, baileysLogger }
}

export function logError(logger, error, context = '') {
  const message = error?.stack || error?.message || String(error)
  if (context) logger.error({ err: message, ctx: context }, `${sym.err} ${context}`)
  else logger.error({ err: message }, `${sym.err} error`)
}
