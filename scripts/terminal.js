#!/usr/bin/env node
/**
 * 🌊 Terminal de TomiOka — TUI de pantalla completa estilo OpenCode
 *
 * Uso:  npm run terminal   (pensada para Termux)
 *
 * Pantalla completa con logo, navegación por flechas y paneles:
 * iniciar el bot, vincular (pairing code / QR), ver el estado, editar
 * la configuración en línea, ver el menú de WhatsApp y los comandos,
 * correr el diagnóstico, actualizar y borrar la sesión.
 * Sin dependencias nuevas: solo ANSI + modo raw de Node, así que
 * funciona en Termux sin compilar nada. Los cambios de configuración
 * se guardan en config.json (con respaldo config.json.bak).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig } from '../src/config.js'
import { inspectSession, describeSession } from '../src/lib/session.js'
import { ask, isInteractive } from '../src/lib/prompt.js'
import { c, stripAnsi } from '../src/lib/colors.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = path.join(ROOT, 'config.json')
const ESC = '\x1b'

export const LOGO = [
  '████████╗ ██████╗ ███╗   ███╗██╗ ██████╗ ██╗  ██╗ █████╗ ',
  '╚══██╔══╝██╔═══██╗████╗ ████║██║██╔═══██╗██║ ██╔╝██╔══██╗',
  '   ██║   ██║   ██║██╔████╔██║██║██║   ██║█████╔╝ ███████║',
  '   ██║   ██║   ██║██║╚██╔╝██║██║██║   ██║██╔═██╗ ██╔══██║',
  '   ██║   ╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║  ██╗██║  ██║',
  '   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝'
]

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

/* -------------------------------------------------- layout helpers (puros) */

/** Ancho visible aproximado: emoji/CJK = 2, resto = 1, selectores = 0 */
export function textWidth(text) {
  let width = 0
  for (const char of stripAnsi(String(text))) {
    const cp = char.codePointAt(0)
    if (cp === 0xfe0f || cp === 0x200d) continue
    width += cp >= 0x1f000 || (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) ? 2 : 1
  }
  return width
}

/** Recorta un texto a un ancho visible máximo, sin romper secuencias ANSI */
export function clip(text, max) {
  const plain = stripAnsi(String(text))
  if (textWidth(plain) <= max) return String(text)
  let out = ''
  let width = 0
  for (const char of plain) {
    const w = textWidth(char)
    if (width + w > max) break
    out += char
    width += w
  }
  return out
}

/** Rellena con espacios hasta el ancho visible pedido */
export function pad(text, width) {
  const str = String(text)
  const missing = width - textWidth(str)
  return missing > 0 ? str + ' '.repeat(missing) : str
}

/* ------------------------------------------------------------- datos de UI */

export const MENU_ITEMS = [
  { id: 'start', icon: '▶', label: 'Iniciar el bot', hint: 'Entra directo si ya hay sesión. Ctrl+C del bot te devuelve acá.' },
  { id: 'pair', icon: '🔢', label: 'Vincular · pairing code', hint: 'Código de 8 dígitos en WhatsApp → Dispositivos vinculados.' },
  { id: 'qr', icon: '📷', label: 'Vincular · código QR', hint: 'Escanea el QR desde otro teléfono.' },
  { id: 'status', icon: '🌊', label: 'Estado del bot', hint: 'Sesión, prefijo, owners, comandos y entorno.' },
  { id: 'edit', icon: '✏️', label: 'Editar configuración', hint: 'Nombre, prefijo, owners, pack y banner, sin tocar archivos.' },
  { id: 'menu', icon: '📋', label: 'Menú de WhatsApp', hint: 'El menú completo, tal como lo ven tus contactos.' },
  { id: 'commands', icon: '⌨️', label: 'Todos los comandos', hint: 'Lista completa de comandos visibles del bot.' },
  { id: 'doctor', icon: '🩺', label: 'Diagnóstico · doctor', hint: 'Revisa Node, FFmpeg, carpetas y sesión paso a paso.' },
  { id: 'update', icon: '⬇️', label: 'Actualizar el bot', hint: 'git pull para traer la última versión.' },
  { id: 'session', icon: '🗑️', label: 'Borrar sesión', hint: 'Cierra WhatsApp y obliga a vincular de nuevo.' },
  { id: 'exit', icon: '⏻', label: 'Salir', hint: 'Cierra la terminal de TomiOka.' }
]

export const LOGIN_MODES = ['ask', 'pairing', 'qr']

/** Campos editables con su valor actual ya formateado para la pantalla */
export function editFields(config) {
  return [
    { id: 'name', label: 'Nombre del bot', value: config.bot.name, raw: config.bot.name },
    { id: 'team', label: 'Team / firma', value: config.bot.team, raw: config.bot.team },
    { id: 'prefix', label: 'Prefijo', value: config.prefixes[0], raw: config.prefixes[0] },
    { id: 'pairingPhone', label: 'Teléfono pairing', value: config.pairingPhone || '(sin definir)', raw: config.pairingPhone || '' },
    { id: 'owners', label: 'Owners', value: config.owner.numbers.join(', ') || '(ninguno)', raw: config.owner.numbers.join(', ') },
    { id: 'login', label: 'Modo de login', value: config.login, raw: config.login, cycle: LOGIN_MODES },
    { id: 'packName', label: 'Pack · nombre', value: config.stickers.packName, raw: config.stickers.packName },
    { id: 'packAuthor', label: 'Pack · autor', value: config.stickers.packAuthor, raw: config.stickers.packAuthor },
    { id: 'menuImage', label: 'Banner del menú', value: config.menu.image || '(sin banner)', raw: config.menu.image || '', hint: '"-" para quitar el banner' }
  ]
}

/** Líneas del panel de estado */
export function statusLines(config, session, commandCount = 0) {
  return [
    '🌊 Estado de TomiOka',
    '',
    `  Bot        ${config.bot.name}`,
    `  Team       ${config.bot.team}`,
    `  Prefijo    ${config.prefixes.join('  ')}`,
    `  Sesión     ${describeSession(session)}`,
    `  Carpeta    ${config.sessionDir}`,
    `  Login      ${config.login}${config.pairingPhone ? ` · ${config.pairingPhone}` : ''}`,
    `  Owners     ${config.owner.numbers.join(', ') || '(ninguno)'}`,
    `  Comandos   ${commandCount} visibles`,
    `  Node       ${process.version} · ${process.platform}/${process.arch}`
  ]
}

export function createState() {
  return {
    mode: 'menu', // menu | edit | input | text | confirm
    sel: 0,
    editSel: 0,
    scroll: 0,
    textTitle: '',
    textLines: [],
    field: null,
    buffer: '',
    confirmSel: 0,
    toast: '',
    busy: false
  }
}

const HINTS = {
  menu: '↑↓ navegar · enter abrir · q salir',
  edit: '↑↓ campos · enter editar · esc volver',
  input: 'enter guardar · esc cancelar · ctrl+u borrar línea',
  text: '↑↓ scroll · pgup/pgdn página · esc volver',
  confirm: '←→ elegir · enter confirmar · esc cancelar'
}

/* ------------------------------------------------------------------ render */

/**
 * Arma la pantalla completa (array de líneas con ANSI).
 * Pura: se puede probar sin una terminal real.
 */
export function renderFrame(state, env, width = 80, height = 24) {
  const W = Math.max(30, width)
  const H = Math.max(10, height)
  const { config, session } = env
  const big = W >= 62 && H >= 24

  const header = []
  if (big) {
    for (const line of LOGO) header.push(c.cyan(c.bold(line)))
    header.push(`  ${c.cyan('🌊 Terminal del bot')} ${c.gray('· todo TomiOka desde una sola pantalla 💧')}`)
  } else {
    header.push(`${c.cyan(c.bold('🌊 TomiOka'))} ${c.gray('· Terminal del bot 💧')}`)
  }
  header.push(c.gray('─'.repeat(W)))
  const linked = Boolean(session?.registered)
  header.push(
    ` ${linked ? '🟢' : '🔴'} ${linked ? c.green('sesión vinculada') : c.red('sin sesión')} ${c.gray(`· ${config.bot.name} · prefijo ${config.prefixes[0]} · ${config.owner.numbers.length} owner(s)`)}`
  )

  const footer = []
  if (state.toast) footer.push(clip(c.yellow(` ${state.toast}`), W))
  footer.push(c.gray(` ${HINTS[state.mode] || ''}`))
  footer.push(c.bgBlue(pad(` 🌊 TomiOka · ${linked ? 'vinculado' : 'sin vincular'} · escribe .help en WhatsApp para ver el menú `, W)))

  const bodyH = Math.max(3, H - header.length - footer.length)
  const body = renderBody(state, env, W, bodyH)

  const frame = [...header, ...body.slice(0, bodyH), ...footer]
  while (frame.length < H) frame.splice(frame.length - footer.length, 0, '')
  return frame.slice(0, H).map((line) => clip(line, W))
}

function renderBody(state, env, W, bodyH) {
  if (state.mode === 'text') return renderTextBody(state, W, bodyH)
  if (state.mode === 'confirm') return renderConfirmBody(state, W, bodyH)

  const { config, session } = env
  const editing = state.mode === 'edit' || state.mode === 'input'
  const items = editing ? editFields(config) : MENU_ITEMS
  const selected = editing ? state.editSel : state.sel
  const LW = Math.min(38, Math.max(24, Math.floor(W * 0.44)))

  const listH = state.mode === 'input' ? Math.max(1, bodyH - 3) : bodyH
  const rows = []
  for (let i = 0; i < listH; i += 1) {
    const item = items[i]
    let left = ''
    if (item) {
      const text = editing ? `${item.label}` : `${item.icon}  ${item.label}`
      left = i === selected ? c.bgBlue(pad(` ❯ ${text} `, LW)) : pad(`   ${text}`, LW)
      if (editing) left = i === selected ? c.bgBlue(pad(` ❯ ${item.label} `, LW)) : pad(`   ${item.label}`, LW)
    } else {
      left = ' '.repeat(LW)
    }
    const right = renderPanelLine(state, env, i, W - LW - 3)
    rows.push(`${left} ${c.gray('│')} ${right}`)
  }

  if (state.mode === 'input' && state.field) {
    rows.push('')
    rows.push(clip(` ${c.cyan('✏️')}  ${c.bold(state.field.label)}: ${state.buffer}${c.bgBlue(' ')}`, W))
    if (state.field.hint) rows.push(c.gray(`    ${state.field.hint}`))
  }
  return rows
}

function renderPanelLine(state, env, row, panelW) {
  const { config, session } = env
  const editing = state.mode === 'edit' || state.mode === 'input'

  if (editing) {
    const fields = editFields(config)
    const field = fields[state.editSel]
    const lines = [
      c.bold(c.cyan('✏️  Editar configuración')),
      c.gray('Se guarda en config.json (respaldo .bak)'),
      '',
      field ? `${c.gray(field.label + ':')}` : '',
      field ? clip(field.value, panelW) : '',
      '',
      field?.cycle ? c.gray('enter cambia entre: ask · pairing · qr') : c.gray('enter para escribir el nuevo valor'),
      c.gray('Vacío al guardar = se mantiene según el campo')
    ]
    return lines[row] ? clip(lines[row], panelW) : ''
  }

  const item = MENU_ITEMS[state.sel]
  const lines = [
    c.bold(c.cyan(`${item.icon}  ${item.label}`)),
    c.gray(clip(item.hint, panelW)),
    '',
    `${c.gray('Bot')}      ${clip(config.bot.name, panelW - 10)}`,
    `${c.gray('Sesión')}   ${describeSession(session)}`,
    `${c.gray('Prefijo')}  ${config.prefixes.join(' ')}`,
    `${c.gray('Login')}    ${config.login}${config.pairingPhone ? ` · ${config.pairingPhone}` : ''}`,
    `${c.gray('Owners')}   ${config.owner.numbers.length}`,
    '',
    c.gray('Hecho para Termux 💧 sin compilar nada')
  ]
  return lines[row] ? clip(lines[row], panelW) : ''
}

function renderTextBody(state, W, bodyH) {
  const lines = [`${c.bold(c.cyan(state.textTitle))} ${c.gray(`· línea ${Math.min(state.scroll + 1, state.textLines.length)}/${state.textLines.length}`)}`]
  const view = state.textLines.slice(state.scroll, state.scroll + bodyH - 1)
  for (const line of view) lines.push(clip(line, W))
  return lines
}

function renderConfirmBody(state, W, bodyH) {
  const boxW = Math.min(52, W - 4)
  const inner = boxW - 4
  const cancel = state.confirmSel === 0 ? c.bgBlue('  Cancelar  ') : '  Cancelar  '
  const danger = state.confirmSel === 1 ? c.bgBlue('  Borrar sesión  ') : c.red('  Borrar sesión  ')
  const box = [
    '╭' + '─'.repeat(boxW - 2) + '╮',
    `│ ${pad('🗑️  Borrar la sesión de WhatsApp', inner)} │`,
    `│ ${pad('Tendrás que vincular de nuevo con', inner)} │`,
    `│ ${pad('pairing code o QR. ¿Seguro?', inner)} │`,
    '│ ' + ' '.repeat(inner) + ' │',
    `│ ${pad(`   ${cancel}   ${danger}`, inner)} │`,
    '╰' + '─'.repeat(boxW - 2) + '╯'
  ]
  const leftPad = ' '.repeat(Math.max(0, Math.floor((W - boxW) / 2)))
  const topPad = Math.max(0, Math.floor((bodyH - box.length) / 2))
  const rows = Array.from({ length: topPad }, () => '')
  for (const line of box) rows.push(leftPad + line)
  return rows
}

/* ------------------------------------------------------------ config en disco */

function loadRawConfig() {
  if (!existsSync(CONFIG_FILE)) return {}
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
}

function saveRawConfig(cfg) {
  if (existsSync(CONFIG_FILE)) copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`)
  writeFileSync(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`)
}

/* --------------------------------------------------------- entrada de teclas */

/** Convierte un chunk de stdin (modo raw) en una lista de teclas */
export function parseKeys(chunk) {
  const keys = []
  const s = String(chunk)
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === ESC) {
      const m = s.slice(i).match(/^\x1b\[([0-9;]*)([A-Za-z~])/)
      if (m) {
        const byFinal = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'shift-tab' }
        const byParam = { 5: 'pageup', 6: 'pagedown', 1: 'home', 4: 'end', 7: 'home', 8: 'end' }
        keys.push({ name: m[2] === '~' ? byParam[m[1]] || 'unknown' : byFinal[m[2]] || 'unknown' })
        i += m[0].length
      } else {
        keys.push({ name: 'escape' })
        i += 1
      }
      continue
    }
    if (ch === '\r' || ch === '\n') keys.push({ name: 'enter' })
    else if (ch === '\x7f') keys.push({ name: 'backspace' })
    else if (ch === '\x03') keys.push({ name: 'ctrl-c' })
    else if (ch === '\x15') keys.push({ name: 'ctrl-u' })
    else if (ch === '\t') keys.push({ name: 'tab' })
    else keys.push({ name: 'char', char: ch })
    i += 1
  }
  return keys
}

/* --------------------------------------------------------------------- main */

async function main() {
  if (!isInteractive()) {
    console.log('🌊 Terminal de TomiOka: se usa en vivo desde Termux con `npm run terminal`.')
    return
  }

  const state = createState()
  let commandsModule = null
  let menuModule = null

  const freshEnv = () => {
    const config = loadConfig()
    return { config, session: inspectSession(config.sessionDir) }
  }
  let env = freshEnv()

  const loadCommands = async () => {
    if (!commandsModule) {
      try {
        commandsModule = await import('../src/commands/index.js')
        menuModule = await import('../src/menu.js')
      } catch {
        commandsModule = null
      }
    }
    return commandsModule
  }

  const render = () => {
    const { columns = 80, rows = 24 } = process.stdout
    process.stdout.write(`${ESC}[H${renderFrame(state, env, columns, rows).join('\r\n')}${ESC}[J`)
  }

  const suspend = () => {
    process.stdout.write(`${ESC}[?25h${ESC}[?1049l`)
    try { process.stdin.setRawMode(false) } catch { /* sin TTY */ }
  }
  const resume = () => {
    process.stdout.write(`${ESC}[?1049h${ESC}[?25l`)
    try { process.stdin.setRawMode(true) } catch { /* sin TTY */ }
    process.stdin.resume()
    render()
  }
  const cleanup = () => {
    try { process.stdout.write(`${ESC}[?25h${ESC}[?1049l`) } catch { /* nada */ }
    try { process.stdin.setRawMode(false) } catch { /* sin TTY */ }
  }
  const quit = () => {
    cleanup()
    console.log('🌊 ¡Nos vemos! El océano te cuide. 💧')
    process.exit(0)
  }

  /** Sale de la TUI, corre algo en la terminal real y vuelve */
  async function suspendRun(title, fn, after) {
    state.busy = true
    suspend()
    console.log(`\n🌊 ${title}\n`)
    try { fn() } catch { /* el proceso hijo ya reportó */ }
    await ask('⏎ Enter para volver a la terminal de TomiOka', { defaultValue: '' }).catch(() => {})
    env = freshEnv()
    state.busy = false
    if (after) after()
    resume()
  }

  const runBot = (title, args) => suspendRun(title, () => {
    spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'boot.js'), ...args], { cwd: ROOT, stdio: 'inherit' })
  })

  const openText = (title, lines) => {
    state.mode = 'text'
    state.textTitle = title
    state.textLines = lines
    state.scroll = 0
  }

  const saveField = (field, value) => {
    const raw = loadRawConfig()
    applyConfigEdit(raw, field.id, field.id === 'menuImage' && value.trim() === '-' ? '' : value)
    saveRawConfig(raw)
    env = freshEnv()
    state.toast = `✅ ${field.label} guardado`
  }

  async function activate(item) {
    if (item.id === 'start') await runBot('Iniciar el bot — Ctrl+C del bot te devuelve acá', [])
    else if (item.id === 'pair') {
      state.field = { id: '__pair', label: 'Número con código de país (ej: 59891234567)', raw: env.config.pairingPhone || '' }
      state.buffer = state.field.raw
      state.mode = 'input'
    } else if (item.id === 'qr') await runBot('Vincular con código QR', ['--qr'])
    else if (item.id === 'status') {
      const mod = await loadCommands()
      const count = mod ? mod.commandList.filter((cmd) => !cmd.hidden).length : 0
      openText('Estado del bot', statusLines(env.config, env.session, count))
    } else if (item.id === 'edit') {
      state.mode = 'edit'
    } else if (item.id === 'menu') {
      const mod = await loadCommands()
      if (mod && menuModule) {
        openText('Menú de WhatsApp', menuModule.buildMenu({ config: env.config, commands: mod.commands, sender: { label: 'Termux' } }).split('\n'))
      } else {
        openText('Menú de WhatsApp', ['No se pudieron cargar los comandos.', 'Corre primero `npm install` o inicia el bot una vez.'])
      }
    } else if (item.id === 'commands') {
      const mod = await loadCommands()
      if (mod) {
        const lines = mod.commandList.filter((cmd) => !cmd.hidden).map((cmd) => `  .${cmd.name}  ${cmd.description || ''}`)
        openText(`Todos los comandos (${lines.length})`, lines)
      } else {
        openText('Todos los comandos', ['No se pudieron cargar los comandos.', 'Corre primero `npm install` o inicia el bot una vez.'])
      }
    } else if (item.id === 'doctor') await runBot('Diagnóstico del entorno', ['--doctor'])
    else if (item.id === 'update') {
      await suspendRun('Actualizar el bot (git pull)', () => {
        const result = spawnSync('git', ['pull'], { cwd: ROOT, stdio: 'inherit' })
        state.toast = result.status === 0 ? '✅ Bot actualizado. Reinicia para aplicar.' : '❌ git pull falló; revisa el mensaje de arriba'
      })
    } else if (item.id === 'session') {
      state.mode = 'confirm'
      state.confirmSel = 0
    } else if (item.id === 'exit') quit()
  }

  async function handleKey(key) {
    if (state.busy) return
    if (key.name === 'ctrl-c') return quit()
    if (state.toast && state.mode !== 'input') state.toast = ''

    if (state.mode === 'menu') {
      const count = MENU_ITEMS.length
      if (key.name === 'up' || key.char === 'k') state.sel = (state.sel + count - 1) % count
      else if (key.name === 'down' || key.char === 'j') state.sel = (state.sel + 1) % count
      else if (key.name === 'home' || key.char === 'g') state.sel = 0
      else if (key.name === 'end' || key.char === 'G') state.sel = count - 1
      else if (key.name === 'pageup') state.sel = Math.max(0, state.sel - 5)
      else if (key.name === 'pagedown') state.sel = Math.min(count - 1, state.sel + 5)
      else if (key.name === 'enter') await activate(MENU_ITEMS[state.sel])
      else if (key.char === 'q' || key.name === 'escape') return quit()
    } else if (state.mode === 'edit') {
      const fields = editFields(env.config)
      if (key.name === 'up' || key.char === 'k') state.editSel = (state.editSel + fields.length - 1) % fields.length
      else if (key.name === 'down' || key.char === 'j') state.editSel = (state.editSel + 1) % fields.length
      else if (key.name === 'escape') state.mode = 'menu'
      else if (key.name === 'enter') {
        const field = fields[state.editSel]
        if (field.cycle) {
          const next = field.cycle[(field.cycle.indexOf(field.raw) + 1) % field.cycle.length]
          try { saveField(field, next) } catch (error) { state.toast = `❌ ${error.message}` }
        } else {
          state.field = field
          state.buffer = field.raw
          state.mode = 'input'
        }
      }
    } else if (state.mode === 'input') {
      const field = state.field
      if (key.name === 'escape') {
        state.mode = field.id === '__pair' ? 'menu' : 'edit'
        state.field = null
      } else if (key.name === 'backspace') state.buffer = state.buffer.slice(0, -1)
      else if (key.name === 'ctrl-u') state.buffer = ''
      else if (key.name === 'enter') {
        if (field.id === '__pair') {
          const phone = state.buffer.replace(/\D/g, '')
          state.field = null
          state.mode = 'menu'
          await runBot('Vincular con pairing code', phone ? ['--pair', '--phone', phone] : ['--pair'])
        } else {
          try {
            saveField(field, state.buffer)
            state.field = null
            state.mode = 'edit'
          } catch (error) {
            state.toast = `❌ ${error.message}`
          }
        }
      } else if (key.name === 'char' && key.char >= ' ') state.buffer += key.char
    } else if (state.mode === 'text') {
      const maxScroll = Math.max(0, state.textLines.length - 5)
      if (key.name === 'up' || key.char === 'k') state.scroll = Math.max(0, state.scroll - 1)
      else if (key.name === 'down' || key.char === 'j') state.scroll = Math.min(maxScroll, state.scroll + 1)
      else if (key.name === 'pageup') state.scroll = Math.max(0, state.scroll - 10)
      else if (key.name === 'pagedown') state.scroll = Math.min(maxScroll, state.scroll + 10)
      else if (key.name === 'home' || key.char === 'g') state.scroll = 0
      else if (key.name === 'end' || key.char === 'G') state.scroll = maxScroll
      else if (key.name === 'escape' || key.name === 'enter' || key.char === 'q') state.mode = 'menu'
    } else if (state.mode === 'confirm') {
      if (key.name === 'left' || key.name === 'right' || key.name === 'tab' || key.char === 'h' || key.char === 'l') {
        state.confirmSel = state.confirmSel === 0 ? 1 : 0
      } else if (key.name === 'escape') state.mode = 'menu'
      else if (key.name === 'enter') {
        if (state.confirmSel === 1) {
          try {
            rmSync(env.config.sessionDir, { recursive: true, force: true })
            env = freshEnv()
            state.toast = '🗑️ Sesión eliminada. Vincula de nuevo con pairing o QR.'
          } catch (error) {
            state.toast = `❌ ${error.message}`
          }
        }
        state.mode = 'menu'
      }
    }
    render()
  }

  process.stdout.write(`${ESC}[?1049h${ESC}[?25l`)
  process.on('exit', cleanup)
  process.on('SIGTERM', quit)
  process.stdout.on('resize', render)
  process.stdin.setEncoding('utf8')
  try { process.stdin.setRawMode(true) } catch { /* sin TTY */ }
  process.stdin.resume()
  process.stdin.on('data', (chunk) => {
    for (const key of parseKeys(chunk)) {
      if (state.busy) break
      void handleKey(key)
    }
  })
  render()
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  main().catch((error) => {
    try { process.stdout.write(`${ESC}[?25h${ESC}[?1049l`) } catch { /* nada */ }
    console.error(`❌ ${error.message}`)
    process.exit(1)
  })
}
