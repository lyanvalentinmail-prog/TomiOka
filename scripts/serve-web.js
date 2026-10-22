#!/usr/bin/env node
/**
 * Servidor local del panel web de TomiOka.
 *
 * Sirve la SPA copiada en web/ y responde solo el subconjunto de API que
 * TomiOka puede ofrecer de verdad en local: estado del panel, telemetría
 * básica del proceso, catálogo real de comandos, los nueve endpoints de
 * WhatsApp y un registro local de sub-bots en data/web-subbots.json.
 * El panel SÍ vincula WhatsApp de verdad: abre un socket de Baileys por
 * sub-bot, pide el pairing code a WhatsApp y, al conectarse, el sub-bot
 * responde comandos desde este mismo proceso. No crea cuentas web, no
 * vende planes ni guarda tickets: eso responde 501 con el motivo.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLinkSessionManager } from '../src/lib/link-session.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_DIR = path.join(ROOT, 'web')
const DATA_DIR = path.join(ROOT, 'data')
const REGISTRY_FILE = path.join(DATA_DIR, 'web-subbots.json')
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const REPOSITORY = 'https://github.com/lyanvalentinmail-prog/TomiOka'
const ACCOUNTS_FILE = path.join(DATA_DIR, 'web-accounts.json')
const OWNER_EMAILS = new Set(['lyanvalentinmail@gmail.com'])
for (const email of String(process.env.OWNER_EMAILS || process.env.OWNER_EMAIL || '').split(/[,;\s]+/)) {
  const clean = email.trim().toLowerCase()
  if (clean) OWNER_EMAILS.add(clean)
}
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
const KEY_MAX_DAYS = 100
const STARTED_AT = Date.now()
let apiRequests = 0
let commandsCache = null

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const endpointItem = (name, slug, command, usage, description, param) => ({
  name,
  path: `/api/whatsapp/${slug}`,
  method: 'CMD',
  tier: 'free',
  type: 'whatsapp-command',
  command,
  usage,
  description,
  params: [param]
})

const urlParam = { name: 'url', label: 'Enlace', required: true, example: 'https://…', description: 'Enlace público para descargar.' }
const textParam = { name: 'text', label: 'Texto', required: true, example: 'Hola TomiOka', description: 'Texto del sticker.' }

export const ENDPOINT_CATEGORIES = [
  {
    name: 'Descargas',
    icon: '📥',
    count: 5,
    items: [
      endpointItem('TikTok downloader', 'tiktok', '.tiktok', '.tiktok <enlace>', 'Descarga un video de TikTok desde un enlace.', urlParam),
      endpointItem('Instagram downloader', 'instagram', '.instagram', '.instagram <enlace>', 'Descarga contenido público de Instagram desde un enlace.', urlParam),
      endpointItem('Pinterest downloader', 'pinterest', '.pinterest', '.pinterest <enlace>', 'Descarga el video (o la imagen) de un pin de Pinterest.', urlParam),
      endpointItem('Youtube Mp3', 'ytmp3', '.ytmp3', '.ytmp3 <enlace>', 'Convierte un video de YouTube a audio MP3.', urlParam),
      endpointItem('Youtube Mp4', 'ytmp4', '.ytmp4', '.ytmp4 <enlace>', 'Descarga un video de YouTube en MP4.', urlParam)
    ]
  },
  {
    name: 'Stickers',
    icon: '🎨',
    count: 4,
    items: [
      endpointItem('Brat', 'brat', '.brat', '.brat <texto>', 'Crea un sticker estilo Brat con el texto indicado.', textParam),
      endpointItem('Attp', 'attp', '.attp', '.attp <texto>', 'Crea un sticker de texto animado con colores.', textParam),
      endpointItem('Ttp', 'ttp', '.ttp', '.ttp <texto>', 'Crea un sticker de texto con borde.', textParam),
      endpointItem('Sticker', 'sticker', '.sticker', '.sticker', 'Convierte una imagen, video corto o GIF respondido en sticker.', { name: 'media', label: 'Media', required: true, example: 'Responde a una imagen en WhatsApp', description: 'Imagen, video corto o GIF respondido en WhatsApp.' })
    ]
  }
]

const FALLBACK_COMMANDS = [
  ...ENDPOINT_CATEGORIES.flatMap((category) => category.items.map((item) => ({
    name: item.command.slice(1),
    aliases: [],
    category: category.name === 'Descargas' ? 'download' : 'stickers',
    description: item.description,
    usage: item.usage,
    args: item.usage.replace(item.command, '').trim(),
    hidden: false
  }))),
  { name: 'help', aliases: ['menu', 'comandos', 'ayuda', 'h'], category: 'info', description: 'Ver los comandos disponibles.', usage: '.help', args: '', hidden: false }
]

function argsFromUsage(command) {
  const usage = String(command.usage || '')
  const head = `.${command.name}`
  return usage.startsWith(head) ? usage.slice(head.length).trim() : ''
}

function categoryIdOf(command) {
  const rawCategory = String(command.category || 'tools').toLowerCase()
  if (command.name === 'help' || command.name === 'debug') return 'info'
  return ({ descargas: 'download', download: 'download', stickers: 'stickers', conversion: 'tools', herramientas: 'tools', ai: 'ai', extras: 'info' }[rawCategory] || 'tools')
}

function publicCommand(command) {
  const category = categoryIdOf(command)
  return {
    name: command.name,
    aliases: Array.isArray(command.aliases) ? command.aliases : [],
    category,
    description: command.description || '',
    usage: command.usage || `.${command.name}`,
    args: argsFromUsage(command),
    hidden: Boolean(command.hidden)
  }
}

async function botCommands() {
  if (commandsCache) return commandsCache
  try {
    const mod = await import(new URL('../src/commands/index.js', import.meta.url))
    commandsCache = (mod.commandList || []).map(publicCommand)
  } catch {
    commandsCache = FALLBACK_COMMANDS
  }
  return commandsCache
}

function ensureRegistry() {
  mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(REGISTRY_FILE)) writeFileSync(REGISTRY_FILE, '[]\n')
}

function readSubbots() {
  try {
    ensureRegistry()
    const parsed = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSubbots(items) {
  ensureRegistry()
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(items, null, 2)}\n`)
}

const streamClients = new Set()
const botRuntimes = new Map()

function persistRuntimeStatus(rt, patch) {
  const { items, index, instance } = findStoredInstance(rt.id)
  if (!instance) return
  items[index] = { ...instance, ...patch, updatedAt: new Date().toISOString() }
  writeSubbots(items)
}

function broadcastLink(id) {
  if (!streamClients.size) return
  const { instance } = findStoredInstance(id)
  if (!instance) return
  const lines = [
    `event: status\ndata: ${JSON.stringify(linkPayload(instance))}\n\n`,
    `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`
  ]
  for (const res of streamClients) {
    for (const line of lines) { try { res.write(line) } catch { /* cliente ido */ } }
  }
}

let commandsModulePromise = null
function loadCommandsModule() {
  if (!commandsModulePromise) commandsModulePromise = import('../src/commands/index.js')
  return commandsModulePromise
}

/**
 * Aplica lo guardado en "Editar bot" a cada comando del sub-bot:
 * comandos/categorías deshabilitados (silencio), alias extra y
 * comandos personalizados de texto. Lee el registro en cada mensaje,
 * así los cambios se aplican sin reiniciar el bot.
 */
async function panelBeforeCommand(instanceId, ctx, parsed) {
  const { instance } = findStoredInstance(instanceId)
  if (!instance) return null
  const customization = instance.customization && typeof instance.customization === 'object' ? instance.customization : {}
  const name = String(parsed.command || '').toLowerCase()

  const customs = Array.isArray(customization.customCommands) ? customization.customCommands : []
  const custom = customs.find((cc) => String(cc?.name || '').toLowerCase() === name
    || (cc?.aliases || []).some((alias) => String(alias).toLowerCase() === name))
  if (custom) {
    const permission = String(custom.permission || 'all')
    if ((permission === 'owner' || permission === 'admin') && !ctx.isOwner) {
      return { type: 'custom', response: '🔒 Este comando es solo para el dueño del bot.' }
    }
    const response = String(custom.response || '')
      .replaceAll('{{user}}', ctx.displayName || '')
      .replaceAll('{{botName}}', 'TomiOka')
      .replaceAll('{{prefix}}', instance.prefix || '.')
      .replaceAll('{{groupName}}', ctx.isGroup ? 'este grupo' : 'este chat')
    return { type: 'custom', response }
  }

  const { findCommand } = await loadCommandsModule()
  let target = findCommand(name)
  if (!target) {
    for (const [commandName, aliases] of Object.entries(customization.aliases || {})) {
      if ((aliases || []).some((alias) => String(alias).toLowerCase() === name)) { target = findCommand(commandName); break }
    }
  }
  if (!target) return null

  const disabledNames = new Set((customization.disabled || []).map((item) => String(item).toLowerCase()))
  const disabledCats = new Set((customization.disabledCategories || []).map((item) => String(item).toLowerCase()))
  if (disabledNames.has(String(target.name).toLowerCase()) || disabledCats.has(categoryIdOf(target))) {
    return { type: 'ignore' }
  }
  if (target.name === 'help') {
    const customBanner = customization.banner?.dataUrl || customization.banner?.url || ''
    if (customBanner || disabledNames.size || disabledCats.size || customs.length) {
      const filtered = new Map()
      for (const [key, cmd] of ctx.commands.entries()) {
        if (disabledNames.has(String(cmd.name).toLowerCase()) || disabledCats.has(categoryIdOf(cmd))) continue
        filtered.set(key, cmd)
      }
      const extraCategories = []
      const visibleCustoms = customs.filter((cc) => cc?.name && !cc.hidden)
      if (visibleCustoms.length) {
        for (const cc of visibleCustoms) {
          const cmdName = String(cc.name).toLowerCase()
          if (!filtered.has(cmdName)) {
            filtered.set(cmdName, {
              name: cmdName,
              aliases: Array.isArray(cc.aliases) ? cc.aliases : [],
              description: cc.description || '',
              usage: `${instance.prefix || '.'}${cmdName}${cc.args ? ` ${cc.args}` : ''}`
            })
          }
        }
        extraCategories.push({
          emoji: '✨',
          description: '𝖯𝖾𝗋𝗌𝗈𝗇𝖺𝗅𝗂𝗓𝖺𝖽𝗈𝗌',
          kaomoji: '(｡•̀ᴗ-)✧',
          divider: ['✨', '🌊'],
          commands: visibleCustoms.map((cc) => String(cc.name).toLowerCase())
        })
      }
      ctx.commands = filtered
      ctx.config = {
        ...ctx.config,
        menu: {
          ...ctx.config.menu,
          image: customBanner || ctx.config.menu.image,
          sendAsCaption: true,
          categories: [...(ctx.config.menu.categories || []), ...extraCategories].filter((cat) =>
            (cat.commands || []).some((cmdName) => filtered.has(String(cmdName).toLowerCase()))
          )
        }
      }
    }
  }
  if (String(target.name).toLowerCase() !== name) return { type: 'run', command: target }
  return null
}

async function attachBotHandler(instance, sock) {
  let runtime = botRuntimes.get(instance.id)
  if (!runtime) {
    const [{ loadConfig }, handlerMod, commandsMod, { createLogger }, { loadMenuImage }] = await Promise.all([
      import('../src/config.js'),
      import('../src/handler.js'),
      import('../src/commands/index.js'),
      import('../src/lib/logger.js'),
      import('../src/lib/banner.js')
    ])
    const config = loadConfig()
    config.sessionDir = path.resolve(ROOT, instance.sessionDir || `sessions/${instance.id}`)
    config.prefixes = [instance.prefix || '.']
    config.bot = { ...config.bot, prefix: instance.prefix || '.', prefixes: config.prefixes }
    config.pairingPhone = String(instance.phone || '').replace(/\D/g, '')
    config.login = 'pairing'
    // Los "números owner" del panel son los dueños de ESTE sub-bot.
    config.owner = { ...config.owner, numbers: (instance.adminNumbers || []).map((n) => String(n).replace(/\D/g, '')).filter(Boolean) }
    const { logger } = createLogger('warn', 'silent')
    if (config.menu.image) loadMenuImage(config, { logger }).catch(() => {})
    const store = handlerMod.createStore(config, logger, { persistLiveMessages: false })
    const onUpsert = handlerMod.createUpsertHandler({
      config, logger, store, commands: commandsMod.commands,
      hooks: { beforeCommand: ({ ctx, parsed }) => panelBeforeCommand(instance.id, ctx, parsed) }
    })
    runtime = { store, onUpsert }
    botRuntimes.set(instance.id, runtime)
  }
  if (!sock.__tomiokaCounted) {
    sock.__tomiokaCounted = true
    const originalSend = sock.sendMessage.bind(sock)
    sock.sendMessage = async (...args) => {
      const result = await originalSend(...args)
      const id = result?.key?.id
      if (id) {
        runtime.store.sentIds.add(id)
        if (runtime.store.sentIds.size > 500) runtime.store.sentIds.delete(runtime.store.sentIds.values().next().value)
      }
      return result
    }
  }
  sock.ev.on('messages.upsert', (event) => {
    runtime.onUpsert(sock, event).catch(() => {})
  })
}

function destroyBotRuntime(id) {
  const runtime = botRuntimes.get(id)
  if (!runtime) return
  try { runtime.store.packs.destroy() } catch { /* ignore */ }
  botRuntimes.delete(id)
}

const linkSessions = createLinkSessionManager({
  onStatus: (rt, patch) => { persistRuntimeStatus(rt, patch); broadcastLink(rt.id) },
  attachSocket: attachBotHandler
})

function slugify(value) {
  const slug = String(value || 'subbot')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'subbot'
}

function uniqueSlug(base, items) {
  let slug = base
  let n = 2
  const used = new Set(items.map((item) => item.id))
  while (used.has(slug)) slug = `${base}-${n++}`
  return slug
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return 'Número oculto'
  if (digits.length <= 4) return digits
  return `+${digits.slice(0, 2)} ••• ${digits.slice(-4)}`
}

function defaultCustomization(instance = {}) {
  return {
    menuStyle: 'tomioka',
    menuMode: 'text',
    banner: null,
    aliases: {},
    disabled: [],
    disabledCategories: [],
    categories: [],
    customCommands: [],
    categoryOverrides: {},
    prefix: instance.prefix || '.'
  }
}

function publicInstance(instance) {
  const sessionDir = instance.sessionDir || `sessions/${instance.id}`
  const phone = String(instance.phone || '').replace(/\D/g, '')
  const live = linkSessions.getState(instance.id)
  return {
    ...instance,
    phone,
    phoneMasked: maskPhone(phone),
    prefix: instance.prefix || '.',
    pairingMode: instance.pairingMode === 'qr' ? 'qr' : 'pairing',
    status: live?.status || instance.status || 'created',
    activated: Boolean(instance.activated || live?.status === 'open'),
    live: Boolean(live?.sock || live),
    groups: 0,
    sessionDir,
    launchCommand: instance.launchCommand || `SESSION_DIR=${sessionDir} PAIRING_PHONE=${phone} npm run pair`
  }
}

function liveInstance(instance) {
  return { ...instance, sessionDirAbs: path.resolve(ROOT, instance.sessionDir || `sessions/${instance.id}`) }
}

function linkPayload(instance) {
  const live = linkSessions.getState(instance.id)
  const current = publicInstance(instance)
  return {
    ok: true,
    ...current,
    connected: live?.status === 'open',
    pairingCode: live?.pairingCode || '',
    pairingFormatted: live?.pairingFormatted || '',
    pairingCodeAt: live?.pairingCodeAt || null,
    qr: live?.qr || '',
    qrDataUrl: '',
    lastError: live?.lastError || ''
  }
}

function snapshot() {
  const instances = readSubbots().map(publicInstance)
  const revision = createHash('sha256').update(JSON.stringify(instances)).digest('hex').slice(0, 16)
  return {
    ok: true,
    revision,
    instances,
    stats: { groups: 0, registered: 0, subbots: instances.length, connected: instances.filter((i) => i.status === 'open').length, activated: instances.filter((i) => i.activated).length }
  }
}

function systemInfo() {
  const instances = readSubbots().map(publicInstance)
  const cores = os.cpus()?.length || 1
  const load = os.loadavg?.()[0] || 0
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  let registryBytes = 0
  try { registryBytes = statSync(REGISTRY_FILE).size } catch { /* registro aún no creado */ }
  return {
    ok: true,
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptimeMs: Date.now() - STARTED_AT,
      cpu: { usagePercent: Math.min(100, Math.round((load / cores) * 100)), cores, loadAvg: Number(load.toFixed(2)) },
      memory: { usedBytes, totalBytes, usagePercent: totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0 }
    },
    database: {
      sizeBytes: registryBytes,
      path: 'data/web-subbots.json',
      counters: { messages: 0, apiRequests },
      commandsExecuted: 0,
      topCommands: []
    },
    whatsapp: { instances: instances.length, connected: instances.filter((i) => i.status === 'open').length, activated: instances.filter((i) => i.activated).length }
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function notImplemented(res, feature) {
  sendJson(res, 501, { ok: false, error: `${feature} no está implementado en el panel local de TomiOka todavía.` })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) reject(new Error('Cuerpo demasiado grande'))
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('JSON inválido')) }
    })
    req.on('error', reject)
  })
}

/* ── cuentas locales del panel (registro/login/API keys) ─────────
 * Se guardan en data/web-accounts.json con la contraseña cifrada
 * (scrypt + sal) y las sesiones como hash del token. Los emails en
 * OWNER_EMAILS (más OWNER_EMAIL) tienen rol owner. */
function readAccounts() {
  try {
    ensureRegistry()
    if (!existsSync(ACCOUNTS_FILE)) return { users: [], sessions: {}, apiKeys: [], usage: [] }
    const parsed = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'))
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
      apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
      usage: Array.isArray(parsed.usage) ? parsed.usage : []
    }
  } catch { return { users: [], sessions: {}, apiKeys: [], usage: [] } }
}

function writeAccounts(store) {
  ensureRegistry()
  writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(store, null, 2)}\n`)
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(String(password), salt, 64).toString('hex')}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':')
  if (!salt || !hash) return false
  const test = scryptSync(String(password), salt, 64)
  const original = Buffer.from(hash, 'hex')
  return original.length === test.length && timingSafeEqual(original, test)
}

function tokenHash(token) { return createHash('sha256').update(String(token)).digest('hex') }

function createSession(store, userId) {
  const token = `ses_${randomBytes(24).toString('hex')}`
  store.sessions[tokenHash(token)] = { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS }
  return token
}

function publicUser(user) {
  const isOwner = OWNER_EMAILS.has(String(user.email || '').toLowerCase())
  return {
    id: user.id, username: user.username, email: user.email,
    isOwner, plan: isOwner ? 'OWNER' : (user.plan || 'Free'),
    credits: user.credits || 0, createdAt: user.createdAt
  }
}

function authUser(req) {
  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  const store = readAccounts()
  const session = store.sessions[tokenHash(token)]
  if (!session || session.expiresAt < Date.now()) return null
  const user = store.users.find((item) => item.id === session.userId)
  return user ? { store, user, token } : null
}

function publicKey(record) {
  const now = Date.now()
  const status = record.revokedAt ? 'revoked' : (record.expiresAt < now ? 'expired' : 'active')
  return {
    id: record.id, name: record.name, prefix: record.prefix, status,
    createdAt: record.createdAt, expiresAt: record.expiresAt,
    daysLeft: status === 'active' ? Math.max(0, Math.ceil((record.expiresAt - now) / 86_400_000)) : 0,
    requests: record.requests || 0, lastUsedAt: record.lastUsedAt || null, revokedAt: record.revokedAt || null
  }
}

function accountLimits(user) {
  return { maxActiveKeys: publicUser(user).isOwner ? 25 : 3, maxDays: KEY_MAX_DAYS }
}

function usageSummary(store, user) {
  const keys = store.apiKeys.filter((key) => key.userId === user.id)
  return {
    activeKeys: keys.filter((key) => publicKey(key).status === 'active').length,
    totalKeys: keys.length,
    requests: keys.reduce((sum, key) => sum + (key.requests || 0), 0),
    recent: store.usage.filter((row) => row.userId === user.id).slice(-15).reverse(),
    limits: accountLimits(user)
  }
}

function findStoredInstance(id) {
  const items = readSubbots()
  const index = items.findIndex((item) => item.id === id)
  return { items, index, instance: index >= 0 ? items[index] : null }
}

async function menuPreview(instance) {
  const prefix = instance.prefix || '.'
  const customization = instance.customization && typeof instance.customization === 'object' ? instance.customization : {}
  const disabledNames = new Set((customization.disabled || []).map((item) => String(item).toLowerCase()))
  const disabledCats = new Set((customization.disabledCategories || []).map((item) => String(item).toLowerCase()))
  try {
    const [{ loadConfig }, commandsMod, { buildMenu }] = await Promise.all([
      import('../src/config.js'),
      loadCommandsModule(),
      import('../src/menu.js')
    ])
    const config = loadConfig()
    config.prefixes = [prefix]
    const filtered = new Map()
    for (const [key, cmd] of commandsMod.commands.entries()) {
      if (disabledNames.has(String(cmd.name).toLowerCase()) || disabledCats.has(categoryIdOf(cmd))) continue
      filtered.set(key, cmd)
    }
    const customs = (Array.isArray(customization.customCommands) ? customization.customCommands : []).filter((cc) => cc?.name && !cc.hidden)
    const extraCategories = []
    if (customs.length) {
      for (const cc of customs) {
        const cmdName = String(cc.name).toLowerCase()
        if (!filtered.has(cmdName)) filtered.set(cmdName, { name: cmdName, description: cc.description || '' })
      }
      extraCategories.push({
        emoji: '✨',
        description: '𝖯𝖾𝗋𝗌𝗈𝗇𝖺𝗅𝗂𝗓𝖺𝖽𝗈𝗌',
        kaomoji: '(｡•̀ᴗ-)✧',
        divider: ['✨', '🌊'],
        commands: customs.map((cc) => String(cc.name).toLowerCase())
      })
    }
    const categories = [...(config.menu.categories || []), ...extraCategories].filter((cat) =>
      (cat.commands || []).some((cmdName) => filtered.has(String(cmdName).toLowerCase()))
    )
    if (!categories.length) return 'Sin comandos visibles: activa categorías en Editar bot.'
    config.menu = { ...config.menu, categories }
    return buildMenu({ config, commands: filtered, sender: { label: instance.name || 'Usuario' } })
  } catch {
    return 'No se pudo generar la vista previa del menú.'
  }
}

function dependencyError(res, error) {
  if (!/Cannot find package|ERR_MODULE_NOT_FOUND/.test(String(error?.message || error))) return false
  sendJson(res, 503, { ok: false, error: 'El servidor no tiene instaladas las dependencias de WhatsApp (@whiskeysockets/baileys). Ejecuta npm install y reinicia el panel, o vincula por terminal con npm run pair.' })
  return true
}

async function handleApi(req, res, url) {
  apiRequests++
  const method = req.method || 'GET'
  const apiPath = url.pathname === '/api' ? '/' : url.pathname.replace(/^\/api/, '')
  let body = {}
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    try { body = await readBody(req) } catch (error) { return sendJson(res, 400, { ok: false, error: error.message }) }
  }

  if (method === 'GET' && apiPath === '/health') {
    const commands = await botCommands()
    return sendJson(res, 200, { ok: true, service: 'TomiOka', status: 'ok', uptimeMs: Date.now() - STARTED_AT, commands: commands.filter((command) => !command.hidden).length })
  }
  if (method === 'GET' && apiPath === '/me') {
    return sendJson(res, 200, { ok: true, bot: { name: 'TomiOka', repository: REPOSITORY }, panel: { mode: 'local', accounts: true, store: false }, limits: {}, qrExpiresInSec: 20 })
  }
  if (method === 'GET' && apiPath === '/state') return sendJson(res, 200, snapshot())
  if (method === 'GET' && apiPath === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write('retry: 15000\n\n')
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, service: 'TomiOka' })}\n\n`)
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
    streamClients.add(res)
    const timer = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15000)
    req.on('close', () => { clearInterval(timer); streamClients.delete(res) })
    return
  }
  if (method === 'GET' && apiPath === '/groups') return sendJson(res, 200, { ok: true, groups: [] })
  if (method === 'GET' && apiPath === '/system') return sendJson(res, 200, systemInfo())
  if (method === 'GET' && apiPath === '/commands') return sendJson(res, 200, { ok: true, prefix: '.', commands: await botCommands() })
  if (method === 'GET' && (apiPath === '/endpoints/catalog' || apiPath === '/v1')) {
    return sendJson(res, 200, { ok: true, total: ENDPOINT_CATEGORIES.reduce((sum, category) => sum + category.items.length, 0), categories: ENDPOINT_CATEGORIES })
  }

  const whatsappMatch = apiPath.match(/^\/whatsapp\/([a-z0-9-]+)$/)
  if (whatsappMatch) {
    const item = ENDPOINT_CATEGORIES.flatMap((category) => category.items).find((endpoint) => endpoint.path === `/api/whatsapp/${whatsappMatch[1]}`)
    if (!item) return sendJson(res, 404, { ok: false, error: 'Endpoint no encontrado en TomiOka.' })
    const keyValue = String(req.headers['x-api-key'] || url.searchParams.get('key') || '')
    if (keyValue) {
      const store = readAccounts()
      const record = store.apiKeys.find((key) => key.keyHash === tokenHash(keyValue))
      if (record) {
        record.requests = (record.requests || 0) + 1
        record.lastUsedAt = Date.now()
        store.usage.push({ userId: record.userId, keyName: record.name, endpoint: item.path, status: 501, durationMs: 0, createdAt: Date.now() })
        store.usage = store.usage.slice(-500)
        writeAccounts(store)
      }
    }
    return sendJson(res, 501, { ok: false, error: `${item.name} se ejecuta en WhatsApp con ${item.usage}; no es un endpoint HTTP del panel local.`, command: item.command, usage: item.usage })
  }

  if (method === 'GET' && apiPath === '/menu/styles') {
    return sendJson(res, 200, { ok: true, styles: [{ id: 'tomioka', label: 'TomiOka (Oficial)', description: 'El menú real de TomiOka cargado junto con el banner: saludo, información y las 6 categorías (📥 Descargas, 🎨 Stickers, 🔄 Conversión, 📦 Packs, 🧠 AI y 💧 Info) con todos los comandos del bot.', preview: '📥 Descargas · 🎨 Stickers · 🔄 Conversión · 📦 Packs · 🧠 AI · 💧 Info' }] })
  }
  if (method === 'GET' && apiPath === '/credits/plans') return sendJson(res, 200, { ok: true, plans: [] })
  if (apiPath.startsWith('/credits/')) return notImplemented(res, 'La tienda y los créditos')
  if (apiPath === '/tickets' || apiPath.startsWith('/tickets/')) return notImplemented(res, 'Los tickets web (usa GitHub Issues)')
  if (apiPath === '/account/register' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase()
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { ok: false, error: 'Escribe un email válido.' })
    if (username.length < 3 || username.length > 32) return sendJson(res, 400, { ok: false, error: 'El usuario debe tener entre 3 y 32 caracteres.' })
    if (password.length < 8) return sendJson(res, 400, { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' })
    const store = readAccounts()
    if (store.users.some((user) => user.email === email)) return sendJson(res, 409, { ok: false, error: 'Ya existe una cuenta con ese email. Inicia sesión.' })
    if (store.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) return sendJson(res, 409, { ok: false, error: 'Ese nombre de usuario ya está en uso.' })
    const user = {
      id: `usr_${randomBytes(8).toString('hex')}`, username, email,
      passwordHash: hashPassword(password), plan: 'Free', credits: 0, createdAt: Date.now()
    }
    store.users.push(user)
    const token = createSession(store, user.id)
    writeAccounts(store)
    return sendJson(res, 201, { ok: true, token, user: publicUser(user) })
  }
  if (apiPath === '/account/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase()
    const store = readAccounts()
    const user = store.users.find((item) => item.email === email)
    if (!user || !verifyPassword(body.password || '', user.passwordHash)) {
      return sendJson(res, 401, { ok: false, error: 'Email o contraseña incorrectos.' })
    }
    const token = createSession(store, user.id)
    writeAccounts(store)
    return sendJson(res, 200, { ok: true, token, user: publicUser(user) })
  }
  if (apiPath === '/account/logout' && method === 'POST') {
    const auth = authUser(req)
    if (auth) {
      delete auth.store.sessions[tokenHash(auth.token)]
      writeAccounts(auth.store)
    }
    return sendJson(res, 200, { ok: true })
  }
  if (apiPath.startsWith('/account/')) {
    const auth = authUser(req)
    if (!auth) return sendJson(res, 401, { ok: false, error: 'Inicia sesión para continuar.' })
    const { store, user } = auth

    if (apiPath === '/account/me' && method === 'GET') {
      return sendJson(res, 200, { ok: true, user: publicUser(user), usage: usageSummary(store, user), limits: accountLimits(user) })
    }
    if (apiPath === '/account/usage' && method === 'GET') {
      return sendJson(res, 200, { ok: true, ...usageSummary(store, user) })
    }
    if (apiPath === '/account/keys' && method === 'GET') {
      return sendJson(res, 200, { ok: true, keys: store.apiKeys.filter((key) => key.userId === user.id).map(publicKey) })
    }
    if (apiPath === '/account/keys' && method === 'POST') {
      const name = String(body.name || '').trim().slice(0, 60) || 'Mi API key'
      const days = Number(body.days)
      if (!Number.isInteger(days) || days < 1 || days > KEY_MAX_DAYS) return sendJson(res, 400, { ok: false, error: `La vigencia debe ser de 1 a ${KEY_MAX_DAYS} días.` })
      const mine = store.apiKeys.filter((key) => key.userId === user.id)
      if (mine.filter((key) => publicKey(key).status === 'active').length >= accountLimits(user).maxActiveKeys) {
        return sendJson(res, 403, { ok: false, error: 'Alcanzaste el máximo de API keys activas de tu cuenta.' })
      }
      const fullKey = `tk_${randomBytes(20).toString('hex')}`
      const record = {
        id: `key_${randomBytes(8).toString('hex')}`, userId: user.id, name,
        prefix: fullKey.slice(0, 12), keyHash: tokenHash(fullKey),
        createdAt: Date.now(), expiresAt: Date.now() + days * 86_400_000,
        requests: 0, lastUsedAt: null, revokedAt: null
      }
      store.apiKeys.push(record)
      writeAccounts(store)
      return sendJson(res, 201, { ok: true, key: fullKey, apiKey: publicKey(record), message: 'API key creada. Guárdala: no se vuelve a mostrar.' })
    }
    const keyMatch = apiPath.match(/^\/account\/keys\/([^/]+)(?:\/(renew))?$/)
    if (keyMatch) {
      const record = store.apiKeys.find((key) => key.id === decodeURIComponent(keyMatch[1]) && key.userId === user.id)
      if (!record) return sendJson(res, 404, { ok: false, error: 'API key no encontrada.' })
      if (method === 'DELETE') {
        record.revokedAt = Date.now()
        writeAccounts(store)
        return sendJson(res, 200, { ok: true, apiKey: publicKey(record) })
      }
      if (method === 'POST' && keyMatch[2] === 'renew') {
        const days = Number(body.days)
        if (!Number.isInteger(days) || days < 1 || days > KEY_MAX_DAYS) return sendJson(res, 400, { ok: false, error: `La renovación debe ser de 1 a ${KEY_MAX_DAYS} días.` })
        if (record.revokedAt) return sendJson(res, 400, { ok: false, error: 'Una key revocada no se puede renovar.' })
        record.expiresAt = Math.max(Date.now(), record.expiresAt) + days * 86_400_000
        writeAccounts(store)
        return sendJson(res, 200, { ok: true, apiKey: publicKey(record) })
      }
    }
    if (apiPath === '/account/owner/overview' && method === 'GET') {
      if (!publicUser(user).isOwner) return sendJson(res, 403, { ok: false, error: 'Solo el owner puede ver este panel.' })
      const users = store.users.map((item) => {
        const keys = store.apiKeys.filter((key) => key.userId === item.id)
        return { ...publicUser(item), activeKeys: keys.filter((key) => publicKey(key).status === 'active').length, requests: keys.reduce((sum, key) => sum + (key.requests || 0), 0) }
      })
      const keys = store.apiKeys.map((record) => ({ ...publicKey(record), email: store.users.find((item) => item.id === record.userId)?.email || '' }))
      return sendJson(res, 200, {
        ok: true,
        totals: {
          users: users.length,
          activeKeys: keys.filter((key) => key.status === 'active').length,
          requests: keys.reduce((sum, key) => sum + (key.requests || 0), 0),
          requests24h: store.usage.filter((row) => row.createdAt > Date.now() - 86_400_000).length
        },
        users, keys, topEndpoints: []
      })
    }
    const ownerMatch = apiPath.match(/^\/account\/owner\/(users|keys)\/([^/]+)$/)
    if (ownerMatch && method === 'DELETE') {
      if (!publicUser(user).isOwner) return sendJson(res, 403, { ok: false, error: 'Solo el owner puede hacer esto.' })
      const targetId = decodeURIComponent(ownerMatch[2])
      if (ownerMatch[1] === 'keys') {
        const record = store.apiKeys.find((key) => key.id === targetId)
        if (!record) return sendJson(res, 404, { ok: false, error: 'API key no encontrada.' })
        record.revokedAt = Date.now()
      } else {
        const target = store.users.find((item) => item.id === targetId)
        if (!target) return sendJson(res, 404, { ok: false, error: 'Usuario no encontrado.' })
        if (publicUser(target).isOwner) return sendJson(res, 403, { ok: false, error: 'No se puede eliminar a un owner.' })
        store.users = store.users.filter((item) => item.id !== targetId)
        store.apiKeys = store.apiKeys.filter((key) => key.userId !== targetId)
        for (const [hash, session] of Object.entries(store.sessions)) if (session.userId === targetId) delete store.sessions[hash]
      }
      writeAccounts(store)
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 404, { ok: false, error: 'Ruta de cuenta no encontrada.' })
  }

  if (apiPath === '/instances') {
    if (method === 'GET') return sendJson(res, 200, { ok: true, instances: snapshot().instances })
    if (method === 'POST') {
      const name = String(body.name || '').trim().slice(0, 42)
      const phone = String(body.phone || '').replace(/\D/g, '')
      const pairingMode = body.pairingMode === 'qr' ? 'qr' : 'pairing'
      const prefix = body.prefix || '.'
      if (!name) return sendJson(res, 400, { ok: false, error: 'Escribe un nombre para identificar el sub-bot.' })
      if (!['.', '#', '-', '+', '/'].includes(prefix)) return sendJson(res, 400, { ok: false, error: 'Prefijo no válido.' })
      if (pairingMode === 'pairing' && phone.length < 8) return sendJson(res, 400, { ok: false, error: 'Escribe el número de WhatsApp para generar el pairing code.' })
      const items = readSubbots()
      const id = uniqueSlug(slugify(name), items)
      const sessionDir = `sessions/${id}`
      const now = new Date().toISOString()
      const instance = {
        id, name, phone, prefix, pairingMode,
        status: 'created', activated: false, createdAt: now, updatedAt: now,
        sessionDir,
        launchCommand: pairingMode === 'qr' ? `SESSION_DIR=${sessionDir} npm run qr` : `SESSION_DIR=${sessionDir} PAIRING_PHONE=${phone} npm run pair`,
        adminNumbers: [],
        customization: defaultCustomization({ prefix })
      }
      items.unshift(instance)
      writeSubbots(items)
      const created = publicInstance(instance)
      return sendJson(res, 201, { ok: true, instance: created, config: created, note: 'Sub-bot registrado localmente. Vincula WhatsApp ejecutando launchCommand en tu terminal.' })
    }
  }

  const instanceMatch = apiPath.match(/^\/instances\/([^/]+)(?:\/(.+))?$/)
  if (instanceMatch) {
    const id = decodeURIComponent(instanceMatch[1])
    const action = instanceMatch[2] ? decodeURIComponent(instanceMatch[2]) : ''
    const { items, index, instance } = findStoredInstance(id)
    if (!instance) return sendJson(res, 404, { ok: false, error: 'Sub-bot no encontrado en el registro local.' })

    if (!action && method === 'GET') return sendJson(res, 200, { ok: true, instance: publicInstance(instance) })
    if (!action && method === 'DELETE') {
      await linkSessions.stop(id)
      destroyBotRuntime(id)
      items.splice(index, 1)
      writeSubbots(items)
      return sendJson(res, 200, { ok: true, deleted: id })
    }
    if (!action && method === 'PATCH') {
      const next = { ...instance }
      if (body.name !== undefined) {
        const name = String(body.name || '').trim().slice(0, 42)
        if (!name) return sendJson(res, 400, { ok: false, error: 'El nombre no puede estar vacío.' })
        next.name = name
      }
      if (body.prefix !== undefined) {
        if (!['.', '#', '-', '+', '/'].includes(body.prefix)) return sendJson(res, 400, { ok: false, error: 'Prefijo no válido.' })
        next.prefix = body.prefix
      }
      if (body.phone !== undefined) next.phone = String(body.phone || '').replace(/\D/g, '')
      if (body.pairingMode !== undefined) next.pairingMode = body.pairingMode === 'qr' ? 'qr' : 'pairing'
      if (body.adminNumbers !== undefined) {
        const raw = Array.isArray(body.adminNumbers) ? body.adminNumbers : String(body.adminNumbers || '').split(/[\n,]+/)
        next.adminNumbers = raw.map((value) => String(value).trim()).filter(Boolean)
      }
      if (body.menuStyle !== undefined && next.customization) next.customization = { ...next.customization, menuStyle: String(body.menuStyle) }
      next.updatedAt = new Date().toISOString()
      next.launchCommand = next.pairingMode === 'qr' ? `SESSION_DIR=${next.sessionDir} npm run qr` : `SESSION_DIR=${next.sessionDir} PAIRING_PHONE=${next.phone} npm run pair`
      items[index] = next
      writeSubbots(items)
      if (body.phone !== undefined || body.prefix !== undefined || body.pairingMode !== undefined || body.adminNumbers !== undefined) {
        await linkSessions.stop(id)
        destroyBotRuntime(id)
      }
      return sendJson(res, 200, { ok: true, instance: publicInstance(next) })
    }
    if (action === 'link' && method === 'GET') return sendJson(res, 200, linkPayload(instance))
    if (action === 'commands' && method === 'GET') {
      const customization = instance.customization && typeof instance.customization === 'object' ? instance.customization : defaultCustomization(instance)
      return sendJson(res, 200, { ok: true, prefix: instance.prefix || '.', commands: await botCommands(), customization, menuStyle: customization.menuStyle || 'tomioka' })
    }
    if (action === 'customization' && ['GET', 'POST', 'PUT', 'PATCH'].includes(method)) {
      if (method === 'GET') return sendJson(res, 200, { ok: true, customization: instance.customization || defaultCustomization(instance) })
      const customization = body.customization && typeof body.customization === 'object' ? body.customization : body
      if (!customization || typeof customization !== 'object' || Array.isArray(customization)) return sendJson(res, 400, { ok: false, error: 'Personalización inválida.' })
      const next = { ...instance, customization, updatedAt: new Date().toISOString() }
      items[index] = next
      writeSubbots(items)
      return sendJson(res, 200, { ok: true, customization, instance: publicInstance(next) })
    }
    if (action === 'preview' && method === 'GET') {
      const preview = await menuPreview(instance)
      return sendJson(res, 200, { ok: true, preview, text: preview })
    }
    if (action === 'start' && method === 'POST') {
      const phone = String(instance.phone || '').replace(/\D/g, '')
      if (instance.pairingMode !== 'qr' && phone.length < 8) return sendJson(res, 400, { ok: false, error: 'Este sub-bot no tiene un número válido para vincular. Edítalo y agrega el número con código de país.' })
      try {
        await linkSessions.start(liveInstance(instance))
        return sendJson(res, 200, { ok: true, started: true, ...linkPayload(instance) })
      } catch (error) {
        if (dependencyError(res, error)) return
        return sendJson(res, 500, { ok: false, error: `No se pudo abrir la sesión de WhatsApp: ${error.message}` })
      }
    }
    if (action === 'pairing' && method === 'POST') {
      try {
        const result = await linkSessions.requestPairing(liveInstance(instance), { waitMs: body.waitMs ?? 15_000, force: Boolean(body.force) })
        return sendJson(res, 200, { ok: true, ...result, issuedAt: result.issuedAt ?? result.pairingCodeAt ?? Date.now() })
      } catch (error) {
        if (dependencyError(res, error)) return
        return sendJson(res, error.statusCode || 500, { ok: false, error: error.message })
      }
    }
    if (action === 'stop' && method === 'POST') {
      await linkSessions.stop(id)
      destroyBotRuntime(id)
      return sendJson(res, 200, { ok: true, ...linkPayload(instance) })
    }
    if (action === 'restart' && method === 'POST') {
      await linkSessions.stop(id)
      try {
        await linkSessions.start(liveInstance(instance))
        return sendJson(res, 200, { ok: true, restarted: true, ...linkPayload(instance) })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: `No se pudo reiniciar la sesión: ${error.message}` })
      }
    }
    if (method === 'POST' && action === 'activate') return notImplemented(res, 'La activación desde el navegador')
    return sendJson(res, 404, { ok: false, error: 'Acción de sub-bot no implementada en el panel local de TomiOka.' })
  }

  return sendJson(res, 404, { ok: false, error: 'Ruta API no implementada en el panel local de TomiOka.' })
}

function serveStatic(req, res, url) {
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { pathname = url.pathname }
  if (pathname === '/') pathname = '/index.html'
  const file = path.resolve(WEB_DIR, `.${pathname}`)
  const inside = file === WEB_DIR || file.startsWith(`${WEB_DIR}${path.sep}`)
  if (inside && existsSync(file) && statSync(file).isFile()) {
    const body = readFileSync(file)
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': body.length
    })
    return res.end(req.method === 'HEAD' ? undefined : body)
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const index = path.join(WEB_DIR, 'index.html')
    const body = readFileSync(index)
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache', 'content-length': body.length })
    return res.end(req.method === 'HEAD' ? undefined : body)
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  return res.end('No encontrado')
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    return serveStatic(req, res, url)
  } catch (error) {
    if (req.url?.startsWith('/api')) return sendJson(res, 500, { ok: false, error: `Error del servidor: ${error.message}` })
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end(`Error del servidor: ${error.message}`)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`🌊 TomiOka · Panel web en http://${HOST}:${PORT}`)
  // Reconexión automática: los sub-bots ya vinculados vuelven solos
  // cuando el panel arranca, sin esperar a que alguien toque Conectar.
  for (const instance of readSubbots()) {
    try {
      const credsFile = path.join(ROOT, instance.sessionDir || `sessions/${instance.id}`, 'creds.json')
      if (!existsSync(credsFile)) continue
      const registered = JSON.parse(readFileSync(credsFile, 'utf8'))?.registered
      if (registered) {
        console.log(`🔌 Reconectando sub-bot vinculado: ${instance.id}`)
        linkSessions.start(liveInstance(instance)).catch(() => {})
      }
    } catch { /* sesión ilegible: se vincula a mano desde el panel */ }
  }
})
