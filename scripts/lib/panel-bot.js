/**
 * Bot de cada sub-bot del panel web.
 *
 * El panel crea un registro (`data/web-subbots.json`), abre un socket de
 * Baileys por sub-bot (`src/lib/link-session.js`) y, cuando el socket existe,
 * engancha acá el handler real de mensajes: el sub-bot responde los comandos
 * desde el mismo proceso del panel.
 *
 * Contrato con `link-session.js`: `attach({ instance, sock, runtime })` — UN
 * objeto. (Antes el panel esperaba `(instance, sock)` y el handler nunca se
 * enganchaba: el sub-bot se vinculaba pero no contestaba nada.)
 */
import path from 'node:path'
import { ROOT } from '../../src/config.js'

const CATEGORY_MAP = {
  descargas: 'download',
  download: 'download',
  stickers: 'stickers',
  conversion: 'tools',
  herramientas: 'tools',
  ai: 'ai',
  extras: 'info'
}

/** Categoría del panel (download/stickers/tools/ai/info) de un comando real */
export function categoryIdOf(command) {
  const rawCategory = String(command?.category || 'tools').toLowerCase()
  if (command?.name === 'help' || command?.name === 'debug') return 'info'
  return CATEGORY_MAP[rawCategory] || 'tools'
}

/**
 * Módulos por defecto. Las dependencias inyectadas (`deps`) tienen la misma
 * forma: un objeto/módulo, no una función. Así los tests pueden pasar dobles
 * sin pelearse con el cargador dinámico.
 */
const defaultLoaders = {
  config: () => import('../../src/config.js'),
  handler: () => import('../../src/handler.js'),
  commands: () => import('../../src/commands/index.js'),
  logger: () => import('../../src/lib/logger.js'),
  banner: () => import('../../src/lib/banner.js')
}

/**
 * Aplica lo guardado en "Editar bot" a cada comando del sub-bot:
 * comandos/categorías deshabilitados (silencio), alias extra y comandos
 * personalizados de texto. Se lee el registro en cada mensaje, así los
 * cambios se aplican sin reiniciar el bot.
 */
export async function panelBeforeCommand(instanceId, ctx, parsed, { getInstance, commands, deps = {} }) {
  const instance = getInstance(instanceId)
  if (!instance) return null
  const customization = instance.customization && typeof instance.customization === 'object' ? instance.customization : {}
  const name = String(parsed?.command || '').toLowerCase()

  const customs = Array.isArray(customization.customCommands) ? customization.customCommands : []
  const custom = customs.find(
    (cc) =>
      String(cc?.name || '').toLowerCase() === name ||
      (cc?.aliases || []).some((alias) => String(alias).toLowerCase() === name)
  )
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

  const registry = commands || deps.commands || (await defaultLoaders.commands())
  const findCommand = registry.findCommand || (() => null)
  let target = findCommand(name)
  if (!target) {
    for (const [commandName, aliases] of Object.entries(customization.aliases || {})) {
      if ((aliases || []).some((alias) => String(alias).toLowerCase() === name)) {
        target = findCommand(commandName)
        break
      }
    }
  }
  if (!target) return null

  const disabledNames = new Set((customization.disabled || []).map((item) => String(item).toLowerCase()))
  const disabledCats = new Set(
    (customization.disabledCategories || []).map((item) => String(item).toLowerCase())
  )
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
          emoji: '💦',
          description: '𝖯𝖾𝗋𝗌𝗈𝗇𝖺𝗅𝗂𝗓𝖺𝖽𝗈𝗌',
          kaomoji: '(｡•̀ᴗ-)✧',
          divider: ['💧', '🌊'],
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

/**
 * Crea el gestor de bots del panel.
 *
 * @param {object} options
 * @param {(id:string) => object|null} options.getInstance  lee el sub-bot del registro
 * @param {object} [options.deps]  dependencias inyectables (tests)
 * @param {Map} [options.runtimes] caché de runtimes por sub-bot
 */
export function createPanelBotManager({ getInstance, deps = {}, runtimes = new Map(), rootDir = ROOT } = {}) {
  if (typeof getInstance !== 'function') throw new Error('createPanelBotManager necesita getInstance')

  /** Devuelve el módulo pedido (inyectado o cargado en el momento) */
  async function moduleFor(name) {
    if (deps[name]) return deps[name]
    const loader = defaultLoaders[name]
    if (!loader) throw new Error(`Dependencia desconocida del panel: ${name}`)
    return loader()
  }

  /** Config del sub-bot a partir de su registro */
  async function configFor(instance) {
    const { loadConfig } = await moduleFor('config')
    const config = await loadConfig()
    const prefix = instance.prefix || '.'
    config.sessionDir = path.resolve(rootDir, instance.sessionDir || `sessions/${instance.id}`)
    config.prefixes = [prefix]
    config.bot = { ...config.bot, prefix, prefixes: config.prefixes }
    config.pairingPhone = String(instance.phone || '').replace(/\D/g, '')
    config.login = 'pairing'
    // Los "números owner" del panel son los dueños de ESTE sub-bot.
    config.owner = {
      ...config.owner,
      numbers: (instance.adminNumbers || []).map((n) => String(n).replace(/\D/g, '')).filter(Boolean)
    }
    return config
  }

  /** Crea (una sola vez) el runtime de mensajes del sub-bot */
  async function runtimeFor(instance) {
    const existing = runtimes.get(instance.id)
    if (existing) return existing

    const [config, handlerMod, commandsMod, loggerMod, bannerMod] = await Promise.all([
      configFor(instance),
      moduleFor('handler'),
      moduleFor('commands'),
      moduleFor('logger'),
      moduleFor('banner')
    ])
    const { logger } = loggerMod.createLogger('warn', 'silent')
    if (config.menu.image) bannerMod.loadMenuImage(config, { logger }).catch(() => {})

    const store = handlerMod.createStore(config, logger, { persistLiveMessages: false })
    const onUpsert = handlerMod.createUpsertHandler({
      config,
      logger,
      store,
      commands: commandsMod.commands,
      hooks: {
        beforeCommand: ({ ctx, parsed }) =>
          panelBeforeCommand(instance.id, ctx, parsed, { getInstance, commands: commandsMod })
      }
    })

    const runtime = { id: instance.id, config, logger, store, onUpsert }
    runtimes.set(instance.id, runtime)
    return runtime
  }

  /**
   * Engancha el handler al socket del sub-bot.
   *
   * Acepta el objeto que manda `link-session.js` (`{ instance, sock }`) y,
   * por compatibilidad, la forma `(instance, sock)`.
   * @returns {Promise<object>} el runtime
   */
  async function attach(payload = {}, maybeSock = null) {
    // Forma del gestor: { instance, sock, runtime }. Forma antigua: (instance, sock).
    const looksLikeWrapper =
      payload && typeof payload === 'object' && payload.instance && typeof payload.instance === 'object' && !payload.id
    const instance = looksLikeWrapper ? payload.instance : payload
    const sock = (payload && payload.sock) || maybeSock || null
    if (!instance || typeof instance !== 'object' || !instance.id) {
      throw new Error('El panel intentó activar un sub-bot sin instancia válida.')
    }
    if (!sock || typeof sock.sendMessage !== 'function') {
      throw new Error(`El sub-bot ${instance.id} no tiene un socket de WhatsApp válido.`)
    }

    const runtime = await runtimeFor(instance)

    // Los IDs de los mensajes que manda el bot se recuerdan para no responder
    // su propia salida (WhatsApp devuelve el mismo mensaje al mismo socket).
    if (!sock.__tomiokaCounted) {
      sock.__tomiokaCounted = true
      const originalSend = sock.sendMessage.bind(sock)
      sock.sendMessage = async (...args) => {
        const result = await originalSend(...args)
        const id = result?.key?.id
        if (id) {
          runtime.store.sentIds.add(id)
          if (runtime.store.sentIds.size > 500) {
            runtime.store.sentIds.delete(runtime.store.sentIds.values().next().value)
          }
        }
        return result
      }
    }

    if (sock.ev && typeof sock.ev.on === 'function') {
      // Se marca el socket para no registrar dos veces el listener si el mismo
      // socket se reutiliza (por ejemplo al reiniciar desde el panel).
      if (!sock.__tomiokaListening) {
        sock.__tomiokaListening = true
        sock.ev.on('messages.upsert', (event) => {
          Promise.resolve(runtime.onUpsert(sock, event)).catch((error) => {
            runtime.logger?.error?.(`Sub-bot ${instance.id}: ${error?.message || error}`)
          })
        })
      }
    }

    return runtime
  }

  /** Tira el runtime de un sub-bot (al detenerlo, borrarlo o editarlo) */
  function destroy(id) {
    const runtime = runtimes.get(id)
    if (!runtime) return false
    try { runtime.store.packs.destroy() } catch { /* ignore */ }
    try { runtime.store.messages.clear() } catch { /* ignore */ }
    runtimes.delete(id)
    return true
  }

  return { attach, destroy, runtimeFor, runtimes, get: (id) => runtimes.get(id) || null }
}
