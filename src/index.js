#!/usr/bin/env node
import { ensureDirs, isValidPhone, loadConfig, normalizePhone } from './config.js'
import { describeSession, inspectSession } from './lib/session.js'
import { loadMenuImage } from './lib/banner.js'
import { commands } from './commands/index.js'
import { startBot } from './connection.js'
import { resolveFfmpeg, selfTestFfmpeg } from './lib/ffmpeg.js'
import { canWrite, prewarmWorkDir, tempInfo } from './lib/tmp.js'
import { createLogger } from './lib/logger.js'
import { banner, box, c, error, info, step, sym, warn } from './lib/ui.js'

const VERSION = '1.0.0'

function parseArgs(argv) {
  const options = { login: null, phone: '', help: false, version: false, doctor: false, relink: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--qr' || arg === 'qr') options.login = 'qr'
    else if (arg === '--pair' || arg === '--pairing' || arg === 'pair') options.login = 'pairing'
    else if (arg === '--phone' || arg === '--numero') {
      options.phone = argv[i + 1] || ''
      i += 1
    } else if (arg.startsWith('--phone=')) options.phone = arg.split('=')[1]
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg === '--doctor' || arg === 'doctor') options.doctor = true
    else if (arg === '--relink' || arg === '--revincular') options.relink = true
  }
  return options
}

function printHelp() {
  box(
    [
      `${c.bold('TomiOka Bot')} ${c.gray(`v${VERSION}`)}`,
      '',
      `${c.bold('Uso')}: npm start [opciones]`,
      '',
      `${c.cyan('--pair')}            Vincular con código de vinculación`,
      `${c.cyan('--qr')}              Vincular con código QR`,
      `${c.cyan('--phone <numero>')}  Número para el pairing (ej: 59891234567)`,
      `${c.cyan('--relink')}          Olvida la sesión guardada y vincula de nuevo`,
      `${c.cyan('--doctor')}          Diagnóstico de FFmpeg y dependencias`,
      `${c.cyan('-h, --help')}        Esta ayuda`,
      `${c.cyan('-v, --version')}     Versión`,
      '',
      `${c.gray('También puedes editar config.json: login = "ask" | "qr" | "pairing"')}`
    ],
    { color: c.cyan }
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.version) {
    console.log(`tomioka-bot v${VERSION}`)
    return
  }
  if (options.help) {
    printHelp()
    return
  }

  const config = loadConfig()
  if (options.login) config.login = options.login
  if (options.relink) config.relink = true
  if (options.phone) config.pairingPhone = normalizePhone(options.phone)
  if (config.pairingPhone && !isValidPhone(config.pairingPhone)) {
    warn('El número de pairing no parece válido (usa código de país, ejemplo: 59891234567).')
  }

  const { logger, baileysLogger } = createLogger(
    config.logging.level || 'info',
    config.logging.baileys || 'silent'
  )

  banner({
    name: config.bot.name,
    team: config.bot.team,
    version: config.bot.version,
    prefix: config.prefixes,
    login: config.login === 'ask' ? 'preguntar al iniciar' : config.login
  })

  if (options.doctor) {
    const { runDoctor } = await import('./doctor.js')
    await runDoctor({ config })
    return
  }

  const major = Number(process.versions.node.split('.')[0])
  if (major < 20) {
    warn(`Node.js ${process.versions.node} es antiguo. Este bot usa Node 20 o superior.`)
  }

  ensureDirs(config)
  step(`Sesión: ${config.sessionDir}`)
  step(`Prefijo: ${config.prefixes.join(' ')} · Comandos: ${new Set(commands.values()).size}`)

  const tempOk = await canWrite(config.paths.tmp)
  if (tempOk) info(`Carpeta temporal: ${config.paths.tmp}`)
  else {
    warn(`No puedo escribir en ${config.paths.tmp}`)
    warn('Define TOMIOKA_TMPDIR (ej: export TOMIOKA_TMPDIR="$HOME/tomioka-tmp")')
  }
  logger.debug?.(JSON.stringify(tempInfo()))

  // Precalentado: deja lista la carpeta temporal y el arranque de FFmpeg para
  // que el primer `.sticker` no pague ese costo.
  if (config.performance?.warmUp !== false) {
    const warmed = await prewarmWorkDir()
    logger.debug?.(warmed ? 'carpeta temporal precalentada' : 'no se pudo precalentar la carpeta temporal')
  }

  const ffmpeg = await resolveFfmpeg()
  if (ffmpeg) {
    info(`FFmpeg: ${ffmpeg.version.split(' ').slice(0, 3).join(' ')}${ffmpeg.webp ? '' : c.yellow(' (sin WebP)')}`)
    if (!ffmpeg.webp) {
      warn('Tu FFmpeg no tiene el codificador WebP: los stickers no se podrán crear.')
      warn('Termux: pkg install ffmpeg libwebp')
    } else {
      // Prueba real: genera un sticker de 96px y lo convierte de vuelta
      const test = await selfTestFfmpeg({ logger })
      if (test.ok) info('Conversión de stickers verificada (FFmpeg OK)')
      else {
        warn('La conversión de stickers falló en la prueba:')
        for (const step of test.steps.filter((item) => !item.ok).slice(0, 3)) {
          warn(`  · ${step.name}: ${step.error}`)
        }
        if (test.hint) warn(`  ${test.hint}`)
        warn('Ejecuta "npm run selftest" para ver el detalle.')
      }
    }
  } else {
    warn('FFmpeg no encontrado. Los comandos de stickers no funcionarán.')
    warn('En Termux: pkg install ffmpeg')
  }

  if (config.menu.image) {
    loadMenuImage(config, { logger })
      .then((banner) => {
        if (banner) info(`Banner del menú listo (${banner.type}${banner.fromCache ? ', caché' : ''})`)
        else warn('No se pudo cargar el banner del menú: el menú se enviará solo como texto.')
      })
      .catch((error_) => warn(`Banner del menú: ${error_.message}`))
  }

  const session = inspectSession(config.sessionDir)
  if (session.valid) {
    // El mensaje definitivo lo da connection.js al conectar.
    step(`Sesión: ${describeSession(session)}`)
  } else if (!session.hasCreds) {
    info('No hay sesión guardada: hay que vincular el dispositivo.')
  }

  await startBot({ config, logger, baileysLogger })
  info('Bot en ejecución. Presiona Ctrl+C para detenerlo.')
}

main().catch((error_) => {
  error(error_?.stack || error_?.message || String(error_))
  console.error('')
  console.error(`${sym.err} Revisa la configuración y vuelve a intentarlo.`)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(`${sym.warn} Promesa rechazada sin manejar:`, reason?.message || reason)
})
process.on('uncaughtException', (error_) => {
  console.error(`${sym.warn} Excepción no capturada:`, error_?.stack || error_)
})
