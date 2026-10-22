#!/usr/bin/env node
/**
 * 🌊 Terminal personalizada de TomiOka (pensada para Termux)
 *
 * Uso:  npm run terminal
 *
 * Desde acá puedes iniciar el bot, vincular WhatsApp (pairing/QR),
 * ver el estado, editar la configuración (nombre, prefijo, owners,
 * teléfono de pairing, pack, banner del menú), ver el menú y los
 * comandos, correr el diagnóstico y actualizar el repo.
 * Cada cambio se guarda en config.json (con respaldo config.json.bak).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig } from '../src/config.js'
import { ask, choose, isInteractive } from '../src/lib/prompt.js'
import { c } from '../src/lib/colors.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = path.join(ROOT, 'config.json')

/** '598 99 123 456, 5215512345678' -> ['59899123456', '5215512345678'] */
export function normalizeOwners(text) {
  return String(text || '')
    .split(/[\n,;]+/)
    .map((item) => item.replace(/\D/g, '').replace(/^00/, ''))
    .filter((digits) => digits.length >= 8 && digits.length <= 15)
}

function ensureObject(config, key) {
  if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) config[key] = {}
  return config[key]
}

/**
 * Aplica un cambio editable sobre el objeto crudo de config.json.
 * Lanza Error (en español) si el valor no es válido.
 */
export function applyConfigEdit(config, field, value) {
  const cfg = config && typeof config === 'object' ? config : {}
  switch (field) {
    case 'name': {
      const v = String(value || '').trim()
      if (!v) throw new Error('El nombre no puede estar vacío.')
      ensureObject(cfg, 'bot').name = v
      break
    }
    case 'team': {
      const v = String(value || '').trim()
      if (!v) throw new Error('El team no puede estar vacío.')
      ensureObject(cfg, 'bot').team = v
      break
    }
    case 'prefix': {
      const v = String(value || '').trim()
      if (!v || /\s/.test(v) || v.length > 3) throw new Error('Prefijo inválido (1 a 3 caracteres, sin espacios).')
      ensureObject(cfg, 'bot').prefix = v
      break
    }
    case 'pairingPhone': {
      const digits = String(value || '').replace(/\D/g, '').replace(/^00/, '')
      if (digits && (digits.length < 8 || digits.length > 15)) throw new Error('El teléfono debe tener entre 8 y 15 dígitos con código de país.')
      cfg.pairingPhone = digits
      break
    }
    case 'owners': {
      ensureObject(cfg, 'owner').numbers = Array.isArray(value)
        ? value.map((item) => String(item).replace(/\D/g, '')).filter((d) => d.length >= 8 && d.length <= 15)
        : normalizeOwners(value)
      break
    }
    case 'login': {
      const v = String(value || '').toLowerCase().trim()
      if (!['ask', 'pairing', 'qr'].includes(v)) throw new Error('Modo de login inválido (ask, pairing o qr).')
      cfg.login = v
      break
    }
    case 'packName': {
      const v = String(value || '').trim()
      if (!v) throw new Error('El nombre del pack no puede estar vacío.')
      ensureObject(cfg, 'stickers').packName = v
      break
    }
    case 'packAuthor': {
      ensureObject(cfg, 'stickers').packAuthor = String(value || '').trim()
      break
    }
    case 'menuImage': {
      ensureObject(cfg, 'menu').image = String(value || '').trim()
      break
    }
    default:
      throw new Error(`Campo no editable: ${field}`)
  }
  return cfg
}

function loadRawConfig() {
  if (!existsSync(CONFIG_FILE)) return {}
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
}

function saveRawConfig(cfg) {
  if (existsSync(CONFIG_FILE)) copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`)
  writeFileSync(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`)
}

function runBot(args = []) {
  console.log(c.gray('— El bot arranca acá mismo. Ctrl+C para volver a la terminal. —'))
  spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'boot.js'), ...args], { cwd: ROOT, stdio: 'inherit' })
}

async function showStatus() {
  const config = loadConfig()
  const { inspectSession, describeSession } = await import('../src/lib/session.js')
  const session = inspectSession(config.sessionDir)
  let commandCount = 0
  try {
    const { commandList } = await import('../src/commands/index.js')
    commandCount = commandList.filter((command) => !command.hidden).length
  } catch { /* sin dependencias todavía */ }
  console.log('')
  console.log(c.bold('🌊 Estado de TomiOka'))
  console.log(`  Bot:      ${config.bot.name}`)
  console.log(`  Prefijo:  ${config.prefixes.join(' ')}`)
  console.log(`  Comandos: ${commandCount} visibles`)
  console.log(`  Sesión:   ${describeSession(session)}`)
  console.log(`  Carpeta:  ${config.sessionDir}`)
  console.log(`  Login:    ${config.login}${config.pairingPhone ? ` · ${config.pairingPhone}` : ''}`)
  console.log(`  Owners:   ${config.owner.numbers.join(', ') || '(ninguno)'}`)
  console.log('')
}

async function editConfig() {
  for (;;) {
    const field = await choose('✏️  Editar configuración', [
      { label: 'Nombre del bot', value: 'name' },
      { label: 'Team / firma', value: 'team' },
      { label: 'Prefijo de comandos', value: 'prefix' },
      { label: 'Teléfono de pairing', value: 'pairingPhone' },
      { label: 'Números owner (dueños del bot)', value: 'owners' },
      { label: 'Modo de login (ask / pairing / qr)', value: 'login' },
      { label: 'Nombre del pack de stickers', value: 'packName' },
      { label: 'Autor del pack de stickers', value: 'packAuthor' },
      { label: 'Imagen del menú (URL o ruta, "-" para quitar)', value: 'menuImage' },
      { label: 'Volver', value: 'back' }
    ])
    if (field === 'back') return

    const raw = loadRawConfig()
    const config = loadConfig()
    try {
      if (field === 'login') {
        const mode = await choose('Modo de login al iniciar sin sesión', [
          { label: 'ask (preguntar)', value: 'ask' },
          { label: 'pairing (código)', value: 'pairing' },
          { label: 'qr (código QR)', value: 'qr' }
        ])
        applyConfigEdit(raw, 'login', mode)
      } else if (field === 'owners') {
        const answer = await ask('Owners con código de país, separados por comas', { defaultValue: config.owner.numbers.join(', ') })
        applyConfigEdit(raw, 'owners', answer)
      } else if (field === 'pairingPhone') {
        const answer = await ask('Teléfono para pairing (vacío = sin definir)', { defaultValue: config.pairingPhone })
        applyConfigEdit(raw, 'pairingPhone', answer)
      } else if (field === 'menuImage') {
        const answer = await ask('URL/ruta del banner del menú ("-" para quitarlo)', { defaultValue: config.menu.image || '' })
        applyConfigEdit(raw, 'menuImage', answer === '-' ? '' : answer)
      } else {
        const current = {
          name: config.bot.name, team: config.bot.team, prefix: config.prefixes[0],
          packName: config.stickers.packName, packAuthor: config.stickers.packAuthor
        }[field] || ''
        const answer = await ask('Nuevo valor', { defaultValue: current })
        applyConfigEdit(raw, field, answer)
      }
      saveRawConfig(raw)
      console.log(c.green('✅ Configuración guardada en config.json (respaldo: config.json.bak)'))
    } catch (error) {
      console.log(c.red(`❌ ${error.message}`))
    }
  }
}

async function showMenu() {
  const config = loadConfig()
  try {
    const [{ commands }, { buildMenu }] = await Promise.all([
      import('../src/commands/index.js'),
      import('../src/menu.js')
    ])
    console.log('')
    console.log(buildMenu({ config, commands, sender: { label: 'Termux' } }))
  } catch (error) {
    console.log(c.red(`No se pudo armar el menú: ${error.message}. Corre primero el bot una vez para instalar dependencias.`))
  }
  console.log('')
}

async function showCommands() {
  try {
    const { commandList } = await import('../src/commands/index.js')
    console.log('')
    for (const command of commandList.filter((item) => !item.hidden)) {
      console.log(`  ${c.bold(`.${command.name}`)}  ${c.gray(command.description || '')}`)
    }
  } catch (error) {
    console.log(c.red(`No se pudieron cargar los comandos: ${error.message}`))
  }
  console.log('')
}

async function deleteSession() {
  const config = loadConfig()
  const answer = await ask('Esto cierra la sesión de WhatsApp y hay que vincular de nuevo. Escribe BORRAR para confirmar')
  if (answer !== 'BORRAR') { console.log('Cancelado.'); return }
  rmSync(config.sessionDir, { recursive: true, force: true })
  console.log(c.green('🗑️  Sesión eliminada. Vincula de nuevo con pairing o QR.'))
}

async function main() {
  if (!isInteractive()) {
    console.log('🌊 Terminal de TomiOka: se usa en vivo desde Termux con `npm run terminal`.')
    return
  }

  console.log('')
  console.log(c.cyan('  ╭──────────────────────────────────────────╮'))
  console.log(c.cyan('  │  🌊 TomiOka · Terminal del bot (Termux)  │'))
  console.log(c.cyan('  │  💧 Todo el bot, desde una sola pantalla │'))
  console.log(c.cyan('  ╰──────────────────────────────────────────╯'))

  for (;;) {
    const action = await choose('¿Qué quieres hacer?', [
      { label: '▶️  Iniciar el bot', hint: 'entra directo si ya hay sesión', value: 'start' },
      { label: '🔢 Vincular con pairing code', value: 'pair' },
      { label: '📷 Vincular con código QR', value: 'qr' },
      { label: '🌊 Ver estado del bot', value: 'status' },
      { label: '✏️  Editar configuración', hint: 'nombre, prefijo, owners, pack, banner…', value: 'edit' },
      { label: '📋 Ver el menú de WhatsApp', value: 'menu' },
      { label: '⌨️  Ver todos los comandos', value: 'commands' },
      { label: '🩺 Diagnóstico (doctor)', value: 'doctor' },
      { label: '⬇️  Actualizar el bot (git pull)', value: 'update' },
      { label: '🗑️  Borrar sesión (volver a vincular)', value: 'session' },
      { label: 'Salir', value: 'exit' }
    ])

    if (action === 'exit') break
    else if (action === 'start') runBot()
    else if (action === 'pair') {
      const phone = await ask('Número con código de país (ej: 59891234567)', { defaultValue: loadConfig().pairingPhone })
      runBot(phone ? ['--pair', '--phone', phone] : ['--pair'])
    } else if (action === 'qr') runBot(['--qr'])
    else if (action === 'status') await showStatus()
    else if (action === 'edit') await editConfig()
    else if (action === 'menu') await showMenu()
    else if (action === 'commands') await showCommands()
    else if (action === 'doctor') runBot(['--doctor'])
    else if (action === 'update') {
      const result = spawnSync('git', ['pull'], { cwd: ROOT, stdio: 'inherit' })
      if (result.status === 0) console.log(c.green('✅ Actualizado. Reinicia el bot para aplicar.'))
    } else if (action === 'session') await deleteSession()
  }

  console.log(c.cyan('🌊 ¡Nos vemos! El océano te cuide. 💧'))
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  })
}
