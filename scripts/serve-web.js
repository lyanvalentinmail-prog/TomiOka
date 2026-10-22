#!/usr/bin/env node
/**
 * Servidor local del panel web de TomiOka.
 *
 * Sirve la SPA copiada en web/ y responde solo el subconjunto de API que
 * TomiOka puede ofrecer de verdad en local: estado del panel, telemetría
 * básica del proceso, catálogo real de comandos, los ocho endpoints de
 * WhatsApp y un registro local de sub-bots en data/web-subbots.json.
 * No crea cuentas, no vende planes, no guarda tickets y no inicia sesiones
 * de WhatsApp desde el navegador: eso se hace con npm run pair/qr.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_DIR = path.join(ROOT, 'web')
const DATA_DIR = path.join(ROOT, 'data')
const REGISTRY_FILE = path.join(DATA_DIR, 'web-subbots.json')
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const REPOSITORY = 'https://github.com/lyanvalentinmail-prog/TomiOka'
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
    count: 4,
    items: [
      endpointItem('TikTok downloader', 'tiktok', '.tiktok', '.tiktok <enlace>', 'Descarga un video de TikTok desde un enlace.', urlParam),
      endpointItem('Instagram downloader', 'instagram', '.instagram', '.instagram <enlace>', 'Descarga contenido público de Instagram desde un enlace.', urlParam),
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

function publicCommand(command) {
  const rawCategory = String(command.category || 'tools').toLowerCase()
  const category = command.name === 'help'
    ? 'info'
    : ({ descargas: 'download', download: 'download', stickers: 'stickers', conversion: 'tools', herramientas: 'tools', extras: 'tools' }[rawCategory] || 'tools')
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
  return {
    ...instance,
    phone,
    phoneMasked: maskPhone(phone),
    prefix: instance.prefix || '.',
    pairingMode: instance.pairingMode === 'qr' ? 'qr' : 'pairing',
    status: instance.status || 'created',
    activated: Boolean(instance.activated),
    groups: 0,
    sessionDir,
    launchCommand: instance.launchCommand || `SESSION_DIR=${sessionDir} PAIRING_PHONE=${phone} npm run pair`
  }
}

function snapshot() {
  const instances = readSubbots().map(publicInstance)
  const revision = createHash('sha256').update(JSON.stringify(instances)).digest('hex').slice(0, 16)
  return {
    ok: true,
    revision,
    instances,
    stats: { groups: 0, registered: 0, subbots: instances.length, connected: 0, activated: 0 }
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
    whatsapp: { instances: instances.length, connected: 0, activated: 0 }
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

function findStoredInstance(id) {
  const items = readSubbots()
  const index = items.findIndex((item) => item.id === id)
  return { items, index, instance: index >= 0 ? items[index] : null }
}

function menuPreview(instance) {
  const prefix = instance.prefix || '.'
  const lines = ['TomiOka · Menú', '']
  for (const category of ENDPOINT_CATEGORIES) {
    lines.push(`${category.icon} ${category.name}`)
    for (const item of category.items) lines.push(`${prefix}${item.command.slice(1)}`)
    lines.push('')
  }
  return lines.join('\n').trim()
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
    return sendJson(res, 200, { ok: true, bot: { name: 'TomiOka', repository: REPOSITORY }, panel: { mode: 'local', accounts: false, store: false }, limits: {} })
  }
  if (method === 'GET' && apiPath === '/state') return sendJson(res, 200, snapshot())
  if (method === 'GET' && apiPath === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write('retry: 15000\n\n')
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, service: 'TomiOka' })}\n\n`)
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
    const timer = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15000)
    req.on('close', () => clearInterval(timer))
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
    return sendJson(res, 501, { ok: false, error: `${item.name} se ejecuta en WhatsApp con ${item.usage}; no es un endpoint HTTP del panel local.`, command: item.command, usage: item.usage })
  }

  if (method === 'GET' && apiPath === '/menu/styles') {
    return sendJson(res, 200, { ok: true, styles: [{ id: 'tomioka', label: 'TomiOka (Oficial)', description: 'Menú por categorías de TomiOka: Descargas y Stickers.', preview: '📥 Descargas · 🎨 Stickers' }] })
  }
  if (method === 'GET' && apiPath === '/credits/plans') return sendJson(res, 200, { ok: true, plans: [] })
  if (apiPath.startsWith('/credits/')) return notImplemented(res, 'La tienda y los créditos')
  if (apiPath === '/tickets' || apiPath.startsWith('/tickets/')) return notImplemented(res, 'Los tickets web (usa GitHub Issues)')
  if (apiPath === '/account/logout' && method === 'POST') return sendJson(res, 200, { ok: true })
  if (apiPath.startsWith('/account/')) {
    if (method === 'GET') return sendJson(res, 401, { ok: false, error: 'No hay cuentas web en el panel local de TomiOka.' })
    return notImplemented(res, 'Las cuentas web')
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
      return sendJson(res, 200, { ok: true, instance: publicInstance(next) })
    }
    if (action === 'link' && method === 'GET') {
      const current = publicInstance(instance)
      return sendJson(res, 200, { ok: true, ...current, connected: false, pairingFormatted: '', pairingCodeAt: null, qrDataUrl: '', lastError: '', note: 'El panel local no mantiene la sesión abierta. Ejecuta launchCommand para vincular WhatsApp.' })
    }
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
      const preview = menuPreview(instance)
      return sendJson(res, 200, { ok: true, preview, text: preview })
    }
    if (method === 'POST' && ['start', 'stop', 'restart', 'pairing', 'activate'].includes(action)) {
      const labels = { start: 'Iniciar sesiones de WhatsApp desde el navegador', stop: 'Detener sesiones desde el navegador', restart: 'Reiniciar sesiones desde el navegador', pairing: 'El pairing code desde el navegador', activate: 'La activación desde el navegador' }
      return notImplemented(res, labels[action])
    }
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
})
