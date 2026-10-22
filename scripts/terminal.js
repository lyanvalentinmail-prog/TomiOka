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
  opencode: { id: 'opencode', name: 'OpenCode', a: [250, 178, 131], b: [92, 156, 245], sel: [250, 178, 131], bg: [10, 10, 10], panel: [20, 20, 20], element: [30, 30, 30], text: [238, 238, 238], muted: [128, 128, 128], border: [72, 72, 72] },
  ocean: { id: 'ocean', name: 'Océano', a: [56, 189, 248], b: [37, 99, 235], sel: [2, 132, 199], bg: [7, 16, 24] },
  sunset: { id: 'sunset', name: 'Atardecer', a: [251, 191, 36], b: [219, 39, 119], sel: [190, 24, 93], bg: [20, 11, 6] },
  mint: { id: 'mint', name: 'Menta', a: [110, 231, 183], b: [13, 148, 136], sel: [4, 120, 87], bg: [6, 18, 13] },
  violet: { id: 'violet', name: 'Violeta', a: [196, 181, 253], b: [124, 58, 237], sel: [109, 40, 217], bg: [13, 6, 22] }
}
export const THEME_ORDER = ['opencode', 'ocean', 'sunset', 'mint', 'violet']

const fg = ([r, g, b]) => `${ESC}[38;2;${r};${g};${b}m`
const bg = ([r, g, b]) => `${ESC}[48;2;${r};${g};${b}m`
const RESET = `${ESC}[0m`

/** Pinta un texto con el color de acento del tema */
export function accent(text, theme, bold = true) {
  if (!COLOR_OK) return String(text)
  return `${bold ? `${ESC}[1m` : ''}${fg(theme.a)}${text}${RESET}`
}

/** Pinta la fila seleccionada (heredado; hoy manda ocSelected) */
export function selectedPaint(text, theme) {
  if (!COLOR_OK) return String(text)
  return `${bg(theme.a)}${ESC}[38;2;16;16;16m${ESC}[1m${text}${RESET}`
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
    { id: 'name', group: 'Bot', label: 'Nombre del bot', value: config.bot.name, raw: config.bot.name, about: 'El nombre que se ve en el menú y los mensajes' },
    { id: 'team', group: 'Bot', label: 'Team / firma', value: config.bot.team, raw: config.bot.team, about: 'La firma que acompaña al nombre del bot' },
    { id: 'prefix', group: 'Bot', label: 'Prefijo', value: config.prefixes[0], raw: config.prefixes[0], about: 'Con qué empiezan los comandos (ej: . o !)' },
    { id: 'pairingPhone', group: 'Vinculación', label: 'Teléfono pairing', value: config.pairingPhone || '(sin definir)', raw: config.pairingPhone || '', about: 'Número por defecto para el pairing code' },
    { id: 'owners', group: 'Vinculación', label: 'Owners', value: config.owner.numbers.join(', ') || '(ninguno)', raw: config.owner.numbers.join(', '), about: 'Dueños del bot, con código de país, separados por comas' },
    { id: 'login', group: 'Vinculación', label: 'Modo de login', value: config.login, raw: config.login, cycle: LOGIN_MODES, about: 'Cómo vincula si no hay sesión: ask pregunta, pairing o qr directo' },
    { id: 'packName', group: 'Stickers', label: 'Pack · nombre', value: config.stickers.packName, raw: config.stickers.packName, about: 'Nombre del pack en los stickers que crea el bot' },
    { id: 'packAuthor', group: 'Stickers', label: 'Pack · autor', value: config.stickers.packAuthor, raw: config.stickers.packAuthor, about: 'Autor del pack en los stickers que crea el bot' },
    { id: 'menuImage', group: 'Menú', label: 'Banner del menú', value: config.menu.image || '(sin banner)', raw: config.menu.image || '', hint: '"-" para quitar el banner', about: 'URL, link de Drive o ruta local de la imagen del menú' },
    { id: 'sendAsCaption', group: 'Menú', label: 'Menú como pie de foto', value: config.menu.sendAsCaption === false ? 'no' : 'sí', raw: config.menu.sendAsCaption === false ? 'no' : 'sí', cycle: ['sí', 'no'], about: 'Pega el menú a la foto del banner si entra en el límite de WhatsApp' },
    { id: 'showDescriptions', group: 'Menú', label: 'Descripciones en el menú', value: config.menu.showDescriptions ? 'sí' : 'no', raw: config.menu.showDescriptions ? 'sí' : 'no', cycle: ['sí', 'no'], about: 'Muestra la descripción junto a cada comando en .help' }
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
    confirmSel: 1,
    fieldError: '',
    scroll: 0,
    maxScroll: 0,
    viewH: 0,
    query: '',
    searching: false,
    sidebar: true,
    inputPrompt: null,
    placeholder: HOME_PLACEHOLDERS[Math.floor(Math.random() * HOME_PLACEHOLDERS.length)],
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
  '  ctrl+p            Paleta de comandos (buscar todo)',
  '  ctrl+x            Líder (tecla líder de OpenCode)',
  '  ctrl+x b          Mostrar / ocultar la sidebar',
  '  ctrl+x c          Consola del bot',
  '  ctrl+x p          Pairing code',
  '  ctrl+x r          Código QR',
  '  ctrl+x s          Estado',
  '  ctrl+x e          Editar configuración',
  '  ctrl+x m          Menú de WhatsApp',
  '  ctrl+x g          Comandos',
  '  ctrl+x l          Sesión y respaldos',
  '  ctrl+x d          Doctor',
  '  ctrl+x v          Verificar pairing',
  '  ctrl+x u          Actualizar (git pull)',
  '  ctrl+x t          Cambiar el tema',
  '  ctrl+x 1…9        Saltar a una sección',
  '  ctrl+c / ctrl+d   Salir (en consola: detener el bot)',
  '',
  '  ↑ ↓ · pgup pgdn   Mover la selección / scrollear',
  '  enter             Abrir, guardar o confirmar',
  '  esc               Volver, cerrar o cancelar',
  '  /                 Buscar en listas (n / N siguiente)',
  '  ?                 Esta ayuda',
  '  t                 Cambiar el tema',
  '  q                 Salir',
  '',
  '  En la consola del bot:',
  '  i                 Escribirle al bot (ej: el teléfono)',
  '  r                 Reiniciar el proceso',
  '  x                 Detener el proceso',
  '  c                 Limpiar la consola',
  '',
  '  Mouse: la rueda hace scroll y el clic abre filas.'
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
/*
 * Copia exacta de la TUI de OpenCode (MIT, anomalyco/opencode), medida
 * sobre su código: tema oscuro (bg #0a0a0a, panel #141414, element
 * #1e1e1e, texto #eeeeee, muted #808080, primary #fab283), logo bitono
 * con sombra, prompt de 75 cols con borde ┃, diálogos de 60/88 cols a
 * 1/4 de pantalla y sidebar de sesión de 42 cols.
 */

/** Paleta de superficies con los valores exactos del tema de OpenCode */
export function pal(theme) {
  const t = theme || THEMES.opencode
  return {
    bg: t.bg || [10, 10, 10],
    panel: t.panel || [20, 20, 20],
    element: t.element || [30, 30, 30],
    prompt: t.prompt || [18, 18, 18],
    text: t.text || [238, 238, 238],
    muted: t.muted || [128, 128, 128],
    primary: t.a,
    secondary: t.b,
    border: t.border || [72, 72, 72],
    success: [127, 216, 143],
    error: [224, 108, 117],
    warning: [245, 167, 66],
    info: [86, 182, 194]
  }
}

const rgb = (color) => `${ESC}[38;2;${color[0]};${color[1]};${color[2]}m`
const bgc = (color) => `${ESC}[48;2;${color[0]};${color[1]};${color[2]}m`
const fgText = (t, palette) => `${rgb(palette.text)}${t}${RESET}`
const fgMuted = (t, palette) => `${rgb(palette.muted)}${t}${RESET}`

/** Mezcla dos colores [r,g,b] (el tint de OpenCode, para la sombra del logo) */
export function tint(base, overlay, alpha) {
  return base.map((v, i) => Math.round(v + (overlay[i] - v) * alpha))
}

/*
 * Fuente del logo de OpenCode (4 filas: una vacía y tres de glifo).
 * _ = sombra de fondo · ^ = ▀ con sombra · ~ = ▀ en sombra · , = ▄ en sombra.
 * Izquierda «tomi» en muted, derecha «oka» en texto negrita, como open/code.
 */
const GLYPHS = {
  t: [' █  ', '▀██▀', ' ▀  '],
  o: ['█▀▀█', '█__█', '▀▀▀▀'],
  m: ['█▄_▄█', '█_▀_█', '▀___▀'],
  i: [' ▄  ', ' █  ', '▄█▄ '],
  k: ['█ ▄▀', '██  ', '█ ▀▄'],
  a: ['█▀▀█', '█^^█', '▀__▀']
}

function glyphWord(word) {
  const rows = ['', '', '']
  ;[...word].forEach((letter, li) => {
    const glyph = GLYPHS[letter] || ['    ', '    ', '    ']
    glyph.forEach((line, r) => { rows[r] += (li ? ' ' : '') + line })
  })
  return rows
}

/** Réplica del renderLine de OpenCode (sombra = tint(bg, fg, 0.25)) */
function renderGlyphLine(line, color, palette, bold) {
  const shadow = tint(palette.bg, color, 0.25)
  let out = `${rgb(color)}${bold ? `${ESC}[1m` : ''}`
  for (const char of line) {
    if (char === '_') out += `${bgc(shadow)} ${rgb(color)}${bold ? `${ESC}[1m` : ''}`
    else if (char === '^') out += `${bgc(shadow)}▀${rgb(color)}${bold ? `${ESC}[1m` : ''}`
    else if (char === '~') out += `${rgb(shadow)}▀${rgb(color)}${bold ? `${ESC}[1m` : ''}`
    else if (char === ',') out += `${rgb(shadow)}▄${rgb(color)}${bold ? `${ESC}[1m` : ''}`
    else if (char === ' ') out += `${RESET} ${rgb(color)}${bold ? `${ESC}[1m` : ''}`
    else out += char
  }
  return out + RESET
}

/** El logo como el de OpenCode: se adapta a ancho y alto igual que el suyo */
export function logoLines(theme, width = 80, height = 24) {
  const palette = pal(theme)
  if (height < 12) return []
  const left = glyphWord('tomi')
  const right = glyphWord('oka')
  if (width < 22) return right.map((line) => renderGlyphLine(line, palette.text, palette, true))
  if (width < 44) {
    return [
      ...left.map((line) => renderGlyphLine(line, palette.muted, palette, false)),
      ...right.map((line) => renderGlyphLine(line, palette.text, palette, true))
    ]
  }
  const blank = ' '.repeat(Math.max(...left.map((l) => l.length)))
  return [
    `${renderGlyphLine(blank, palette.muted, palette, false)} ${renderGlyphLine(' '.repeat(Math.max(...right.map((l) => l.length))), palette.text, palette, true)}`,
    ...left.map((line, i) => `${renderGlyphLine(line, palette.muted, palette, false)} ${renderGlyphLine(right[i], palette.text, palette, true)}`)
  ]
}

function clockOf(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}


/** Parte un texto en líneas de ancho máximo (para mensajes de diálogos) */
function wrap(text, width) {
  const out = []
  for (const raw of String(text).split('\n')) {
    let line = raw
    while (textWidth(line) > width) {
      let cut = line.lastIndexOf(' ', width)
      if (cut < 1) cut = width
      out.push(line.slice(0, cut).trimEnd())
      line = line.slice(cut).trimStart()
    }
    out.push(line)
  }
  return out
}

/** Colorea una línea de log según su contenido (como los niveles de OpenCode) */
function colorizeLogLine(line, palette) {
  const text = String(line)
  if (/^(✖|error|falló|failed)/i.test(text.trim())) return `${ESC}[38;2;224;108;117m${text}${RESET}`
  if (/código de vinculación|pairing|pairing code/i.test(text)) return `${rgb(palette.warning)}${ESC}[1m${text}${RESET}`
  if (/^(⏹|🌊|▶|✔|conectado|vinculado)/i.test(text.trim())) return `${rgb(palette.success)}${text}${RESET}`
  return `${rgb(palette.text)}${text}${RESET}`
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

/** Fila seleccionada de OpenCode: fondo primary #fab283, texto #0a0a0a negrita */
export function ocSelected(text, theme) {
  if (!COLOR_OK) return String(text)
  const palette = pal(theme)
  return `${bgc(palette.primary)}${rgb(palette.bg)}${ESC}[1m${text}${RESET}`
}

export const HOME_PLACEHOLDERS = [
  'Iniciá el bot',
  'Vinculá con pairing code',
  'Editá el nombre del bot',
  'Creá un respaldo de la sesión',
  'Mirá el menú de WhatsApp'
]

/**
 * El Prompt de OpenCode: borde izquierdo ┃ en primary, fondo prompt,
 * paddingTop 1, fila de metadata (agente · modelo · proveedor) y la
 * sombra ▀ inferior con el ╹ en el borde.
 */
function promptBox({ theme, width, input, meta, narrow = false }) {
  const palette = pal(theme)
  const bw = Math.max(20, width)
  const padIn = narrow ? 1 : 2
  const innerW = bw - 1
  const row = (content) => `${rgb(palette.primary)}┃${bgc(palette.prompt)}${pad(content, innerW)}${RESET}`
  const lines = [
    row(''),
    row(`${' '.repeat(padIn)}${input}`),
    row(''),
    row(`${' '.repeat(padIn)}${meta}`)
  ]
  lines.push(`${rgb(palette.primary)}╹${rgb(palette.prompt)}${'▀'.repeat(Math.max(0, bw - 1))}${RESET}`)
  return lines
}

function inputContent(text, palette, placeholder) {
  const cursor = COLOR_OK ? `${bgc(palette.text)}${rgb(palette.prompt)} ${bgc(palette.prompt)}` : '█'
  if (text) return `${rgb(palette.text)}${text}${cursor}`
  return `${cursor}${rgb(palette.muted)}${placeholder || ''}`
}

function metaContent({ theme, agent, model, provider, showAgent = true }) {
  const palette = pal(theme)
  const parts = []
  if (showAgent && agent) parts.push(`${rgb(palette.primary)}${agent}${bgc(palette.prompt)}`)
  if (model) {
    if (parts.length) parts.push(`${rgb(palette.muted)}·${bgc(palette.prompt)}`)
    parts.push(`${rgb(palette.text)}${model}${bgc(palette.prompt)}`)
  }
  if (provider) parts.push(`${rgb(palette.muted)}${provider}${bgc(palette.prompt)}`)
  return parts.join(' ')
}

/** Fila footer bajo el prompt: ubicación/estado a la izquierda, atajos a la derecha */
function promptFooter({ theme, width, left, showShortcuts = true }) {
  const palette = pal(theme)
  const right = showShortcuts
    ? `${rgb(palette.text)}ctrl+p${RESET} ${rgb(palette.muted)}commands${RESET}  ${rgb(palette.text)}ctrl+x${RESET} ${rgb(palette.muted)}leader${RESET}`
    : ''
  const gap = Math.max(1, width - textWidth(left) - textWidth(right))
  return `${left}${' '.repeat(gap)}${right}`
}

/**
 * Arma la pantalla completa (array de líneas con ANSI).
 * Casi pura: solo anota en state.hit las filas clicables para el mouse.
 */
export function renderFrame(state, env, width = 80, height = 24) {
  const W = Math.max(30, width)
  const H = Math.max(10, height)
  const theme = env.theme || THEMES.opencode
  const palette = pal(theme)
  const linked = Boolean(env.session?.registered)
  state.hit = {}

  const showFooter = state.mode === 'menu' && !state.overlay
  const footer = []
  if (showFooter) {
    if (H >= 16) footer.push('')
    const dot = linked ? rgb(palette.success) : rgb(palette.error)
    const leftFoot = `  ${dot}⊙${RESET} ${linked ? fgText(String(env.session.me || 'vinculado').split('@')[0], palette) : fgMuted('sin sesión', palette)}${env.bot?.running ? `  ${rgb(palette.success)}⏺${RESET} ${fgMuted('bot en consola', palette)}` : ''}`
    const rightFoot = fgMuted(env.config?.bot?.version || '1.0', palette)
    footer.push(`${leftFoot}${' '.repeat(Math.max(1, W - 2 - textWidth(leftFoot) - textWidth(rightFoot)))}${rightFoot}  `)
    if (H >= 16) footer.push('')
  }

  const bodyH = Math.max(3, H - footer.length)
  let body = renderMain(state, env, W, bodyH, 0)
  if (state.overlay) body = renderOverlay(state, env, W, bodyH, 0, body)

  const frame = [...body.slice(0, bodyH), ...footer]
  while (frame.length < H) frame.splice(frame.length - footer.length, 0, '')

  if (state.toast) {
    const idx = H - footer.length - 1
    if (idx >= 0 && idx < frame.length) {
      const toastText = ` ${state.toast} `
      const toast = COLOR_OK ? `${bgc(palette.element)}${rgb(palette.text)}${toastText}${RESET}` : toastText
      frame[idx] = `${' '.repeat(Math.max(0, W - textWidth(toastText) - 1))}${toast}`
    }
  }
  return frame.slice(0, H).map((line) => clip(line, W))
}

function renderMain(state, env, W, bodyH, bodyTop) {
  if (state.mode === 'console') return renderConsole(state, env, W, bodyH, bodyTop)
  if (state.mode === 'config') return renderConfig(state, env, W, bodyH, bodyTop, 0)
  if (state.mode === 'session') return renderSession(state, env, W, bodyH, bodyTop, 0)
  if (state.mode === 'viewer') return renderViewer(state, env, W, bodyH)
  return renderHome(state, env, W, bodyH, bodyTop)
}

function renderHome(state, env, W, bodyH, bodyTop) {
  const theme = env.theme || THEMES.opencode
  const palette = pal(theme)
  const { config, session } = env
  const list = homeList(state)
  state.sel = Math.min(state.sel, Math.max(0, list.length - 1))

  const padX = W < 44 ? 1 : 2
  const bw = Math.max(28, Math.min(75, W - padX * 2))
  const left = padX + Math.floor((W - padX * 2 - bw) / 2)
  const padL = ' '.repeat(left)

  const logo = logoLines(theme, W, bodyH + 4)
  const logoW = logo.length ? Math.max(...logo.map((line) => textWidth(line))) : 0
  const logoLeft = ' '.repeat(Math.max(0, Math.floor((W - logoW) / 2)))

  const querying = Boolean(state.homeQuery)
  const listRows = querying ? Math.min(8, Math.max(list.length, 1)) : 0
  const promptRows = 6 // 4 de la caja + sombra + footer del prompt
  const fixed = logo.length + 1 + listRows + promptRows
  const room = bodyH - fixed - 3
  const top = room > 0 ? 3 + Math.floor(room / 2) : 0
  const rows = Array.from({ length: top }, () => '')
  for (const line of logo) rows.push(logoLeft + line)
  if (logo.length) rows.push('')

  if (querying) {
    const listTop = bodyTop + rows.length
    if (!list.length) rows.push(padL + fgMuted(`Sin resultados para «${clip(state.homeQuery, 30)}»`, palette))
    const start = windowStart(state.sel, list.length, 8)
    for (let i = 0; i < Math.min(8, list.length); i += 1) {
      const index = start + i
      const item = list[index]
      if (!item) break
      const running = item.id === 'console' && env.bot?.running ? ' ⏺' : ''
      const text = `${item.icon} ${item.label}${running}`
      const hint = clip(item.hint || '', Math.max(8, bw - textWidth(text) - 14))
      const line = index === state.sel
        ? ocSelected(pad(` ${text}`, bw), theme)
        : `${fgText(` ${text}`, palette)} ${fgMuted(hint, palette)}`
      state.hit[listTop + i] = { kind: 'section', index, itemId: item.id, x1: left, x2: left + bw }
      rows.push(padL + line)
    }
  }

  const meta = metaContent({
    theme,
    agent: clip(config.bot.name, 24),
    model: 'WhatsApp',
    provider: session?.registered ? `sesión ${String(session.me || '').split('@')[0]}` : 'sin sesión',
    showAgent: W >= 44
  })
  const box = promptBox({
    theme,
    width: bw,
    narrow: W < 44,
    input: inputContent(state.homeQuery, palette, state.placeholder || HOME_PLACEHOLDERS[0]),
    meta
  })
  for (const line of box.slice(0, 4)) rows.push(padL + line)
  rows.push(padL + box[4])

  const location = ROOT.replace(/^.*\/home\/[^/]+/, '~')
  rows.push(padL + promptFooter({
    theme,
    width: bw,
    left: fgMuted(clip(location, Math.max(10, bw - 30)), palette),
    showShortcuts: W >= 64
  }))
  return rows.slice(0, bodyH)
}

function renderConsole(state, env, W, bodyH, bodyTop) {
  const theme = env.theme || THEMES.opencode
  const palette = pal(theme)
  const bufLines = env.bot?.lines || []
  const { config, session } = env
  const running = Boolean(env.bot?.running)

  const sideOn = state.sidebar && W >= 110
  const sideW = sideOn ? 42 : 0
  const mainW = W - sideW
  const viewH = bodyH - 6
  state.viewH = viewH

  const entries = bufLines
  const total = entries.length
  state.maxScroll = Math.max(0, total - viewH)
  state.scroll = Math.min(state.scroll, state.maxScroll)
  const end = total - state.scroll
  const start = Math.max(0, end - viewH)

  const rows = []
  for (let i = start; i < end; i += 1) {
    const entry = entries[i]
    const plain = String(entry)
    const colored = COLOR_OK ? colorizeLogLine(plain, palette) : plain
    rows.push(`  ${colored}`)
  }
  while (rows.length < viewH) rows.push('')

  const cmdText = state.consoleInput ? state.consoleBuffer : ''
  const cbox = promptBox({
    theme, width: mainW, narrow: W < 44,
    input: inputContent(cmdText, palette, state.consoleInput ? 'escribí un comando y Enter… (` sale)' : 'tocá i para escribir…'),
    meta: metaContent({ theme, agent: clip(config.bot.name, 24), model: 'WhatsApp', provider: running ? 'corriendo' : 'detenido', showAgent: W >= 44 })
  })
  rows.push(cbox[0], cbox[1], cbox[2], cbox[3], cbox[4])
  const spinner = running ? `${rgb(palette.primary)}${SPINNER[state.tick % SPINNER.length]}${RESET} ` : ''
  const left = running
    ? `${spinner}${fgText('ejecutando', palette)}${fgMuted('…', palette)}`
    : fgMuted(clip(config.sessionDir || 'sessions', Math.max(12, mainW - 30)), palette)
  rows.push(promptFooter({ theme, width: mainW, left, showShortcuts: W >= 64 }))

  if (!sideOn) return rows.slice(0, bodyH)

  // Sidebar de sesión de OpenCode: 42 cols, fondo #141414, padding 1 2
  const side = (() => {
    const lines = []
    const put = (content) => lines.push(`${bgc(palette.panel)}  ${pad(content, sideW - 4)}${RESET}`)
    const title = clip(env.bot?.title || config.bot.title || config.bot.name, sideW - 6)
    put(`${rgb(palette.text)}${ESC}[1m${title}${RESET}${bgc(palette.panel)}`)
    put('')
    put(`${rgb(palette.text)}${ESC}[1mContexto${RESET}${bgc(palette.panel)}`)
    put(fgMuted(`Sesión ${session?.registered ? 'activa' : 'sin sesión'}`, palette) + bgc(palette.panel))
    if (session?.me) put(fgMuted(`Número ${String(session.me).split('@')[0]}`, palette) + bgc(palette.panel))
    put(fgMuted(`Prefijo ${config.bot.prefix}`, palette) + bgc(palette.panel))
    put(fgMuted(`Líneas ${total}`, palette) + bgc(palette.panel))
    put('')
    put(`${rgb(palette.text)}${ESC}[1mBot${RESET}${bgc(palette.panel)}`)
    put(fgMuted(`${running ? '● corriendo' : '○ detenido'} · reloj ${clockOf(new Date(env.now ?? Date.now()))}`, palette) + bgc(palette.panel))
    put(fgMuted(`Tema ${theme.name}`, palette) + bgc(palette.panel))
    put('')
    put(`${rgb(palette.text)}${ESC}[1mAtajos${RESET}${bgc(palette.panel)}`)
    for (const hint of ['i escribir', 'r reiniciar', 'x detener', 'g comandos', 'ctrl+x b sidebar']) {
      put(fgMuted(hint, palette) + bgc(palette.panel))
    }
    while (lines.length < bodyH - 2) lines.push(`${bgc(palette.panel)}${' '.repeat(sideW)}${RESET}`)
    lines.push(`${bgc(palette.panel)}  ${fgMuted(config.bot.version || '1.0', palette)}${bgc(palette.panel)}${' '.repeat(Math.max(0, sideW - 3 - textWidth(config.bot.version || '1.0')))}${RESET}`)
    return lines
  })()

  return rows.slice(0, bodyH).map((line, i) => {
    const main = pad(line, mainW)
    return `${main}${side[i] || `${bgc(palette.panel)}${' '.repeat(sideW)}${RESET}`}`
  })
}

function renderConfig(state, env, W, bodyH, bodyTop, x0) {
  const theme = env.theme || THEMES.opencode
  const palette = pal(theme)
  const fields = editFields(env.config)
  state.sel = Math.min(state.sel, fields.length - 1)
  const rows = ['', `   ${rgb(palette.text)}${ESC}[1mEditar configuración${RESET}`, '']
  const listTop = bodyTop + rows.length

  let lastGroup = ''
  let rowCursor = 0
  const visible = fields.slice(0, bodyH - 6)
  for (let index = 0; index < visible.length; index += 1) {
    const field = visible[index]
    if (field.group && field.group !== lastGroup) {
      lastGroup = field.group
      if (index > 0) rows.push('')
      rows.push(`   ${fgMuted(field.group, palette)}`)
      rowCursor = rows.length - 1 - listTop
    }
    const value = clip(String(field.value), 26).padEnd(27)
    const text = pad(` ${field.label} `, 23) + value
    const content = index === state.sel ? ocSelected(pad(text, W - 6), theme) : `${fgText(text, palette)} ${fgMuted(field.hint || '', palette)}`
    state.hit[bodyTop + rows.length] = { kind: 'field', index, x1: x0, x2: x0 + W }
    rows.push(`   ${content}`)
    rowCursor += 1
  }

  const error = env.edit?.error
  const detail = error
    ? `${ESC}[38;2;224;108;117m${clip(error, W - 6)}${RESET}`
    : fgMuted('Enter edita · e edita el JSON · Esc vuelve', palette)
  rows.push('', `   ${detail}`)
  return rows.slice(0, bodyH)
}

function renderSession(state, env, W, bodyH, bodyTop, x0) {
  const theme = env.theme || THEMES.opencode
  const palette = pal(theme)
  const info = describeSession(env.session)
  const actions = backupActions(env.session)
  state.sel = Math.min(state.sel, actions.length - 1)
  const lines = String(info.text || info).split('\n')
  const rows = ['', `   ${rgb(palette.text)}${ESC}[1mSesión y respaldos${RESET}`, '']
  for (const line of lines.slice(0, bodyH - actions.length - 8)) {
    rows.push(`   ${fgMuted(clip(line, W - 6), palette)}`)
  }
  rows.push('')
  const listTop = bodyTop + rows.length
  actions.forEach((action, index) => {
    const text = ` ${action.label} — ${action.hint}`
    const content = index === state.sel ? ocSelected(pad(text, Math.min(64, W - 6)), theme) : `${fgText(text, palette)}`
    state.hit[listTop + index] = { kind: 'session-action', index, actionId: action.id, x1: x0, x2: x0 + W }
    rows.push(`   ${content}`)
  })
  rows.push('', `   ${fgMuted('Enter ejecuta · Esc vuelve', palette)}`)
  return rows.slice(0, bodyH)
}

function renderViewer(state, env, W, bodyH) {
  const theme = env.theme || THEMES.opencode
  const palette = pal(theme)
  const view = env.view || { title: '', lines: [] }
  const rows = ['', `  ${rgb(palette.text)}${ESC}[1m${clip(view.title, W - 4)}${RESET}`]
  if (view.error) rows.push(`  ${ESC}[38;2;224;108;117m${clip(view.error, W - 4)}${RESET}`)
  if (state.searching) {
    rows.push(`  ${COLOR_OK ? `${bgc(palette.element)}${rgb(palette.primary)}` : '> '}${state.query} ${COLOR_OK ? bgc(palette.element) + ' ' + RESET : ''}`)
  } else if (state.query) {
    const count = countMatches(view.lines, state.query)
    rows.push(`  ${fgMuted(`«${clip(state.query, 30)}» · ${count} coincidencia${count === 1 ? '' : 's'}`, palette)}`)
  }
  const viewH = bodyH - rows.length - 1
  state.viewH = viewH
  state.maxScroll = Math.max(0, view.lines.length - viewH)
  state.scroll = Math.min(state.scroll, state.maxScroll)
  let shown = view.lines.slice(state.scroll, state.scroll + viewH)
  if (state.query) shown = shown.map((line) => highlightMatches(line, palette))
  for (const line of shown) rows.push(`  ${rgb(palette.text)}${line}${RESET}`)
  while (rows.length < bodyH) rows.push('')
  rows.push(`  ${fgMuted('Ctrl+X líder · / buscar · n/N siguiente · ↑↓ PgUp/PgDn navegar · Esc vuelve', palette)}`)
  return rows.slice(0, bodyH)
}

/** Copia los diálogos de OpenCode: fondo #141414 sin borde, top = ¼ del alto */
function renderOverlay(state, env, W, bodyH, bodyTop, baseLines) {
  const theme = env.theme || THEMES.opencode
  const palette = pal(theme)
  const dimmed = baseLines.slice(0, bodyH).map((line) => `${ESC}[2m${line}${RESET}`)
  while (dimmed.length < bodyH) dimmed.push('')
  const dialogBg = palette.panel

  if (state.overlay === 'confirm') {
    const boxW = Math.min(60, W - 4)
    const left = Math.floor((W - boxW) / 2)
    const top = bodyTop + Math.max(1, Math.floor(bodyH / 4))
    const title = state.confirm?.title || 'Confirmar'
    const message = state.confirm?.message || ''
    const lines = []
    lines.push('')
    lines.push(`   ${rgb(palette.text)}${ESC}[1m${clip(title, boxW - 10)}${RESET}${bgc(dialogBg)}${' '.repeat(Math.max(1, boxW - 3 - textWidth(title) - 3))}${fgMuted('esc', palette)}${bgc(dialogBg)}   `)
    lines.push('')
    for (const line of wrap(message, boxW - 6).slice(0, 4)) lines.push(`   ${fgMuted(line, palette)}${bgc(dialogBg)}`)
    lines.push('')
    const cancelLabel = state.confirm?.cancelLabel || 'Cancelar'
    const okLabel = state.confirm?.okLabel || 'Confirmar'
    const toTitle = (s) => s.charAt(0).toUpperCase() + s.slice(1)
    const cancelBox = ` ${toTitle(cancelLabel)} `
    const okBox = ` ${toTitle(okLabel)} `
    const buttonsW = cancelBox.length + okBox.length
    const btnRow = top + lines.length
    const cancel = state.confirmSel === 0 ? ocSelected(cancelBox, theme) : `${bgc(dialogBg)}${rgb(palette.muted)}${cancelBox}${RESET}`
    const ok = state.confirmSel === 1 ? ocSelected(okBox, theme) : `${bgc(dialogBg)}${rgb(palette.muted)}${okBox}${RESET}`
    lines.push(`${' '.repeat(Math.max(3, boxW - 3 - buttonsW))}${cancel}${bgc(dialogBg)}${ok}`)
    state.hit[btnRow] = {
      kind: 'confirm-btn',
      x1: left + boxW - 3 - buttonsW, x2: left + boxW - 3 - cancelBox.length,
      x3: left + boxW - 3 - cancelBox.length, x4: left + boxW - 3
    }
    lines.push('')
    const full = lines.map((line) => {
      const stripped = String(line).replace(/ +$/, '')
      return `${bgc(dialogBg)}${stripped}${bgc(dialogBg)}${' '.repeat(Math.max(0, boxW - textWidth(stripped)))}${RESET}`
    })
    for (let i = 0; i < full.length && top + i < bodyH; i += 1) {
      dimmed[top + i] = `${' '.repeat(left)}${full[i]}`
    }
    return dimmed
  }

  const size = state.overlay === 'help' ? 88 : 60
  const boxW = Math.min(size, W - 4)
  const left = Math.floor((W - boxW) / 2)
  const top = bodyTop + Math.max(1, Math.floor(bodyH / 4))
  const inner = boxW - 6
  const box = []
  const push = (content) => {
    const stripped = String(content).replace(/ +$/, '')
    box.push(`${bgc(dialogBg)}${stripped}${bgc(dialogBg)}${' '.repeat(Math.max(0, boxW - textWidth(stripped)))}${RESET}`)
  }
  const header = (title) => {
    push('')
    push(`   ${rgb(palette.text)}${ESC}[1m${clip(title, boxW - 12)}${RESET}${bgc(dialogBg)}${' '.repeat(Math.max(1, boxW - 3 - textWidth(title) - 3))}${fgMuted('esc', palette)}`)
  }
  const footerLine = (text) => push(`   ${fgMuted(text, palette)}`)

  if (state.overlay === 'palette') {
    const list = paletteList(state, env)
    state.palette.sel = Math.min(state.palette.sel, Math.max(0, list.length - 1))
    header('Paleta de comandos')
    const q = state.palette.query
    push(COLOR_OK ? `   ${bgc(palette.element)}${q ? rgb(palette.primary) : rgb(palette.muted)} ${q || 'Buscar'} ${RESET}` : `   > ${q || ''}`)
    push('')
    const maxRows = Math.max(3, bodyH - top - 8)
    const start = windowStart(state.palette.sel, list.length, maxRows)
    if (!list.length) push(`   ${fgMuted('Sin resultados', palette)}`)
    let lastGroup = null
    for (let i = 0; i < Math.min(maxRows, list.length); i += 1) {
      const index = start + i
      const action = list[index]
      const rowText = ` ${action.title}`
      if (!state.palette.query && action.group && action.group !== lastGroup) {
        lastGroup = action.group
        push(`    ${fgMuted(action.group, palette)}`)
      }
      const desc = action.description ? clip(action.description, Math.max(10, inner - textWidth(rowText) - 12)) : ''
      const group = action.group && state.palette.query ? clip(action.group, 14) : ''
      const groupPad = group ? Math.max(1, inner - textWidth(rowText) - textWidth(desc) - textWidth(group) - 2) : 0
      const content = index === state.palette.sel
        ? ocSelected(pad(`${rowText}${desc ? ` ${desc}` : ''}`, inner), theme)
        : `${fgText(rowText, palette)} ${desc ? fgMuted(desc, palette) : ''}${group ? `${' '.repeat(groupPad)}${fgMuted(group, palette)}` : ''}`
      state.hit[top + box.length] = { kind: 'palette', index, x1: left + 3, x2: left + 3 + inner }
      push(`   ${content}`)
    }
    push('')
    footerLine('enter abrir · ↑↓ navegar · esc cerrar')
    push('')
  } else if (state.overlay === 'input') {
    const prompt = state.inputPrompt || {}
    header(prompt.title || 'Editar')
    if (prompt.description) {
      for (const line of wrap(prompt.description, inner)) push(`   ${fgMuted(line, palette)}`)
      push('')
    }
    push(COLOR_OK ? `   ${bgc(palette.element)}${rgb(palette.primary)} ${prompt.draft || ''} ${RESET}` : `   > ${prompt.draft || ''}`)
    if (prompt.error) push(`   ${ESC}[38;2;224;108;117m${clip(prompt.error, inner)}${RESET}`)
    else if (prompt.hint) push(`   ${fgMuted(clip(prompt.hint, inner), palette)}`)
    push('')
    footerLine('enter confirmar · esc cancelar')
    push('')
  } else {
    header('Ayuda')
    push('')
    for (const line of HELP_LINES.slice(0, Math.max(3, bodyH - top - 6))) {
      push(`   ${rgb(colorOfHelpLine(line, palette))}${clip(line, inner)}${RESET}${bgc(dialogBg)}`)
    }
    push('')
    footerLine('esc cerrar')
    push('')
  }

  for (let i = 0; i < box.length && top + i < bodyH; i += 1) {
    dimmed[top + i] = `${' '.repeat(left)}${box[i]}`
  }
  return dimmed
}

function colorOfHelpLine(line, palette) {
  if (line.startsWith('═')) return palette.primary
  return palette.text
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
    else if (ch === '\x04') keys.push({ name: 'ctrl-d' })
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
    return THEMES[data.theme] ? data.theme : 'opencode'
  } catch {
    return 'opencode'
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
    state.confirmSel = 1
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
    setTerminalBg()
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
      description: item.hint,
      group: 'Secciones',
      run: () => activateSection(item.id)
    }))
    editFields(env.config).forEach((field, index) => {
      actions.push({
        id: `field:${field.id}`,
        title: `Editar · ${field.label}`,
        description: field.about || '',
        group: field.group ? `Configuración · ${field.group}` : 'Configuración',
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
      actions.push({ id: 'bot:stop', title: 'Detener el bot', description: 'Corta el proceso de la consola', group: 'Bot', run: () => { stopBot() } })
      actions.push({ id: 'bot:restart', title: 'Reiniciar el bot', description: 'Vuelve a lanzar el proceso de la consola', group: 'Bot', run: () => { if (bot.argv) spawnConsole(bot.title, bot.argv, bot.cmd) } })
    }
    actions.push({ id: 'console:clear', title: 'Limpiar la consola', description: 'Borra el historial de logs', group: 'Bot', run: () => { bot.buffer.clear(); state.mode = 'console' } })
    actions.push({ id: 'backup', title: 'Crear respaldo de la sesión', description: 'Copia con fecha junto a la sesión', group: 'Sesión', run: () => createBackup() })
    actions.push({ id: 'refresh', title: 'Refrescar estado', description: 'Relee config.json y la sesión', group: 'Sesión', run: () => { refreshEnv(); state.toast = '🌊 Estado refrescado' } })
    return actions
  }
  env.actions = buildActions()

  /* --------------------------------------------------------------- render */

  let prevFrame = []
  let prevSize = ''

  const hexOf = (color) => `#${color.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  const setTerminalBg = () => { try { process.stdout.write(`${ESC}]11;${hexOf(pal(theme).bg)}\x07`) } catch { /* terminal sin OSC */ } }

  function splashFrame(W, H) {
    const lines = Array.from({ length: H }, () => '')
    const palette = pal(theme)
    const spin = SPINNER[state.tick % SPINNER.length]
    const art = [...logoLines(theme, W), '', `${rgb(palette.muted)}${spin} Cargando tu océano…${RESET}`]
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
    try { process.stdout.write(`${ESC}]111\x07${ESC}[?1000l${ESC}[?1006l${ESC}[?25h${ESC}[?1049l`) } catch { /* nada */ }
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
      if (key.name === 'ctrl-d' && state.overlay !== 'input') return quitRequest()
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
        const ch = key.char || ''
        if (ch === 'b') { state.sidebar = !state.sidebar; dirty = true; return }
        if (/^[0-9]$/.test(ch)) {
          const item = MENU_ITEMS[ch === '0' ? 9 : Number(ch) - 1]
          if (item) await activateSection(item.id)
          dirty = true
          return
        }
        const map = { c: 'console', n: 'console', p: 'pair', r: 'qr', s: 'status', e: 'config', m: 'menu', g: 'commands', l: 'session', d: 'doctor', v: 'verify', u: 'update', t: 'theme', h: 'help', q: 'exit', x: 'exit' }
        const id = map[ch]
        if (id) await activateSection(id)
        dirty = true
        return
      }
      if (key.name === 'ctrl-x' && !(state.mode === 'console' && state.consoleInput)) { state.leader = true; dirty = true; return }
      if (state.mode === 'menu' && (key.name === 'enter' || key.name === 'return') && !state.homeQuery) { state.overlay = 'palette'; state.palette.query = ''; state.palette.sel = 0; dirty = true; return }

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
  setTerminalBg()
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
