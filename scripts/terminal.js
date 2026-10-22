#!/usr/bin/env node
/**
 * 🌊 Terminal de TomiOka v2 — TUI estilo OpenCode para Termux
 *
 * Uso:  npm run terminal
 *
 * Pantalla completa sin dependencias nuevas (solo ANSI + modo raw):
 *  · Consola del bot EN VIVO dentro de la terminal (pairing, QR y logs
 *    sin salir de la interfaz), con scroll, entrada y reinicio.
 *  · Paleta de comandos con Ctrl+P y búsqueda difusa.
 *  · Renderizado por diferencias + salida sincronizada (sin parpadeo).
 *  · Temas con degradado truecolor, splash de arranque, reloj, mouse
 *    (rueda y clics), búsqueda en vistas y editor de config en línea.
 * Los cambios de configuración van a config.json (respaldo .bak) y el
 * tema elegido se recuerda en data/terminal-state.json.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig } from '../src/config.js'
import { inspectSession, describeSession } from '../src/lib/session.js'
import { isInteractive } from '../src/lib/prompt.js'
import { stripAnsi } from '../src/lib/colors.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = path.join(ROOT, 'config.json')
const STATE_FILE = path.join(ROOT, 'data', 'terminal-state.json')
const ESC = '\x1b'
const COLOR_OK = !process.env.NO_COLOR

export const LOGO = [
  '████████╗ ██████╗ ███╗   ███╗██╗ ██████╗ ██╗  ██╗ █████╗ ',
  '╚══██╔══╝██╔═══██╗████╗ ████║██║██╔═══██╗██║ ██╔╝██╔══██╗',
  '   ██║   ██║   ██║██╔████╔██║██║██║   ██║█████╔╝ ███████║',
  '   ██║   ██║   ██║██║╚██╔╝██║██║██║   ██║██╔═██╗ ██╔══██║',
  '   ██║   ╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║  ██╗██║  ██║',
  '   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝'
]

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/* ------------------------------------------------------------------ temas */

export const THEMES = {
  ocean: { id: 'ocean', name: 'Océano', a: [56, 189, 248], b: [37, 99, 235], sel: [2, 132, 199] },
  sunset: { id: 'sunset', name: 'Atardecer', a: [251, 191, 36], b: [219, 39, 119], sel: [190, 24, 93] },
  mint: { id: 'mint', name: 'Menta', a: [110, 231, 183], b: [13, 148, 136], sel: [4, 120, 87] },
  violet: { id: 'violet', name: 'Violeta', a: [196, 181, 253], b: [124, 58, 237], sel: [109, 40, 217] }
}
export const THEME_ORDER = ['ocean', 'sunset', 'mint', 'violet']

const fg = ([r, g, b]) => `${ESC}[38;2;${r};${g};${b}m`
const bg = ([r, g, b]) => `${ESC}[48;2;${r};${g};${b}m`
const RESET = `${ESC}[0m`

/** Pinta un texto con el color de acento del tema */
export function accent(text, theme, bold = true) {
  if (!COLOR_OK) return String(text)
  return `${bold ? `${ESC}[1m` : ''}${fg(theme.a)}${text}${RESET}`
}

/** Pinta la fila seleccionada (fondo del tema, letra blanca) */
export function selectedPaint(text, theme) {
  if (!COLOR_OK) return String(text)
  return `${bg(theme.sel)}${ESC}[97m${ESC}[1m${text}${RESET}`
}

/** Degradado truecolor de theme.a a theme.b, carácter a carácter */
export function gradient(text, theme) {
  const str = String(text)
  if (!COLOR_OK) return str
  const chars = [...str]
  const letters = chars.filter((ch) => ch !== ' ').length || 1
  let li = 0
  return chars.map((ch) => {
    if (ch === ' ') return ch
    const t = letters === 1 ? 0 : li / (letters - 1)
    li += 1
    const mix = theme.a.map((v, i) => Math.round(v + (theme.b[i] - v) * t))
    return `${fg(mix)}${ch}`
  }).join('') + RESET
}

/* -------------------------------------------------------- búsqueda difusa */

/** Puntaje de coincidencia difusa (subsecuencia). -1 si no coincide */
export function fuzzyScore(query, text) {
  const q = String(query || '').toLowerCase()
  const t = String(text || '').toLowerCase()
  if (!q) return 0
  let qi = 0
  let score = 0
  let streak = false
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) {
      score += streak ? 3 : 1
      if (i === 0 || /[\s·\-_/]/.test(t[i - 1])) score += 2
      streak = true
      qi += 1
    } else streak = false
  }
  return qi === q.length ? score : -1
}

/** Filtra y ordena acciones por coincidencia difusa con el título+ayuda */
export function filterActions(actions, query) {
  if (!String(query || '').trim()) return [...actions]
  return actions
    .map((action) => ({ action, score: fuzzyScore(query, `${action.title} ${action.hint || ''}`) }))
    .filter((entry) => entry.score >= 0)
    .sort((x, y) => y.score - x.score)
    .map((entry) => entry.action)
}

/* ------------------------------------------------------------- buffer log */

/**
 * Buffer de líneas para la consola en vivo: acepta chunks parciales,
 * respeta \r (barras de progreso) y recorta a las últimas N líneas.
 */
export class LogBuffer {
  constructor(max = 600) {
    this.max = max
    this.lines = []
    this.partial = ''
  }

  push(chunk) {
    const text = this.partial + stripAnsi(String(chunk))
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    const parts = text.split('\n')
    this.partial = parts.pop()
    for (const raw of parts) {
      const segments = raw.split('\r')
      this.lines.push(segments[segments.length - 1])
    }
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max)
  }

  clear() {
    this.lines = []
    this.partial = ''
  }

  /** Todas las líneas visibles, incluida la parcial en curso */
  view() {
    const tail = this.partial.split('\r').pop()
    return tail ? [...this.lines, tail] : [...this.lines]
  }
}

/* ------------------------------------------------------------ utilidades */

/** Filas que cambiaron entre dos frames (para render sin parpadeo) */
export function diffRows(prev, next) {
  const rows = []
  const len = Math.max(prev.length, next.length)
  for (let i = 0; i < len; i += 1) {
    if (prev[i] !== next[i]) rows.push({ row: i, text: next[i] ?? '' })
  }
  return rows
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function formatUptime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${s % 60} s`
  return `${s} s`
}

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

function toBool(value, field) {
  if (typeof value === 'boolean') return value
  const v = String(value || '').trim().toLowerCase()
  if (['sí', 'si', 'true', '1', 'on', 'yes'].includes(v)) return true
  if (['no', 'false', '0', 'off'].includes(v)) return false
  throw new Error(`Valor inválido para ${field} (sí/no).`)
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
    case 'sendAsCaption': {
      ensureObject(cfg, 'menu').sendAsCaption = toBool(value, 'pie de foto')
      break
    }
    case 'showDescriptions': {
      ensureObject(cfg, 'menu').showDescriptions = toBool(value, 'descripciones')
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

/** Recorta un texto a un ancho visible máximo */
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
  { id: 'console', icon: '▶', label: 'Iniciar el bot', hint: 'Consola en vivo dentro de la terminal' },
  { id: 'pair', icon: '🔢', label: 'Vincular · pairing code', hint: 'El código sale en la consola, sin salir de acá' },
  { id: 'qr', icon: '📷', label: 'Vincular · código QR', hint: 'El QR se dibuja en la consola' },
  { id: 'status', icon: '🌊', label: 'Estado del bot', hint: 'Panel con sesión, sistema y actividad' },
  { id: 'config', icon: '✏️', label: 'Editar configuración', hint: 'Nombre, prefijo, owners, pack, banner y más' },
  { id: 'menu', icon: '📋', label: 'Menú de WhatsApp', hint: 'El menú completo ( / para buscar)' },
  { id: 'commands', icon: '⌨️', label: 'Todos los comandos', hint: 'Escribe para filtrar la lista' },
  { id: 'session', icon: '💾', label: 'Sesión y respaldos', hint: 'Datos de la sesión, backup y borrado' },
  { id: 'doctor', icon: '🩺', label: 'Diagnóstico · doctor', hint: 'Revisión del entorno en la consola' },
  { id: 'verify', icon: '✅', label: 'Verificar comandos', hint: 'Los chequeos automáticos del bot' },
  { id: 'update', icon: '⬇️', label: 'Actualizar el bot', hint: 'git pull en la consola' },
  { id: 'theme', icon: '🎨', label: 'Cambiar tema', hint: 'Océano · Atardecer · Menta · Violeta (tecla t)' },
  { id: 'help', icon: '❓', label: 'Ayuda y atajos', hint: 'Todos los atajos de teclado (?)' },
  { id: 'exit', icon: '⏻', label: 'Salir', hint: 'Cierra la terminal de TomiOka' }
]

export const SESSION_ACTIONS = [
  { id: 'backup', icon: '💾', label: 'Crear respaldo de la sesión', hint: 'Copia la carpeta con fecha; no toca la sesión actual' },
  { id: 'delete', icon: '🗑️', label: 'Borrar sesión', hint: 'Cierra WhatsApp y obliga a vincular de nuevo' },
  { id: 'back', icon: '↩', label: 'Volver', hint: 'Regresa al menú principal' }
]

export const LOGIN_MODES = ['ask', 'pairing', 'qr']

/** Campos editables con su valor actual ya formateado para la pantalla */
export function editFields(config) {
  return [
    { id: 'name', label: 'Nombre del bot', value: config.bot.name, raw: config.bot.name, about: 'El nombre que se ve en el menú y los mensajes' },
    { id: 'team', label: 'Team / firma', value: config.bot.team, raw: config.bot.team, about: 'La firma que acompaña al nombre del bot' },
    { id: 'prefix', label: 'Prefijo', value: config.prefixes[0], raw: config.prefixes[0], about: 'Con qué empiezan los comandos (ej: . o !)' },
    { id: 'pairingPhone', label: 'Teléfono pairing', value: config.pairingPhone || '(sin definir)', raw: config.pairingPhone || '', about: 'Número por defecto para el pairing code' },
    { id: 'owners', label: 'Owners', value: config.owner.numbers.join(', ') || '(ninguno)', raw: config.owner.numbers.join(', '), about: 'Dueños del bot, con código de país, separados por comas' },
    { id: 'login', label: 'Modo de login', value: config.login, raw: config.login, cycle: LOGIN_MODES, about: 'Cómo vincula si no hay sesión: ask pregunta, pairing o qr directo' },
    { id: 'packName', label: 'Pack · nombre', value: config.stickers.packName, raw: config.stickers.packName, about: 'Nombre del pack en los stickers que crea el bot' },
    { id: 'packAuthor', label: 'Pack · autor', value: config.stickers.packAuthor, raw: config.stickers.packAuthor, about: 'Autor del pack en los stickers que crea el bot' },
    { id: 'menuImage', label: 'Banner del menú', value: config.menu.image || '(sin banner)', raw: config.menu.image || '', hint: '"-" para quitar el banner', about: 'URL, link de Drive o ruta local de la imagen del menú' },
    { id: 'sendAsCaption', label: 'Menú como pie de foto', value: config.menu.sendAsCaption === false ? 'no' : 'sí', raw: config.menu.sendAsCaption === false ? 'no' : 'sí', cycle: ['sí', 'no'], about: 'Pega el menú a la foto del banner si entra en el límite de WhatsApp' },
    { id: 'showDescriptions', label: 'Descripciones en el menú', value: config.menu.showDescriptions ? 'sí' : 'no', raw: config.menu.showDescriptions ? 'sí' : 'no', cycle: ['sí', 'no'], about: 'Muestra la descripción junto a cada comando en .help' }
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

/** Panel de estado enriquecido (vista Estado) */
export function dashboardLines(config, session, extra = {}) {
  const {
    commandCount = 0,
    categoryCount = 0,
    backupCount = 0,
    botRunning = false,
    uptime = ''
  } = extra
  return [
    '🌊 Panel de estado',
    '',
    '  Bot',
    `    Nombre     ${config.bot.name}`,
    `    Team       ${config.bot.team}`,
    `    Prefijo    ${config.prefixes.join('  ')}`,
    `    Login      ${config.login}${config.pairingPhone ? ` · ${config.pairingPhone}` : ''}`,
    '',
    '  Sesión de WhatsApp',
    `    Estado     ${describeSession(session)}`,
    `    Número     ${session.me ? String(session.me).split('@')[0] : '—'}`,
    `    Archivos   ${session.files} en ${config.sessionDir}`,
    `    Creds      ${formatBytes(session.bytes)} · ${backupCount} respaldo(s)`,
    '',
    '  Sistema',
    `    Node       ${process.version} · ${process.platform}/${process.arch}`,
    `    Terminal   activa hace ${uptime || '—'}`,
    '',
    '  Actividad',
    `    Comandos   ${commandCount} visibles en ${categoryCount} categorías del menú`,
    `    Owners     ${config.owner.numbers.length} número(s)`,
    `    Consola    ${botRunning ? '⏺ bot corriendo en la consola' : '⏹ bot detenido'}`,
    '',
    '  Pulsa r para refrescar · esc para volver'
  ]
}

export function createState() {
  return {
    mode: 'menu', // menu | console | config | session | viewer
    overlay: null, // palette | input | confirm | help
    sel: 0,
    configSel: 0,
    sessionSel: 0,
    viewer: { title: '', kind: '', lines: [], scroll: 0, query: '', searching: false, filterable: false },
    palette: { query: '', sel: 0 },
    input: null,
    confirm: null,
    confirmSel: 0,
    fieldError: '',
    buffer: '',
    consoleInput: false,
    consoleBuffer: '',
    follow: true,
    botScroll: 0,
    toast: '',
    homeQuery: '',
    leader: false,
    splash: true,
    tick: 0,
    hit: {}
  }
}

const HINTS = {
  menu: 'escribí para buscar · ↑↓ navegar · enter abrir · ctrl+p comandos · ctrl+x atajos · ? ayuda',
  console: '↑↓ scroll · i escribir al bot · r reiniciar · x detener · esc volver',
  config: '↑↓ campos · enter editar · esc volver',
  session: '↑↓ acciones · enter ejecutar · esc volver',
  viewer: '↑↓ scroll · pgup/pgdn · esc volver',
  palette: 'escribe para filtrar · ↑↓ · enter abrir · esc cerrar',
  input: 'enter confirmar · esc cancelar · ctrl+u borrar',
  confirm: '←→ elegir · enter confirmar · esc cancelar',
  help: 'esc o enter para cerrar'
}

export const HELP_LINES = [
  'Atajos de teclado',
  '',
  '  ctrl+p / ctrl+k   Paleta de comandos (busca todo)',
  '  ctrl+x + tecla    Atajos: c consola · p pairing · q QR · s estado',
  '                    e editar · m menú · k comandos · d doctor · u actualizar',
  '                    t tema · h ayuda · x salir',
  '  ↑ ↓  o  j k       Mover la selección / hacer scroll',
  '  enter             Abrir, guardar o confirmar',
  '  esc               Volver, cerrar o cancelar',
  '  pgup pgdn · g G   Saltar por páginas / ir al inicio o final',
  '  ?                 Esta ayuda',
  '  t                 Cambiar el tema de colores',
  '  q                 Salir de la terminal',
  '',
  '  En la consola del bot:',
  '  i                 Escribir una línea al bot (ej: el teléfono)',
  '  r                 Reiniciar el proceso',
  '  x  o  ctrl+c      Detener el proceso',
  '  c                 Limpiar la consola',
  '',
  '  En el menú de WhatsApp y los comandos:',
  '  /                 Buscar (n / N siguiente o anterior)',
  '  (en comandos, escribir filtra la lista al instante)',
  '',
  '  Mouse: la rueda hace scroll y el doble clic abre.'
]

/** Líneas visibles de una vista de texto según su filtro/búsqueda */
export function viewerLines(viewer) {
  const query = (viewer.query || '').toLowerCase()
  if (!query) return { lines: viewer.lines, matches: [] }
  const lines = []
  const matches = []
  viewer.lines.forEach((line, index) => {
    if (String(line).toLowerCase().includes(query)) {
      matches.push(lines.length)
      lines.push(line)
    } else if (!viewer.filterable) {
      lines.push(line)
    }
  })
  return { lines, matches }
}

/* ------------------------------------------------------------------ render */
/* Render estilo OpenCode: home centrada con caja de prompt, sesión con
 * sidebar de contexto, diálogos centrados y barra de estado inferior. */

const DIM = '\x1b[90m'
const FAINT = '\x1b[38;2;150;150;150m'
const BAR_BG = '\x1b[48;2;26;26;26m'

function clockOf(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

/** Acciones visibles en la paleta según el texto escrito */
export function paletteList(state, env) {
  return filterActions(env.actions || [], state.palette.query)
}

/** Secciones visibles en la home según lo escrito en el prompt */
export function homeList(state) {
  if (!state.homeQuery) return [...MENU_ITEMS]
  return filterActions(
    MENU_ITEMS.map((item) => ({ ...item, title: item.label })),
    state.homeQuery
  ).map((entry) => MENU_ITEMS.find((item) => item.label === entry.title) || entry)
}

function windowStart(selected, total, size) {
  if (total <= size) return 0
  return Math.min(Math.max(0, selected - Math.floor(size / 2)), total - size)
}

const VIEW_TITLES = {
  console: 'Consola del bot',
  config: 'Editar configuración',
  session: 'Sesión y respaldos'
}

/**
 * Arma la pantalla completa (array de líneas con ANSI).
 * Casi pura: solo anota en state.hit las filas clicables para el mouse.
 */
export function renderFrame(state, env, width = 80, height = 24) {
  const W = Math.max(30, width)
  const H = Math.max(10, height)
  const theme = env.theme || THEMES.ocean
  const now = env.now || new Date()
  const linked = Boolean(env.session?.registered)
  state.hit = {}

  const isHome = state.mode === 'menu' && !state.overlay
  const header = []
  if (!isHome) {
    const title = state.mode === 'viewer' ? state.viewer.title : VIEW_TITLES[state.mode] || 'Inicio'
    header.push(
      ` ${accent('🌊 TomiOka', theme)} ${DIM}· ${clip(title, Math.max(8, W - 34))} · ${linked ? '🟢 vinculado' : '🔴 sin sesión'}${RESET}`
    )
  }

  const hintsKey = state.overlay || (state.mode === 'viewer' && state.viewer.searching ? 'input' : state.mode)
  const footer = []
  if (state.toast) footer.push(clip(` ${'\x1b[33m'}${state.toast}${RESET}`, W))
  footer.push(clip(`${DIM} ${state.leader ? 'ctrl+x … pulsá una tecla (c consola · p pairing · e editar · x salir)' : HINTS[hintsKey] || ''}${RESET}`, W))
  const viewLabel = state.overlay ? state.overlay : isHome ? 'inicio' : state.mode
  const leftBar = ` 🌊 tomioka ${RESET}${BAR_BG}${FAINT} ${viewLabel}${state.leader ? ' · ctrl+x…' : ''} `
  const rightBar = `${linked ? '🟢 vinculado' : '🔴 sin sesión'} · ${theme.name} · ${clockOf(now)} `
  const leftW = textWidth(stripAnsi(leftBar))
  const barPlain = pad('', Math.max(0, W - leftW - textWidth(rightBar))) + rightBar
  footer.push(COLOR_OK ? `${bg(theme.b)}${ESC}[97m${leftBar}${BAR_BG}${FAINT}${pad(barPlain, W - leftW)}${RESET}` : `${stripAnsi(leftBar)}${barPlain}`)

  const bodyH = Math.max(3, H - header.length - footer.length)
  const body = state.overlay
    ? renderOverlay(state, env, W, bodyH, header.length)
    : renderMain(state, env, W, bodyH, header.length)

  const frame = [...header, ...body.slice(0, bodyH), ...footer]
  while (frame.length < H) frame.splice(frame.length - footer.length, 0, '')
  return frame.slice(0, H).map((line) => clip(line, W))
}

function renderMain(state, env, W, bodyH, bodyTop) {
  if (state.mode === 'menu') return renderHome(state, env, W, bodyH, bodyTop)
  if (state.mode === 'console') return renderConsole(state, env, W, bodyH, bodyTop)
  if (state.mode === 'config') return renderConfig(state, env, W, bodyH, bodyTop, 0)
  if (state.mode === 'session') return renderSession(state, env, W, bodyH, bodyTop, 0)
  if (state.mode === 'viewer') return renderViewer(state, env, W, bodyH)
  return renderHome(state, env, W, bodyH, bodyTop)
}

function renderHome(state, env, W, bodyH, bodyTop) {
  const theme = env.theme || THEMES.ocean
  const { config, session } = env
  const list = homeList(state)
  state.sel = Math.min(state.sel, Math.max(0, list.length - 1))

  const big = W >= 62
  const bw = Math.max(28, Math.min(74, W - 6))
  const left = Math.max(0, Math.floor((W - bw) / 2))
  const padL = ' '.repeat(left)
  const listRows = Math.min(8, list.length)
  const contentH = (big ? LOGO.length + 2 : 2) + 3 + listRows + 1
  const top = Math.max(0, Math.floor((bodyH - contentH) / 3))
  const rows = Array.from({ length: top }, () => '')
  const bodyStart = bodyTop + rows.length

  if (big) {
    for (const line of LOGO) rows.push(padL + gradient(line, theme))
    rows.push(padL + `  ${accent('🌊 Terminal del bot', theme)} ${DIM}· todo TomiOka desde una sola pantalla 💧${RESET}`)
    rows.push('')
  } else {
    rows.push(padL + accent('🌊 TomiOka', theme))
    rows.push('')
  }

  const inner = bw - 4
  const query = state.homeQuery
  const promptText = query
    ? `› ${query}${COLOR_OK ? `${bg(theme.a)} ${RESET}` : '█'}`
    : `› ${DIM}Escribí para buscar… (pairing, sticker, tema)${RESET}`
  const linkedTxt = session?.registered ? '🟢 vinculado' : '🔴 sin sesión'
  rows.push(padL + `${DIM}╭${'─'.repeat(bw - 2)}╮${RESET}`)
  rows.push(padL + `${DIM}│${RESET} ${pad(promptText, inner)} ${DIM}│${RESET}`)
  rows.push(padL + `${DIM}│${RESET} ${pad(`${DIM}🌊 ${clip(config.bot.name, 26)} · prefijo ${config.prefixes[0]} · ${linkedTxt}${RESET}`, inner)} ${DIM}│${RESET}`)
  rows.push(padL + `${DIM}╰${'─'.repeat(bw - 2)}╯${RESET}`)

  const start = windowStart(state.sel, list.length, listRows)
  for (let i = 0; i < listRows; i += 1) {
    const index = start + i
    const item = list[index]
    if (!item) break
    const running = item.id === 'console' && env.bot?.running ? ' ⏺' : ''
    const text = `${item.icon} ${item.label}${running}`
    const line = index === state.sel
      ? selectedPaint(pad(` ${text} `, bw - 2), theme)
      : `${DIM} ${RESET}${pad(` ${text}`, bw - 2)}`
    state.hit[bodyStart + rows.length] = { kind: 'section', index, itemId: item.id, x1: left, x2: left + bw }
    rows.push(padL + line)
  }
  if (!list.length) rows.push(padL + `${DIM} Sin resultados para «${clip(query, 30)}»${RESET}`)
  rows.push('')
  rows.push(padL + `${DIM}enter abrir · ctrl+p comandos · ctrl+x atajos · ? ayuda${RESET}`)
  return rows.slice(0, bodyH)
}
function renderConsole(state, env, W, bodyH, bodyTop) {
  const theme = env.theme || THEMES.ocean
  const bot = env.bot || { running: false, title: '', lines: [] }
  const wide = W >= 92
  const sideW = wide ? 30 : 0
  const mainW = W - (wide ? sideW + 3 : 0)

  const spin = bot.running ? SPINNER[state.tick % SPINNER.length] : '⏹'
  const title = ` ${accent(`${spin} ${bot.title || 'Consola del bot'}`, theme)} ${DIM}${bot.running ? '· corriendo' : '· detenido'}${state.follow ? '' : ' · ⬇ hay líneas nuevas (G para seguir)'}${RESET}`
  const all = bot.lines || []
  const boxH = 3
  const viewH = Math.max(1, bodyH - 2 - boxH)
  const maxStart = Math.max(0, all.length - viewH)
  const start = state.follow ? maxStart : Math.min(state.botScroll, maxStart)

  const main = [title, `${DIM} ${'─'.repeat(Math.max(4, mainW - 2))}${RESET}`]
  if (!all.length) main.push(` ${DIM}La consola está vacía. Inicia el bot o vincula para ver la actividad.${RESET}`)
  for (const line of all.slice(start, start + viewH)) main.push(` ${clip(line, mainW - 1)}`)
  while (main.length < 2 + viewH) main.push('')

  const bw = Math.max(24, mainW - 2)
  const inputText = state.consoleInput
    ? `› ${state.consoleBuffer}${COLOR_OK ? `${bg(theme.a)} ${RESET}` : '█'}`
    : `› ${DIM}${bot.running ? 'Pulsá i para escribir al bot…' : 'El bot está detenido · r para reiniciar'}${RESET}`
  main.push(`${DIM}╭${'─'.repeat(bw - 2)}╮${RESET}`)
  main.push(`${DIM}│${RESET} ${pad(inputText, bw - 4)} ${DIM}│${RESET}`)
  main.push(`${DIM}│${RESET} ${pad(`${DIM}bot · ${bot.running ? 'corriendo' : 'detenido'} · x detener · r reiniciar · esc volver${RESET}`, bw - 4)} ${DIM}│${RESET}`)
  main.push(`${DIM}╰${'─'.repeat(bw - 2)}╯${RESET}`)

  if (!wide) return main.slice(0, bodyH)

  const { config, session } = env
  const side = [
    accent('Contexto', theme),
    `${DIM}${'─'.repeat(sideW - 2)}${RESET}`,
    `${DIM}Sesión${RESET}  ${describeSession(session)}`,
    `${DIM}Número${RESET}  ${session.me ? String(session.me).split('@')[0] : '—'}`,
    `${DIM}Prefijo${RESET} ${config.prefixes.join(' ')}`,
    `${DIM}Login${RESET}   ${config.login}`,
    `${DIM}Owners${RESET}  ${config.owner.numbers.length}`,
    `${DIM}Tema${RESET}    ${theme.name}`,
    '',
    accent('Consola', theme),
    `${DIM}${'─'.repeat(sideW - 2)}${RESET}`,
    bot.running ? '⏺ corriendo' : '⏹ detenido',
    `${all.length} líneas de registro`,
    '',
    `${DIM}ctrl+x luego:${RESET}`,
    `${DIM} c${RESET} consola  ${DIM}p${RESET} pairing`,
    `${DIM} e${RESET} editar   ${DIM}m${RESET} menú`,
    `${DIM} k${RESET} comandos ${DIM}x${RESET} salir`
  ]
  return main.slice(0, bodyH).map((line, i) => `${pad(line, mainW)} ${DIM}│${RESET} ${side[i] || ''}`)
}

function renderConfig(state, env, W, bodyH, bodyTop, x0) {
  const theme = env.theme || THEMES.ocean
  const fields = editFields(env.config)
  const detailH = 4
  const listH = Math.max(1, bodyH - detailH)
  const start = windowStart(state.configSel, fields.length, listH)
  const rows = []
  for (let r = 0; r < listH; r += 1) {
    const index = start + r
    const field = fields[index]
    if (!field) { rows.push(''); continue }
    const labelW = Math.min(26, Math.floor(W * 0.34))
    const label = pad(field.label, labelW)
    const value = field.cycle ? `${field.value} ⇄` : field.value
    const line = index === state.configSel
      ? selectedPaint(pad(` ${label} ${clip(value, W - labelW - 4)} `, W - x0), theme)
      : `  ${label} ${DIM}${clip(value, W - labelW - 4)}${RESET}`
    state.hit[bodyTop + r] = { kind: 'field', index, x1: x0, x2: W }
    rows.push(line)
  }
  const field = fields[state.configSel]
  rows.push(`${DIM} ${'─'.repeat(Math.min(W - 2, 70))}${RESET}`)
  if (state.fieldError) rows.push(clip(` ${'\x1b[31m'}✖ ${state.fieldError}${RESET}`, W))
  else if (field) rows.push(clip(` ${DIM}${field.about || ''}${RESET}`, W))
  rows.push(` ${DIM}${field?.cycle ? 'enter cambia el valor' : 'enter para escribir el nuevo valor'} · se guarda en config.json (respaldo .bak)${RESET}`)
  rows.push('')
  return rows.slice(0, bodyH)
}

function renderSession(state, env, W, bodyH, bodyTop, x0) {
  const theme = env.theme || THEMES.ocean
  const { config, session } = env
  const rows = [
    ` ${accent('💾 Sesión de WhatsApp', theme)}`,
    '',
    `  ${DIM}Estado   ${RESET}${describeSession(session)}`,
    `  ${DIM}Número   ${RESET}${session.me ? String(session.me).split('@')[0] : '—'}`,
    `  ${DIM}Archivos ${RESET}${session.files} · creds ${formatBytes(session.bytes)}`,
    `  ${DIM}Carpeta  ${RESET}${clip(config.sessionDir, W - 13)}`,
    `  ${DIM}Respaldos${RESET} ${env.backups?.length ? env.backups.slice(0, 3).join(', ') + (env.backups.length > 3 ? ` y ${env.backups.length - 3} más` : '') : 'ninguno'}`,
    ''
  ]
  SESSION_ACTIONS.forEach((action, index) => {
    const text = `${action.icon} ${action.label}`
    const line = index === state.sessionSel ? selectedPaint(pad(` ${text} `, W - x0), theme) : pad(`  ${text}`, W - x0)
    state.hit[bodyTop + rows.length] = { kind: 'session-action', index, x1: x0, x2: W }
    rows.push(line)
  })
  rows.push('', ` ${DIM}${SESSION_ACTIONS[state.sessionSel]?.hint || ''}${RESET}`)
  return rows.slice(0, bodyH)
}

function renderViewer(state, env, W, bodyH) {
  const theme = env.theme || THEMES.ocean
  const viewer = state.viewer
  const { lines, matches } = viewerLines(viewer)
  const searching = viewer.searching || (viewer.filterable && viewer.query)
  const headH = searching ? 2 : 1
  const viewH = Math.max(1, bodyH - headH)
  const maxScroll = Math.max(0, lines.length - viewH)
  const scroll = Math.min(viewer.scroll, maxScroll)
  const rows = []
  if (searching) {
    rows.push(` ${accent('🔎', theme, false)} ${viewer.query}${viewer.searching ? (COLOR_OK ? `${bg(theme.a)} ${RESET}` : '█') : ''} ${DIM}${matches.length} coincidencia(s) · línea ${Math.min(scroll + 1, lines.length)}/${lines.length}${RESET}`)
    rows.push(`${DIM} ${'─'.repeat(Math.min(W - 2, 70))}${RESET}`)
  } else {
    rows.push(` ${DIM}${lines.length} líneas · ${scroll + 1}/${Math.max(1, lines.length)}${RESET}`)
  }
  for (const line of lines.slice(scroll, scroll + viewH)) rows.push(` ${clip(line, W - 1)}`)
  return rows.slice(0, bodyH)
}

function renderOverlay(state, env, W, bodyH, bodyTop) {
  const theme = env.theme || THEMES.ocean
  let box = []
  let boxW = 44
  let buttons = null

  if (state.overlay === 'palette') {
    const list = paletteList(state, env)
    state.palette.sel = Math.min(state.palette.sel, Math.max(0, list.length - 1))
    boxW = Math.min(68, W - 4)
    const inner = boxW - 4
    const shown = 9
    const start = windowStart(state.palette.sel, list.length, shown)
    const wrap = (content) => `${DIM}│${RESET} ${pad(content, inner)} ${DIM}│${RESET}`
    box = [
      `${DIM}╭${'─'.repeat(boxW - 2)}╮${RESET}`,
      wrap(accent('Paleta de comandos', theme)),
      wrap(`› ${state.palette.query}${COLOR_OK ? `${bg(theme.a)} ${RESET}` : '█'}`),
      wrap(`${DIM}${'─'.repeat(inner)}${RESET}`)
    ]
    if (!list.length) box.push(wrap(`${DIM}Sin resultados${RESET}`))
    for (let n = 0; n < shown; n += 1) {
      const index = start + n
      const action = list[index]
      if (!action) break
      const content = index === state.palette.sel ? selectedPaint(pad(` ${action.title} `, inner), theme) : `  ${action.title}`
      box._hits = box._hits || {}
      box._hits[box.length] = { kind: 'palette', index }
      box.push(wrap(content))
    }
    const current = list[state.palette.sel]
    if (current) box.push(wrap(`${DIM}${clip(current.hint || '', inner)}${RESET}`))
    box.push(wrap(`${DIM}enter abrir · esc cerrar${RESET}`))
    box.push(`${DIM}╰${'─'.repeat(boxW - 2)}╯${RESET}`)
  } else if (state.overlay === 'input' && state.input) {
    boxW = Math.min(62, W - 4)
    const inner = boxW - 4
    box = [
      `${DIM}╭${'─'.repeat(boxW - 2)}╮${RESET}`,
      `${DIM}│${RESET} ${pad(accent(state.input.title, theme), inner)} ${DIM}│${RESET}`,
      `${DIM}│${RESET} ${pad(`› ${state.buffer}${COLOR_OK ? `${bg(theme.a)} ${RESET}` : '█'}`, inner)} ${DIM}│${RESET}`
    ]
    if (state.fieldError) box.push(`${DIM}│${RESET} ${pad(`${'\x1b[31m'}✖ ${state.fieldError}${RESET}`, inner)} ${DIM}│${RESET}`)
    if (state.input.hint) box.push(`${DIM}│${RESET} ${pad(`${DIM}${clip(state.input.hint, inner)}${RESET}`, inner)} ${DIM}│${RESET}`)
    box.push(`${DIM}│${RESET} ${pad(`${DIM}enter confirmar · esc cancelar${RESET}`, inner)} ${DIM}│${RESET}`)
    box.push(`${DIM}╰${'─'.repeat(boxW - 2)}╯${RESET}`)
  } else if (state.overlay === 'confirm' && state.confirm) {
    boxW = Math.min(58, W - 4)
    const inner = boxW - 4
    const cancelTxt = '  Cancelar  '
    const okTxt = `  ${state.confirm.okLabel}  `
    const cancel = state.confirmSel === 0 ? selectedPaint(cancelTxt, theme) : cancelTxt
    const ok = state.confirmSel === 1 ? selectedPaint(okTxt, theme) : `${ESC}[31m${okTxt}${RESET}`
    box = [
      `${DIM}╭${'─'.repeat(boxW - 2)}╮${RESET}`,
      `${DIM}│${RESET} ${pad(accent(state.confirm.title, theme), inner)} ${DIM}│${RESET}`
    ]
    for (const line of String(state.confirm.body || '').split('\n')) box.push(`${DIM}│${RESET} ${pad(clip(line, inner), inner)} ${DIM}│${RESET}`)
    box.push(`${DIM}│${RESET} ${' '.repeat(inner)} ${DIM}│${RESET}`)
    const btnRow = box.length
    box.push(`${DIM}│${RESET} ${pad(`   ${cancel}    ${ok}`, inner)} ${DIM}│${RESET}`)
    box.push(`${DIM}╰${'─'.repeat(boxW - 2)}╯${RESET}`)
    buttons = { row: btnRow, items: [{ which: 0, xoff: 5, len: cancelTxt.length }, { which: 1, xoff: 5 + cancelTxt.length + 4, len: okTxt.length }] }
  } else if (state.overlay === 'help') {
    boxW = Math.min(66, W - 4)
    const inner = boxW - 4
    box = [
      `${DIM}╭${'─'.repeat(boxW - 2)}╮${RESET}`,
      `${DIM}│${RESET} ${pad(accent('❓ Ayuda y atajos', theme), inner)} ${DIM}│${RESET}`
    ]
    for (const line of HELP_LINES.slice(0, Math.max(1, bodyH - 4))) box.push(`${DIM}│${RESET} ${pad(clip(line, inner), inner)} ${DIM}│${RESET}`)
    box.push(`${DIM}╰${'─'.repeat(boxW - 2)}╯${RESET}`)
  }

  const leftPad = Math.max(0, Math.floor((W - boxW) / 2))
  const topPad = Math.max(0, Math.floor((bodyH - box.length) / 2))
  const rows = Array.from({ length: topPad }, () => '')
  box.forEach((line, i) => {
    if (box._hits?.[i]) state.hit[bodyTop + topPad + i] = { ...box._hits[i], x1: leftPad, x2: leftPad + boxW }
    rows.push(' '.repeat(leftPad) + line)
  })
  if (buttons) {
    const absRow = bodyTop + topPad + buttons.row
    state.hit[absRow] = buttons.items.map((btn) => ({ kind: 'confirm-btn', which: btn.which, x1: leftPad + btn.xoff, x2: leftPad + btn.xoff + btn.len }))
  }
  return rows
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
      const rest = s.slice(i)
      const mouse = rest.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
      if (mouse) {
        keys.push({ name: 'mouse', button: Number(mouse[1]), x: Number(mouse[2]), y: Number(mouse[3]), release: mouse[4] === 'm' })
        i += mouse[0].length
        continue
      }
      const m = rest.match(/^\x1b\[([0-9;]*)([A-Za-z~])/)
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
    else if (ch === '\x10') keys.push({ name: 'ctrl-p' })
    else if (ch === '\x0b') keys.push({ name: 'ctrl-k' })
    else if (ch === '\x15') keys.push({ name: 'ctrl-u' })
    else if (ch === '\x12') keys.push({ name: 'ctrl-r' })
    else if (ch === '\x18') keys.push({ name: 'ctrl-x' })
    else if (ch === '\t') keys.push({ name: 'tab' })
    else keys.push({ name: 'char', char: ch })
    i += 1
  }
  return keys
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

function loadUiTheme() {
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return THEMES[data.theme] ? data.theme : 'ocean'
  } catch {
    return 'ocean'
  }
}

function saveUiTheme(id) {
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, `${JSON.stringify({ theme: id }, null, 2)}\n`)
  } catch { /* si no se puede, el tema dura la sesión */ }
}

/* --------------------------------------------------------------------- main */

async function main() {
  if (!isInteractive()) {
    console.log('🌊 Terminal de TomiOka: se usa en vivo desde Termux con `npm run terminal`.')
    return
  }

  const startedAt = Date.now()
  const state = createState()
  let theme = THEMES[loadUiTheme()] || THEMES.ocean
  let commandsModule = null
  let menuModule = null
  let dirty = true
  let lastClick = { at: 0, row: -1 }

  const bot = { proc: null, running: false, title: '', argv: null, cmd: null, buffer: new LogBuffer(600) }
  const botView = () => ({ running: bot.running, title: bot.title, lines: bot.buffer.view() })

  const listBackups = (config) => {
    try {
      const parent = path.dirname(config.sessionDir)
      const base = path.basename(config.sessionDir)
      return readdirSync(parent).filter((name) => name.startsWith(`${base}-backup-`)).sort().reverse()
    } catch {
      return []
    }
  }

  const freshEnv = () => {
    const config = loadConfig()
    return { config, session: inspectSession(config.sessionDir), theme, backups: listBackups(config), actions: [] }
  }
  let env = freshEnv()
  const refreshEnv = () => { env = freshEnv(); env.actions = buildActions() }
  const renderEnv = () => ({ ...env, theme, bot: botView(), now: new Date() })

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

  /* ---------------------------------------------------------- consola viva */

  function spawnConsole(title, argv, cmd = process.execPath) {
    const start = () => {
      bot.buffer.push(`\n🌊 ${title}\n`)
      bot.title = title
      bot.argv = argv
      bot.cmd = cmd
      bot.running = true
      state.mode = 'console'
      state.follow = true
      state.consoleInput = false
      const proc = spawn(cmd, argv, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } })
      bot.proc = proc
      proc.stdout.on('data', (data) => { bot.buffer.push(data); dirty = true })
      proc.stderr.on('data', (data) => { bot.buffer.push(data); dirty = true })
      proc.on('error', (error) => {
        bot.buffer.push(`\n✖ No se pudo iniciar: ${error.message}`)
        bot.running = false
        bot.proc = null
        dirty = true
      })
      proc.on('exit', (code, signal) => {
        if (bot.proc !== proc) return
        bot.running = false
        bot.proc = null
        bot.buffer.push(`\n⏹ Proceso terminado${code !== null ? ` (código ${code})` : ''}${signal ? ` · señal ${signal}` : ''}. r reinicia · esc vuelve.`)
        refreshEnv()
        dirty = true
      })
      dirty = true
    }
    if (bot.proc) {
      const old = bot.proc
      bot.proc = null
      bot.running = false
      let started = false
      const startOnce = () => { if (!started) { started = true; start() } }
      old.kill('SIGINT')
      const timer = setTimeout(() => { try { old.kill('SIGKILL') } catch { /* ya murió */ } startOnce() }, 1400)
      timer.unref?.()
      old.once('exit', () => { clearTimeout(timer); startOnce() })
    } else start()
  }

  function stopBot() {
    if (!bot.proc) return
    bot.proc.kill('SIGINT')
    state.toast = '⏹ Deteniendo el bot…'
    const proc = bot.proc
    setTimeout(() => { if (bot.proc === proc) { try { proc.kill('SIGKILL') } catch { /* ya murió */ } } }, 1500).unref?.()
    dirty = true
  }

  /* ------------------------------------------------------------- acciones */

  const openViewer = (viewer) => {
    state.viewer = { scroll: 0, query: '', searching: false, filterable: false, ...viewer }
    state.mode = 'viewer'
  }

  const openInput = (input) => {
    state.input = input
    state.buffer = input.initial || ''
    state.fieldError = ''
    state.overlay = 'input'
  }

  const openConfirm = (confirm) => {
    state.confirm = confirm
    state.confirmSel = 0
    state.overlay = 'confirm'
  }

  const dashboard = () => dashboardLines(env.config, env.session, {
    commandCount: commandsModule ? commandsModule.commandList.filter((cmd) => !cmd.hidden).length : 0,
    categoryCount: env.config.menu.categories.length,
    backupCount: env.backups.length,
    botRunning: bot.running,
    uptime: formatUptime((Date.now() - startedAt) / 1000)
  })

  function saveField(field, value) {
    const raw = loadRawConfig()
    applyConfigEdit(raw, field.id, field.id === 'menuImage' && String(value).trim() === '-' ? '' : value)
    saveRawConfig(raw)
    refreshEnv()
    state.toast = `✅ ${field.label} guardado`
  }

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme.id) + 1) % THEME_ORDER.length]
    theme = THEMES[next]
    saveUiTheme(next)
    refreshEnv()
    state.toast = `🎨 Tema ${theme.name}`
  }

  function createBackup() {
    if (!env.session.exists) { state.toast = '⚠️ No hay sesión para respaldar'; return }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = `${env.config.sessionDir}-backup-${stamp}`
    try {
      cpSync(env.config.sessionDir, target, { recursive: true })
      refreshEnv()
      state.toast = `💾 Respaldo creado: ${path.basename(target)}`
    } catch (error) {
      state.toast = `✖ ${error.message}`
    }
  }

  function deleteSession() {
    try {
      rmSync(env.config.sessionDir, { recursive: true, force: true })
      refreshEnv()
      state.toast = '🗑️ Sesión eliminada. Vincula de nuevo con pairing o QR.'
    } catch (error) {
      state.toast = `✖ ${error.message}`
    }
    state.mode = 'menu'
  }

  async function activateSection(id) {
    if (id === 'console') {
      if (!bot.running) spawnConsole('Bot de TomiOka', [path.join(ROOT, 'scripts', 'boot.js')])
      else state.mode = 'console'
    } else if (id === 'pair') {
      openInput({
        kind: 'pair',
        title: '🔢 Vincular con pairing code',
        hint: 'Con código de país, sin + ni espacios. Vacío = usar el de la config.',
        initial: env.config.pairingPhone || ''
      })
    } else if (id === 'qr') {
      spawnConsole('Vincular · código QR', [path.join(ROOT, 'scripts', 'boot.js'), '--qr'])
    } else if (id === 'status') {
      await loadCommands()
      openViewer({ title: '🌊 Estado del bot', kind: 'status', lines: dashboard() })
    } else if (id === 'config') {
      state.mode = 'config'
    } else if (id === 'menu') {
      const mod = await loadCommands()
      if (mod && menuModule) {
        openViewer({ title: '📋 Menú de WhatsApp', kind: 'menu', lines: menuModule.buildMenu({ config: env.config, commands: mod.commands, sender: { label: 'Termux' } }).split('\n') })
      } else openViewer({ title: '📋 Menú de WhatsApp', kind: 'menu', lines: ['No se pudieron cargar los comandos.', 'Corre primero npm install o inicia el bot una vez.'] })
    } else if (id === 'commands') {
      const mod = await loadCommands()
      if (mod) {
        const list = mod.commandList.filter((cmd) => !cmd.hidden)
        openViewer({ title: `⌨️ Todos los comandos (${list.length})`, kind: 'commands', filterable: true, lines: list.map((cmd) => `  .${cmd.name}  ${cmd.description || ''}`) })
      } else openViewer({ title: '⌨️ Todos los comandos', kind: 'commands', lines: ['No se pudieron cargar los comandos.'] })
    } else if (id === 'session') {
      state.mode = 'session'
    } else if (id === 'doctor') {
      spawnConsole('Diagnóstico · doctor', [path.join(ROOT, 'scripts', 'boot.js'), '--doctor'])
    } else if (id === 'verify') {
      spawnConsole('Verificar comandos', [path.join(ROOT, 'scripts', 'verify-commands.js')])
    } else if (id === 'update') {
      spawnConsole('Actualizar el bot · git pull', ['pull'], 'git')
    } else if (id === 'theme') cycleTheme()
    else if (id === 'help') state.overlay = 'help'
    else if (id === 'exit') quitRequest()
    dirty = true
  }

  function buildActions() {
    const actions = MENU_ITEMS.map((item) => ({
      id: `section:${item.id}`,
      title: item.label,
      hint: item.hint,
      run: () => activateSection(item.id)
    }))
    editFields(env.config).forEach((field, index) => {
      actions.push({
        id: `field:${field.id}`,
        title: `Editar · ${field.label}`,
        hint: field.about || '',
        run: () => {
          state.mode = 'config'
          state.configSel = index
          if (field.cycle) {
            const next = field.cycle[(field.cycle.indexOf(field.raw) + 1) % field.cycle.length]
            try { saveField(field, next) } catch (error) { state.toast = `✖ ${error.message}` }
          } else openInput({ kind: 'field', field, title: `✏️ ${field.label}`, hint: field.hint || field.about || '', initial: field.raw })
        }
      })
    })
    if (bot.running) {
      actions.push({ id: 'bot:stop', title: 'Detener el bot', hint: 'Corta el proceso de la consola', run: () => { stopBot() } })
      actions.push({ id: 'bot:restart', title: 'Reiniciar el bot', hint: 'Vuelve a lanzar el proceso de la consola', run: () => { if (bot.argv) spawnConsole(bot.title, bot.argv, bot.cmd) } })
    }
    actions.push({ id: 'console:clear', title: 'Limpiar la consola', hint: 'Borra el historial de logs', run: () => { bot.buffer.clear(); state.mode = 'console' } })
    actions.push({ id: 'backup', title: 'Crear respaldo de la sesión', hint: 'Copia con fecha junto a la sesión', run: () => createBackup() })
    actions.push({ id: 'refresh', title: 'Refrescar estado', hint: 'Relee config.json y la sesión', run: () => { refreshEnv(); state.toast = '🌊 Estado refrescado' } })
    return actions
  }
  env.actions = buildActions()

  /* --------------------------------------------------------------- render */

  let prevFrame = []
  let prevSize = ''

  function splashFrame(W, H) {
    const lines = Array.from({ length: H }, () => '')
    const art = [...LOGO.map((line) => gradient(line, theme)), '', accent('🌊 Terminal del bot', theme), '\x1b[90mCargando tu océano…\x1b[0m']
    const top = Math.max(0, Math.floor((H - art.length) / 2))
    art.forEach((line, i) => {
      const left = ' '.repeat(Math.max(0, Math.floor((W - textWidth(line)) / 2)))
      if (top + i < H) lines[top + i] = left + line
    })
    return lines
  }

  function render(force = false) {
    const W = process.stdout.columns || 80
    const H = process.stdout.rows || 24
    const frame = state.splash ? splashFrame(W, H) : renderFrame(state, renderEnv(), W, H)
    const sizeKey = `${W}x${H}`
    let out = `${ESC}[?2026h`
    if (force || sizeKey !== prevSize) {
      out += `${ESC}[2J`
      frame.forEach((line, i) => { out += `${ESC}[${i + 1};1H${line}` })
      prevFrame = frame
    } else {
      for (const { row, text } of diffRows(prevFrame, frame)) out += `${ESC}[${row + 1};1H${text}${ESC}[K`
      if (frame.length) prevFrame = frame
    }
    out += `${ESC}[?2026l`
    process.stdout.write(out)
    prevSize = sizeKey
    dirty = false
  }

  const cleanup = () => {
    try { process.stdout.write(`${ESC}[?1000l${ESC}[?1006l${ESC}[?25h${ESC}[?1049l`) } catch { /* nada */ }
    try { process.stdin.setRawMode(false) } catch { /* sin TTY */ }
  }

  function doQuit() {
    try { bot.proc?.kill('SIGINT') } catch { /* nada */ }
    cleanup()
    console.log('🌊 ¡Nos vemos! El océano te cuide. 💧')
    process.exit(0)
  }

  function quitRequest() {
    if (bot.running) {
      openConfirm({
        title: '⏻ Salir de la terminal',
        body: 'El bot está corriendo en la consola.\nSi sales, el proceso se detiene.',
        okLabel: 'Salir y detener',
        run: doQuit
      })
    } else doQuit()
  }

  /* ---------------------------------------------------------------- teclas */

  function submitInput() {
    const input = state.input
    if (!input) return
    if (input.kind === 'pair') {
      const digits = state.buffer.replace(/\D/g, '')
      if (digits && (digits.length < 8 || digits.length > 15)) {
        state.fieldError = 'El teléfono debe tener entre 8 y 15 dígitos con código de país.'
        return
      }
      state.overlay = null
      state.input = null
      spawnConsole('Vincular · pairing code', [path.join(ROOT, 'scripts', 'boot.js'), '--pair', ...(digits ? ['--phone', digits] : [])])
    } else if (input.kind === 'field') {
      try {
        saveField(input.field, state.buffer)
        state.overlay = null
        state.input = null
        state.mode = 'config'
      } catch (error) {
        state.fieldError = error.message
      }
    }
    dirty = true
  }

  function jumpMatch(direction) {
    const { lines, matches } = viewerLines(state.viewer)
    if (!matches.length) return
    const current = state.viewer.scroll
    let target
    if (direction > 0) target = matches.find((index) => index > current) ?? matches[0]
    else target = [...matches].reverse().find((index) => index < current) ?? matches[matches.length - 1]
    state.viewer.scroll = Math.min(target, Math.max(0, lines.length - 1))
  }

  function scrollViewer(delta) {
    const { lines } = viewerLines(state.viewer)
    const maxScroll = Math.max(0, lines.length - 3)
    state.viewer.scroll = Math.min(maxScroll, Math.max(0, state.viewer.scroll + delta))
  }

  function scrollConsole(delta) {
    const all = bot.buffer.view()
    const maxStart = Math.max(0, all.length - 5)
    if (delta > 0 && state.botScroll + delta >= maxStart) {
      state.follow = true
      state.botScroll = maxStart
    } else {
      state.follow = false
      state.botScroll = Math.min(maxStart, Math.max(0, state.botScroll + delta))
    }
  }

  async function handleKey(key) {
    try {
      if (state.splash) { state.splash = false; dirty = true; return }
      if (key.name === 'mouse') return handleMouse(key)
      if (key.name === 'ctrl-c') {
        if (!state.overlay && state.mode === 'console' && bot.running && !state.consoleInput) { stopBot(); return }
        return quitRequest()
      }
      if (state.toast && state.overlay !== 'input') state.toast = ''

      /* overlays primero */
      if (state.overlay === 'palette') {
        const list = paletteList(state, renderEnv())
        if (key.name === 'escape' || key.name === 'ctrl-p') { state.overlay = null; state.palette.query = '' }
        else if (key.name === 'up' || key.name === 'ctrl-k') state.palette.sel = Math.max(0, state.palette.sel - 1)
        else if (key.name === 'down') state.palette.sel = Math.min(Math.max(0, list.length - 1), state.palette.sel + 1)
        else if (key.name === 'backspace') { state.palette.query = state.palette.query.slice(0, -1); state.palette.sel = 0 }
        else if (key.name === 'enter') {
          const action = list[state.palette.sel]
          state.overlay = null
          state.palette.query = ''
          state.palette.sel = 0
          if (action) await action.run()
        } else if (key.name === 'char' && key.char >= ' ') { state.palette.query += key.char; state.palette.sel = 0 }
        dirty = true
        return
      }
      if (state.overlay === 'input') {
        if (key.name === 'escape') { state.overlay = null; state.input = null }
        else if (key.name === 'backspace') state.buffer = state.buffer.slice(0, -1)
        else if (key.name === 'ctrl-u') state.buffer = ''
        else if (key.name === 'enter') submitInput()
        else if (key.name === 'char' && key.char >= ' ') state.buffer += key.char
        dirty = true
        return
      }
      if (state.overlay === 'confirm') {
        if (key.name === 'left' || key.name === 'right' || key.name === 'tab' || key.char === 'h' || key.char === 'l') state.confirmSel = state.confirmSel === 0 ? 1 : 0
        else if (key.name === 'escape') { state.overlay = null; state.confirm = null }
        else if (key.name === 'enter') {
          const run = state.confirmSel === 1 ? state.confirm?.run : null
          state.overlay = null
          state.confirm = null
          if (run) run()
        }
        dirty = true
        return
      }
      if (state.overlay === 'help') {
        if (key.name === 'escape' || key.name === 'enter' || key.char === 'q' || key.char === '?') state.overlay = null
        dirty = true
        return
      }

      /* atajos globales */
      if (key.name === 'ctrl-p' || key.name === 'ctrl-k') { state.overlay = 'palette'; state.palette.query = ''; state.palette.sel = 0; dirty = true; return }
      if (key.char === '?') { state.overlay = 'help'; dirty = true; return }

      /* tecla líder estilo OpenCode: ctrl+x y después una letra */
      if (state.leader) {
        state.leader = false
        const map = { c: 'console', p: 'pair', q: 'qr', s: 'status', e: 'config', m: 'menu', k: 'commands', g: 'session', d: 'doctor', v: 'verify', u: 'update', t: 'theme', h: 'help', x: 'exit' }
        const id = map[key.char || '']
        if (id) await activateSection(id)
        dirty = true
        return
      }
      if (key.name === 'ctrl-x' && !(state.mode === 'console' && state.consoleInput)) { state.leader = true; dirty = true; return }

      if (state.mode === 'menu') {
        const list = homeList(state)
        const count = list.length
        if (key.name === 'up') state.sel = (state.sel + count - 1) % Math.max(1, count)
        else if (key.name === 'down') state.sel = (state.sel + 1) % Math.max(1, count)
        else if (key.name === 'home') state.sel = 0
        else if (key.name === 'end') state.sel = count - 1
        else if (key.name === 'pageup') state.sel = Math.max(0, state.sel - 5)
        else if (key.name === 'pagedown') state.sel = Math.min(count - 1, state.sel + 5)
        else if (key.name === 'enter') { if (list[state.sel]) await activateSection(list[state.sel].id) }
        else if (key.name === 'backspace') { state.homeQuery = state.homeQuery.slice(0, -1); state.sel = 0 }
        else if (key.name === 'escape') state.homeQuery = ''
        else if (key.name === 'char' && key.char >= ' ') {
          if (!state.homeQuery && key.char === 'q') return quitRequest()
          if (!state.homeQuery && key.char === 't') cycleTheme()
          else if (!state.homeQuery && key.char === '/') { state.overlay = 'palette'; state.palette.query = '' }
          else { state.homeQuery += key.char; state.sel = 0 }
        }
      } else if (state.mode === 'console') {
        if (state.consoleInput) {
          if (key.name === 'escape') state.consoleInput = false
          else if (key.name === 'backspace') state.consoleBuffer = state.consoleBuffer.slice(0, -1)
          else if (key.name === 'ctrl-u') state.consoleBuffer = ''
          else if (key.name === 'enter') {
            const line = state.consoleBuffer
            state.consoleBuffer = ''
            if (bot.proc?.stdin?.writable) {
              bot.proc.stdin.write(`${line}\n`)
              bot.buffer.push(`› ${line}\n`)
            }
          } else if (key.name === 'char' && key.char >= ' ') state.consoleBuffer += key.char
        } else if (key.name === 'up' || key.char === 'k') scrollConsole(-1)
        else if (key.name === 'down' || key.char === 'j') scrollConsole(1)
        else if (key.name === 'pageup') scrollConsole(-10)
        else if (key.name === 'pagedown') scrollConsole(10)
        else if (key.char === 'G' || key.name === 'end') { state.follow = true }
        else if (key.char === 'g' || key.name === 'home') { state.follow = false; state.botScroll = 0 }
        else if (key.char === 'i' && bot.running) state.consoleInput = true
        else if (key.char === 'r' && bot.argv) spawnConsole(bot.title, bot.argv, bot.cmd)
        else if (key.char === 'x') stopBot()
        else if (key.char === 'c') { bot.buffer.clear(); state.toast = '🧹 Consola limpia' }
        else if (key.name === 'escape' || key.char === 'q') state.mode = 'menu'
      } else if (state.mode === 'config') {
        const fields = editFields(env.config)
        if (key.name === 'up' || key.char === 'k') state.configSel = (state.configSel + fields.length - 1) % fields.length
        else if (key.name === 'down' || key.char === 'j') state.configSel = (state.configSel + 1) % fields.length
        else if (key.name === 'home' || key.char === 'g') state.configSel = 0
        else if (key.name === 'end' || key.char === 'G') state.configSel = fields.length - 1
        else if (key.name === 'escape' || key.char === 'q') state.mode = 'menu'
        else if (key.name === 'enter') {
          const field = fields[state.configSel]
          if (field.cycle) {
            const next = field.cycle[(field.cycle.indexOf(field.raw) + 1) % field.cycle.length]
            try { saveField(field, next) } catch (error) { state.fieldError = error.message; setTimeout(() => { state.fieldError = ''; dirty = true }, 2600).unref?.() }
          } else {
            state.fieldError = ''
            openInput({ kind: 'field', field, title: `✏️ ${field.label}`, hint: field.hint || field.about || '', initial: field.raw })
          }
        }
      } else if (state.mode === 'session') {
        const count = SESSION_ACTIONS.length
        if (key.name === 'up' || key.char === 'k') state.sessionSel = (state.sessionSel + count - 1) % count
        else if (key.name === 'down' || key.char === 'j') state.sessionSel = (state.sessionSel + 1) % count
        else if (key.name === 'escape' || key.char === 'q') state.mode = 'menu'
        else if (key.name === 'enter') {
          const action = SESSION_ACTIONS[state.sessionSel]
          if (action.id === 'backup') createBackup()
          else if (action.id === 'delete') {
            if (bot.running) state.toast = '⚠️ Detén el bot antes de borrar la sesión'
            else openConfirm({ title: '🗑️ Borrar la sesión de WhatsApp', body: 'Tendrás que vincular de nuevo con\npairing code o QR. ¿Seguro?', okLabel: 'Borrar sesión', run: deleteSession })
          } else state.mode = 'menu'
        }
      } else if (state.mode === 'viewer') {
        const viewer = state.viewer
        if (viewer.searching) {
          if (key.name === 'escape' || key.name === 'enter') viewer.searching = false
          else if (key.name === 'backspace') { viewer.query = viewer.query.slice(0, -1); viewer.scroll = 0 }
          else if (key.name === 'up') scrollViewer(-1)
          else if (key.name === 'down') scrollViewer(1)
          else if (key.name === 'char' && key.char >= ' ') { viewer.query += key.char; viewer.scroll = 0 }
        } else if (viewer.filterable && key.name === 'char' && key.char >= ' ' && key.char !== 'q') {
          viewer.query += key.char
          viewer.scroll = 0
        } else if (viewer.filterable && key.name === 'backspace' && viewer.query) {
          viewer.query = viewer.query.slice(0, -1)
          viewer.scroll = 0
        } else if (key.name === 'up' || key.char === 'k') scrollViewer(-1)
        else if (key.name === 'down' || key.char === 'j') scrollViewer(1)
        else if (key.name === 'pageup') scrollViewer(-10)
        else if (key.name === 'pagedown') scrollViewer(10)
        else if (key.name === 'home' || key.char === 'g') viewer.scroll = 0
        else if (key.name === 'end' || key.char === 'G') viewer.scroll = Number.MAX_SAFE_INTEGER
        else if (key.char === '/' && !viewer.filterable) viewer.searching = true
        else if (key.char === 'n') jumpMatch(1)
        else if (key.char === 'N') jumpMatch(-1)
        else if (key.char === 'r' && viewer.kind === 'status') { refreshEnv(); viewer.lines = dashboard(); state.toast = '🌊 Estado refrescado' }
        else if (key.name === 'escape' || key.name === 'enter' || key.char === 'q') {
          if (viewer.filterable && viewer.query) { viewer.query = ''; viewer.scroll = 0 } else state.mode = 'menu'
        }
      }
      dirty = true
    } catch (error) {
      state.toast = `✖ ${error.message}`
      dirty = true
    }
  }

  function handleMouse(key) {
    if (state.splash) { state.splash = false; dirty = true; return }
    if (key.release) return
    if (key.button === 64 || key.button === 65) {
      const delta = key.button === 64 ? -3 : 3
      if (state.mode === 'viewer') scrollViewer(delta)
      else if (state.mode === 'console') scrollConsole(delta)
      else if (state.mode === 'config') state.configSel = Math.min(editFields(env.config).length - 1, Math.max(0, state.configSel + delta))
      else if (state.mode === 'menu') state.sel = Math.min(MENU_ITEMS.length - 1, Math.max(0, state.sel + delta))
      dirty = true
      return
    }
    if (key.button !== 0) return
    const hit = state.hit[key.y - 1]
    if (!hit) return
    const hits = Array.isArray(hit) ? hit : [hit]
    const found = hits.find((entry) => key.x - 1 >= (entry.x1 ?? 0) && key.x - 1 <= (entry.x2 ?? 9999)) || hits[0]
    if (!found) return

    if (found.kind === 'confirm-btn') {
      state.confirmSel = found.which
      if (found.which === 1) {
        const run = state.confirm?.run
        state.overlay = null
        state.confirm = null
        if (run) run()
      } else { state.overlay = null; state.confirm = null }
      dirty = true
      return
    }

    const nowMs = Date.now()
    const isDouble = nowMs - lastClick.at < 400 && lastClick.row === key.y - 1 && lastClick.kind === found.kind && lastClick.index === found.index
    lastClick = { at: nowMs, row: key.y - 1, kind: found.kind, index: found.index }

    if (found.kind === 'section') {
      state.sel = found.index
      if (isDouble) void activateSection(found.itemId || MENU_ITEMS[found.index]?.id)
    } else if (found.kind === 'field') {
      state.configSel = found.index
      if (isDouble) {
        const field = editFields(env.config)[found.index]
        if (field && !field.cycle) openInput({ kind: 'field', field, title: `✏️ ${field.label}`, hint: field.hint || field.about || '', initial: field.raw })
        else if (field) {
          const next = field.cycle[(field.cycle.indexOf(field.raw) + 1) % field.cycle.length]
          try { saveField(field, next) } catch (error) { state.toast = `✖ ${error.message}` }
        }
      }
    } else if (found.kind === 'session-action') {
      state.sessionSel = found.index
      if (isDouble) {
        const action = SESSION_ACTIONS[found.index]
        if (action.id === 'backup') createBackup()
        else if (action.id === 'delete' && !bot.running) openConfirm({ title: '🗑️ Borrar la sesión de WhatsApp', body: 'Tendrás que vincular de nuevo con\npairing code o QR. ¿Seguro?', okLabel: 'Borrar sesión', run: deleteSession })
        else if (action.id === 'back') state.mode = 'menu'
      }
    } else if (found.kind === 'palette') {
      const list = paletteList(state, renderEnv())
      state.palette.sel = found.index
      if (isDouble && list[found.index]) {
        const action = list[found.index]
        state.overlay = null
        state.palette.query = ''
        void action.run()
      }
    }
    dirty = true
  }

  /* --------------------------------------------------------------- arranque */

  process.stdout.write(`${ESC}[?1049h${ESC}[?1000h${ESC}[?1006h${ESC}[?25l`)
  process.on('exit', cleanup)
  process.on('SIGTERM', doQuit)
  process.stdout.on('resize', () => render(true))
  process.stdin.setEncoding('utf8')
  try { process.stdin.setRawMode(true) } catch { /* sin TTY */ }
  process.stdin.resume()
  process.stdin.on('data', (chunk) => {
    const text = String(chunk)
    if (text.includes(`${ESC}[200~`)) {
      const clean = text.replaceAll(`${ESC}[200~`, '').replaceAll(`${ESC}[201~`, '').replace(/[\r\n]+/g, ' ')
      for (const key of parseKeys(clean)) void handleKey(key)
      return
    }
    for (const key of parseKeys(text)) void handleKey(key)
  })

  render(true)
  const timer = setInterval(() => {
    state.tick += 1
    if (state.splash && Date.now() - startedAt > 900) { state.splash = false; dirty = true }
    if (state.mode === 'viewer' && state.viewer.kind === 'status' && state.tick % 16 === 0) {
      refreshEnv()
      state.viewer.lines = dashboard()
      dirty = true
    }
    if (dirty || bot.running || state.mode === 'console' || state.tick % 8 === 0) render()
  }, 120)
  timer.unref?.()
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  main().catch((error) => {
    try { process.stdout.write(`${ESC}[?1000l${ESC}[?1006l${ESC}[?25h${ESC}[?1049l`) } catch { /* nada */ }
    console.error(`❌ ${error.message}`)
    process.exit(1)
  })
}
