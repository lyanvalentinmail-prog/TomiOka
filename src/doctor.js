#!/usr/bin/env node
import { existsSync, statSync, statfsSync, accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { ensureDirs, loadConfig } from './config.js'
import { resolveFfmpeg } from './lib/ffmpeg.js'
import { indexInfo } from './lib/emojimix.js'
import { driveFileId, loadMenuImage } from './lib/banner.js'
import { commandList } from './commands/index.js'
import { box, c, error, info, ok, title, warn } from './lib/ui.js'

const require = createRequire(import.meta.url)

const REQUIRED = ['@whiskeysockets/baileys', 'node-webpmux', 'pino', 'qrcode-terminal']

function checkDependency(name) {
  try {
    require.resolve(name)
    return { name, ok: true }
  } catch {
    return { name, ok: false }
  }
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

export async function runDoctor({ config = loadConfig() } = {}) {
  title('Diagnóstico de TomiOka Bot')
  const problems = []
  const recommendations = []

  // Node
  const major = Number(process.versions.node.split('.')[0])
  if (major >= 20) ok(`Node.js ${process.versions.node}`)
  else {
    error(`Node.js ${process.versions.node} (necesitas 20+)`)
    problems.push('Actualiza Node.js: en Termux usa "pkg install nodejs-lts"')
  }

  // Dependencias
  for (const name of REQUIRED) {
    const result = checkDependency(name)
    if (result.ok) ok(`dependencia ${name}`)
    else {
      error(`falta ${name}`)
      recommendations.push('Ejecuta "npm install" dentro de la carpeta del bot.')
    }
  }

  // FFmpeg
  const ffmpeg = await resolveFfmpeg()
  if (ffmpeg) {
    ok(`FFmpeg: ${ffmpeg.path}`)
    info(`  ${ffmpeg.version}`)
    if (ffmpeg.webp) ok('  codificador WebP disponible')
    else {
      error('  FFmpeg sin codificador WebP: no se pueden crear stickers')
      problems.push('Reinstala ffmpeg desde el repositorio oficial: pkg install ffmpeg')
    }
  } else {
    error('FFmpeg no encontrado (los comandos de stickers fallarán)')
    problems.push('Termux: pkg install ffmpeg  ·  Debian: sudo apt install ffmpeg')
  }

  // Carpetas y espacio
  try {
    ensureDirs(config)
    accessSync(config.paths.data, constants.W_OK)
    accessSync(config.paths.session, constants.W_OK)
    ok(`carpetas listas: ${config.paths.data}`)
  } catch (error_) {
    error(`no se pueden escribir las carpetas: ${error_.message}`)
    problems.push('Verifica los permisos de la carpeta del bot.')
  }

  try {
    const stats = statfsSync(config.paths.root)
    const free = stats.bavail * stats.bsize
    if (free > 200 * 1024 * 1024) ok(`espacio libre: ${humanBytes(free)}`)
    else {
      warn(`poco espacio libre: ${humanBytes(free)}`)
      recommendations.push('Libera espacio: los stickers y packs necesitan espacio temporal.')
    }
  } catch {
    info('espacio libre: no disponible en este sistema')
  }

  // Sesión
  const creds = `${config.paths.session}/creds.json`
  if (existsSync(creds)) {
    ok(`sesión vinculada (${humanBytes(statSync(creds).size)})`)
  } else {
    info('sesión: aún no vinculada (se pedirá pairing/QR al iniciar)')
  }

  // Emojimix
  const emojiIndex = indexInfo(config.emojimix)
  if (emojiIndex.loaded || emojiIndex.cached) {
    ok(`catálogo emojimix disponible${emojiIndex.total ? ` (${emojiIndex.total} combinaciones)` : ''}`)
  } else {
    info('catálogo emojimix: se descargará en el primer uso (~95 MB)')
  }

  // Banner del menú
  if (config.menu.image) {
    const id = driveFileId(config.menu.image)
    info(`banner del menú: ${id ? `Drive (${id})` : config.menu.image}`)
    const banner = await loadMenuImage(config, {})
    if (banner) {
      ok(`  banner disponible (${banner.type}${banner.fromCache ? ', caché' : ', descargado'})`)
    } else {
      warn('  no se pudo cargar el banner: el menú irá solo como texto')
      recommendations.push('Publica el banner en Drive como "cualquiera con el enlace" o usa una ruta local.')
    }
  } else {
    info('banner del menú: sin imagen configurada (menu.image vacío)')
  }

  // Config
  info(`prefijo: ${config.prefixes.join(' ')} · login: ${config.login}`)
  info(`dueños: ${config.owner.numbers.length ? config.owner.numbers.join(', ') : 'ninguno (opcional)'}`)
  info(`comandos: ${commandList.length}`)

  box(
    [
      problems.length
        ? `${c.bold(c.red('Problemas'))}`
        : `${c.bold(c.green('Todo listo para usar el bot'))}`,
      ...problems.map((problem) => `${c.yellow('▲')} ${problem}`),
      ...(recommendations.length ? ['', `${c.bold(c.cyan('Sugerencias'))}`] : []),
      ...recommendations.map((tip) => `${c.cyan('•')} ${tip}`)
    ],
    { color: problems.length ? c.yellow : c.green }
  )

  return { problems, recommendations, ffmpeg }
}

const isMain = process.argv[1] && process.argv[1].endsWith('doctor.js')
if (isMain) {
  runDoctor().catch((error_) => {
    console.error(error_)
    process.exit(1)
  })
}
