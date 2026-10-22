import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Valores por defecto (se mezclan con config.json) */
export const DEFAULTS = {
  bot: {
    name: 'TomiOka',
    team: '◢🌊◣ 𝕿𝖔𝖒𝖎𝖐𝖆 ࿙💧࿚',
    emojis: ['💧', '🌊', '🐟', '💦', '💙'],
    prefix: '.',
    version: '1.0',
    status: 'ᴏɴʟɪɴᴇ',
    year: String(new Date().getFullYear())
  },
  login: 'ask', // "ask" | "qr" | "pairing"
  pairingPhone: '',
  owner: { numbers: [], allowFromMe: false },
  session: { dir: 'sessions' },
  stickers: {
    packName: 'TomiOka',
    packAuthor: '◢🌊◣ 𝕿𝖔𝖒𝖎𝖐𝖆',
    size: 512,
    fps: 15,
    maxAnimatedSeconds: 6.5,
    quality: 82,
    lossless: false,
    maxStaticKB: 100,
    maxAnimatedKB: 500,
    maxInputMB: 30
  },
  pack: {
    maxStickers: 30,
    sessionMinutes: 10,
    defaultName: 'TomiOka Pack',
    defaultAuthor: '◢🌊◣ 𝕿𝖔𝖒𝖎𝖐𝖆',
    traySize: 96,
    acceptPhotos: true, // las fotos se convierten en sticker al vuelo
    acceptVideos: true, // los videos/GIF se convierten en sticker animado
    autoDoneAfter: 0 // 0 = solo con .pack done
  },
  emojimix: {
    enabled: true,
    metadataUrl:
      'https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/main/app/metadata.json',
    cacheFile: 'data/emojimix-index.json',
    timeoutMs: 600000
  },
  // IA con OpenCode (opencode.ai). Sin clave usa los modelos "-free" del
  // gateway; con OPENCODE_API_KEY usa los modelos oficiales de cada marca.
  ai: {
    enabled: true,
    baseUrl: 'https://opencode.ai/inference/v1',
    openaiBaseUrl: 'https://opencode.ai/inference/openai/v1',
    anthropicBaseUrl: 'https://opencode.ai/inference/anthropic/v1',
    googleBaseUrl: 'https://opencode.ai/inference/google/v1beta',
    apiKey: '',
    userAgent: 'opencode/1.18.30',
    timeoutMs: 90000,
    maxTokens: 1024,
    temperature: 0.7,
    maxInputChars: 6000,
    maxChars: 3500,
    retriesPerModel: 2,
    freeTierFallback: true,
    models: {
      gemini: ['gemini-3-flash', 'gemini-3.5-flash-lite'],
      chatgpt: ['gpt-5.6-terra', 'gpt-5-nano'],
      deepseek: ['deepseek-v4.1-flash', 'deepseek-v4.1-flash-free', 'deepseek-v4-pro']
    },
    freeModels: [
      'deepseek-v4.1-flash-free',
      'glm-5.3-flash-free',
      'big-pickle',
      'beam-free',
      'mimo-v2.6-flash-free',
      'nemotron-3.5-lightning-free',
      'minimax-m3.1-flash-free',
      'flint-40b-free'
    ]
  },
  // 🔎 Búsqueda de stickers y paquetes (Sticker.ly). Ver src/lib/sticker-search.js
  search: {
    enabled: true,
    provider: 'stickerly', // "stickerly" | "custom"
    baseUrl: 'https://api.sticker.ly',
    customBaseUrl: '', // con provider "custom": tu propia API
    userAgent: 'androidapp.stickerly/1.13.3 (G011A; U; Android 22; es-ES; es;)',
    referer: 'https://sticker.ly/',
    timeoutMs: 20000,
    maxResults: 3,
    sessionMinutes: 10,
    packStickerLimit: 30,
    maxBytes: 8388608,
    language: 'es'
  },
  behavior: {
    cooldownMs: 2500,
    reactToCommands: true,
    sendTyping: true,
    markOnline: true,
    respondInGroups: true,
    requirePrefixInDM: true,
    replyUnknownCommand: true,
    ignoreFromMe: false
  },
  menu: {
    image: '', // URL (Drive incluido), ruta local o data URI del banner
    imageCacheMinutes: 720,
    imageTimeoutMs: 25000,
    sendAsCaption: true, // manda el menú como pie de foto del banner
    showDescriptions: false,
    showUser: true,
    phrases: [
      'El océano también guarda secretos 🌊💙',
      'Un sticker vale más que mil palabras 💧💦',
      'Calma como el agua en movimiento 🐟🌊'
    ],
    // El menú de WhatsApp lista TODOS los comandos del bot.
    categories: [
      {
        emoji: '🌊',
        title: '𝕯𝖊𝖘𝖈𝖆𝖗𝖌𝖆𝖘',
        description: '𝖣𝖾𝗌𝖼𝖺𝗋𝗀𝖺𝗌',
        kaomoji: '( ˶ˆ꒳ˆ˵ )',
        divider: ['💧', '💦'],
        commands: ['tiktok', 'instagram', 'pinterest', 'ytmp3', 'ytmp4']
      },
      {
        emoji: '💧',
        title: '𝕾𝖙𝖎𝖈𝖐𝖊𝖗𝖘',
        description: '𝖲𝗍𝗂𝖼𝗄𝖾𝗋𝗌',
        kaomoji: '( ᵕ ᵗ ᵕ )',
        divider: ['🐟', '💙'],
        commands: ['brat', 'attp', 'ttp', 'sticker', 'gif', 'emojimix', 'search', 'searchpack']
      },
      {
        emoji: '💦',
        title: '𝕮𝖔𝖓𝖛𝖊𝖗𝖘𝖎𝖔́𝖓',
        description: '𝖢𝗈𝗇𝗏𝖾𝗋𝗌𝗂𝗈́𝗇',
        kaomoji: '( ˶ᵕ˶ )',
        divider: ['🌊', '💧'],
        commands: ['toimg', 'tovideo', 'take']
      },
      {
        emoji: '🐟',
        title: '𝕻𝖆𝖈𝖐𝖘',
        description: '𝖯𝖺𝖼𝗄𝗌',
        kaomoji: '( ᵕ ᵗ ᵕ )',
        divider: ['💙', '🌊'],
        commands: ['pack']
      },
      {
        emoji: '💙',
        title: '𝕬𝕴',
        description: '𝖠𝖨',
        kaomoji: '( ᵕ ᴗ ᵕ )',
        divider: ['💦', '🐟'],
        commands: ['gemini', 'chatgpt', 'deepseek']
      },
      {
        emoji: '🌊',
        title: '𝕴𝖓𝖋𝖔',
        description: '𝖨𝗇𝖿𝗈',
        kaomoji: '( ᴗ͈ˬᴗ͈ )',
        divider: ['💧', '💙'],
        commands: ['help', 'debug']
      }
    ]
  },
  logging: { level: 'info', baileys: 'silent' }
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function deepMerge(base, extra) {
  if (!isPlainObject(extra)) return isPlainObject(base) ? { ...base } : base
  const out = isPlainObject(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(extra)) {
    out[key] = isPlainObject(value) ? deepMerge(out[key], value) : value
  }
  return out
}

/** Acepta "!" o [".", "!", "/"] y devuelve un array limpio y sin duplicados */
export function normalizePrefixes(prefix) {
  const list = Array.isArray(prefix) ? prefix : [prefix]
  const clean = list
    .filter((p) => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim())
  return clean.length ? [...new Set(clean)] : ['.']
}

/** Deja solo dígitos y quita prefijos internacionales tipo 00 */
export function normalizePhone(raw) {
  if (!raw) return ''
  let digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits
}

export function normalizeLoginMode(mode) {
  const value = String(mode ?? '').toLowerCase().trim()
  if (['pair', 'pairing', 'code', 'codigo', 'código'].includes(value)) return 'pairing'
  if (['qr', 'qrcode', 'code-qr'].includes(value)) return 'qr'
  return 'ask'
}

export function isValidPhone(phone) {
  const digits = normalizePhone(phone)
  return digits.length >= 8 && digits.length <= 15
}

function readConfigFile(file) {
  if (!file || !existsSync(file)) return {}
  const raw = readFileSync(file, 'utf8')
  const json = raw.replace(/^\uFEFF/, '')
  try {
    return JSON.parse(json)
  } catch (error) {
    throw new Error(`config.json inválido (${file}): ${error.message}`)
  }
}

/**
 * Carga config.json + variables de entorno y devuelve un objeto normalizado.
 */
export function loadConfig({ file = process.env.CONFIG_PATH || path.join(ROOT, 'config.json') } = {}) {
  const merged = deepMerge(DEFAULTS, readConfigFile(file))

  // ---- variables de entorno (útiles en Termux / Docker) ----
  if (process.env.BOT_PREFIX) merged.bot.prefix = process.env.BOT_PREFIX
  if (process.env.BOT_NAME) merged.bot.name = process.env.BOT_NAME
  if (process.env.BOT_TEAM) merged.bot.team = process.env.BOT_TEAM
  if (process.env.LOGIN) merged.login = process.env.LOGIN
  if (process.env.PAIRING_PHONE) merged.pairingPhone = process.env.PAIRING_PHONE
  if (process.env.SESSION_DIR) merged.session.dir = process.env.SESSION_DIR
  if (process.env.OWNER_NUMBERS) {
    merged.owner.numbers = process.env.OWNER_NUMBERS.split(/[,;\s]+/).filter(Boolean)
  }
  if (process.env.LOG_LEVEL) merged.logging.level = process.env.LOG_LEVEL
  if (process.env.MENU_IMAGE) merged.menu.image = process.env.MENU_IMAGE
  if (process.env.FFMPEG_PATH) merged.ffmpegPath = process.env.FFMPEG_PATH
  // IA (OpenCode): la clave también puede venir del entorno, útil en Termux/VPS.
  if (process.env.OPENCODE_API_KEY) merged.ai.apiKey = process.env.OPENCODE_API_KEY
  if (process.env.AI_ENABLED) merged.ai.enabled = process.env.AI_ENABLED !== '0'
  // Búsqueda de stickers: permite cambiar de proveedor/servidor sin tocar el JSON.
  if (process.env.STICKER_SEARCH_PROVIDER) merged.search.provider = process.env.STICKER_SEARCH_PROVIDER
  if (process.env.STICKER_SEARCH_BASE_URL) merged.search.baseUrl = process.env.STICKER_SEARCH_BASE_URL
  if (process.env.STICKER_SEARCH_ENABLED) merged.search.enabled = process.env.STICKER_SEARCH_ENABLED !== '0'

  const config = { ...merged }

  config.bot = {
    ...merged.bot,
    prefix: merged.bot.prefix,
    prefixes: normalizePrefixes(merged.bot.prefix),
    version: String(merged.bot.version ?? '1.0'),
    year: String(merged.bot.year ?? new Date().getFullYear())
  }
  config.prefixes = config.bot.prefixes
  config.login = normalizeLoginMode(merged.login)
  config.pairingPhone = normalizePhone(merged.pairingPhone)
  config.owner = {
    ...merged.owner,
    numbers: (merged.owner?.numbers || []).map(normalizePhone).filter(Boolean)
  }
  config.sessionDir = path.resolve(ROOT, merged.session.dir || 'sessions')
  config.tmpDir = path.resolve(ROOT, 'data', 'tmp')
  config.emojimix = {
    ...merged.emojimix,
    cacheFile: path.resolve(ROOT, merged.emojimix?.cacheFile || 'data/emojimix-index.json')
  }
  config.paths = {
    root: ROOT,
    data: path.resolve(ROOT, 'data'),
    session: config.sessionDir,
    tmp: config.tmpDir
  }
  config.ffmpegPath = merged.ffmpegPath || process.env.FFMPEG_PATH || ''

  return config
}

/** Crea las carpetas de trabajo necesarias */
export function ensureDirs(config) {
  for (const dir of [config.paths.data, config.paths.session, config.paths.tmp]) {
    mkdirSync(dir, { recursive: true })
  }
}

export function isOwner(config, senderNumber) {
  const digits = normalizePhone(senderNumber)
  return Boolean(digits) && config.owner.numbers.includes(digits)
}

export { path }
