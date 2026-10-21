import { CommandContext } from './lib/context.js'
import { getContentType } from '@whiskeysockets/baileys'
import { PackStore } from './lib/sessions.js'
import { findCommand } from './commands/index.js'
import { getContent, getText } from './lib/message.js'
import { truncate } from './lib/text.js'
import { c, sym } from './lib/colors.js'

const IGNORED_JID_SUFFIXES = ['@broadcast', '@newsletter', 'status@broadcast']

export function createStore(config, logger) {
  return {
    packs: new PackStore({
      ttlMinutes: config.pack.sessionMinutes,
      maxStickers: config.pack.maxStickers,
      logger
    }),
    cooldowns: new Map(),
    // IDs de mensajes enviados por el bot: evita procesar sus propias respuestas
    sentIds: new Set()
  }
}

function shouldIgnore(msg, config, store) {
  if (!msg?.message) return true
  const jid = msg.key?.remoteJid || ''
  if (!jid) return true
  if (IGNORED_JID_SUFFIXES.some((suffix) => jid.endsWith(suffix))) return true
  if (msg.key.id && store?.sentIds?.has(msg.key.id)) return true
  if (msg.key.fromMe && config.behavior.ignoreFromMe && !config.owner.allowFromMe) return true
  const type = getContentType(getContent(msg))
  if (!type || type === 'protocolMessage' || type === 'pollUpdateMessage') return true
  return false
}

/** ¿Está el usuario en cooldown? */
function inCooldown(store, key, cooldownMs) {
  if (!cooldownMs || cooldownMs <= 0) return false
  const now = Date.now()
  const last = store.cooldowns.get(key) || 0
  if (now - last < cooldownMs) return true
  store.cooldowns.set(key, now)
  if (store.cooldowns.size > 2000) {
    for (const [id, time] of store.cooldowns) {
      if (now - time > cooldownMs) store.cooldowns.delete(id)
    }
  }
  return false
}

/** Interpreta el comando sin prefijo (solo chats privados, si está permitido) */
function looseCommand(text, commands) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  const match = trimmed.match(/^(\S+)\s*([\s\S]*)$/)
  if (!match) return null
  const name = match[1].toLowerCase()
  if (!commands.has(name)) return null
  const argsText = (match[2] || '').trim()
  return {
    prefix: '',
    command: name,
    args: argsText ? argsText.split(/\s+/) : [],
    argsText,
    raw: trimmed
  }
}

async function runCommand(ctx, command) {
  const { config } = ctx
  const label = `${c.magenta(command.name)} ${c.gray(`← ${ctx.displayName}`)}`

  if (command.ownerOnly && !ctx.isOwner) {
    await ctx.reply('🔒 Este comando es solo para el dueño del bot.')
    return
  }

  if (!ctx.isOwner && inCooldown(ctx.store, ctx.senderJid, config.behavior.cooldownMs)) {
    ctx.logger.debug?.(`⏳ cooldown ${ctx.displayName}`)
    return
  }

  await ctx.typing('composing')
  if (config.behavior.reactToCommands) await ctx.react('⏳')

  try {
    const summary = await command.run(ctx)
    if (config.behavior.reactToCommands) await ctx.react('✅')
    ctx.logger.info(`${sym.ok} ${label} ${c.gray(`${ctx.latency}ms`)}${summary ? c.gray(` · ${summary}`) : ''}`)
  } catch (error) {
    if (config.behavior.reactToCommands) await ctx.react('❌')
    ctx.logger.error(`${sym.err} ${label} · ${error.message}`)
    await ctx
      .reply(`❌ *No se pudo completar*\n${truncate(error.message || 'Error inesperado', 400)}`)
      .catch(() => {})
  } finally {
    await ctx.typing('paused')
  }
}

/**
 * Procesa un mensaje individual.
 */
export async function handleMessage({ sock, msg, config, logger, store, commands = null }) {
  if (shouldIgnore(msg, config, store)) return

  const text = getText(msg)
  const ctx = new CommandContext({ sock, msg, config, logger, store, text })
  ctx.commands = commands

  if (!config.behavior.respondInGroups && ctx.isGroup) return

  // Sin prefijo: probar modo "sin prefijo" en privado o agregar sticker a un pack
  let parsed = ctx.parsed
  if (!parsed && !ctx.isGroup && !config.behavior.requirePrefixInDM) {
    parsed = looseCommand(text, commands || new Map())
  }

  if (!parsed) {
    if (ctx.current?.kind === 'sticker') {
      const packCommand = findCommand('pack')
      if (packCommand?.onSticker) {
        const handled = await packCommand.onSticker(ctx)
        if (handled) logger.debug?.(`📥 sticker agregado al pack de ${ctx.displayName}`)
      }
    }
    return
  }

  ctx.parsed = parsed
  ctx.command = parsed.command
  ctx.args = parsed.args
  ctx.argsText = parsed.argsText
  ctx.prefix = parsed.prefix

  const command = findCommand(parsed.command)
  if (!command) {
    if (config.behavior.replyUnknownCommand) {
      await ctx
        .reply(
          `❓ No conozco *${parsed.prefix}${parsed.command}*.\nUsa *${config.prefixes[0]}help* para ver todos los comandos.`
        )
        .catch(() => {})
      logger.debug?.(`comando desconocido: ${parsed.command} (${ctx.displayName})`)
    }
    return
  }

  await runCommand(ctx, command)
}

/**
 * Crea el listener de Baileys.
 */
export function createUpsertHandler({ config, logger, store, commands }) {
  return async function onUpsert(sock, { messages, type }) {
    if (type !== 'notify' && type !== 'append') return
    for (const msg of messages || []) {
      try {
        await handleMessage({ sock, msg, config, logger, store, commands })
      } catch (error) {
        logger.error(`${sym.err} Error procesando mensaje: ${error.stack || error.message}`)
      }
    }
  }
}
