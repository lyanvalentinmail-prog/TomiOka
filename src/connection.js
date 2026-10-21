import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import { rmSync } from 'node:fs'
import { isValidPhone, normalizePhone } from './config.js'
import { commands } from './commands/index.js'
import { createStore, createUpsertHandler } from './handler.js'
import { ask, choose, isInteractive } from './lib/prompt.js'
import { c, sym } from './lib/colors.js'
import { box, error, info, ok, pairCode, raw, step, warn } from './lib/ui.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function printQr(qr) {
  raw('')
  raw(c.cyan('   Escanea este código desde WhatsApp → Dispositivos vinculados:'))
  raw('')
  qrcode.generate(qr, { small: true }, (output) => raw(output))
  raw(c.gray('   (el código se renueva automáticamente cada ~20 segundos)'))
}

async function resolveLoginMode(config) {
  let mode = config.login
  let phone = config.pairingPhone

  if (mode === 'ask') {
    if (!isInteractive()) {
      mode = 'qr'
    } else {
      mode = await choose('¿Cómo quieres vincular WhatsApp?', [
        {
          label: 'Código de vinculación (pairing code)',
          hint: 'recomendado en Termux',
          value: 'pairing'
        },
        { label: 'Código QR', hint: 'escanear con otro teléfono', value: 'qr' }
      ])
    }
  }

  if (mode === 'pairing') {
    if (!isValidPhone(phone)) {
      phone = normalizePhone(
        await ask('Número de WhatsApp con código de país (ej: 59891234567)')
      )
    }
    if (!isValidPhone(phone)) {
      warn('Número inválido o vacío: se usará el código QR en su lugar.')
      mode = 'qr'
    }
  }

  config.pairingPhone = normalizePhone(phone)
  return mode
}

function describeDisconnect(lastDisconnect) {
  const error = lastDisconnect?.error
  return {
    statusCode: error?.output?.statusCode,
    message: error?.message || 'sin detalle'
  }
}

/**
 * Inicia el bot (con reconexión automática).
 * @returns {Promise<import('@whiskeysockets/baileys').WASocket>}
 */
export async function startBot({ config, logger, baileysLogger }) {
  const store = createStore(config, logger)
  const onUpsert = createUpsertHandler({ config, logger, store, commands })

  let sock = null
  let stopped = false
  let attempts = 0
  let pairingRequested = false
  let pairingAttempts = 0
  let registered = false
  let lastQr = null
  let mode = 'qr'

  // ¿Ya hay sesión vinculada? Entonces no preguntamos nada.
  const peek = await useMultiFileAuthState(config.sessionDir)
  registered = Boolean(peek.creds?.registered)

  if (!registered) {
    mode = await resolveLoginMode(config)
    step(`Método de vinculación: ${c.bold(mode === 'pairing' ? 'pairing code' : 'QR code')}`)
  }

  async function requestPairing() {
    if (pairingRequested || pairingAttempts >= 3 || !config.pairingPhone || registered) return
    pairingRequested = true
    pairingAttempts += 1
    await sleep(700)
    try {
      const code = await sock.requestPairingCode(config.pairingPhone)
      pairCode(code)
      box(
        [
          `${sym.drop} Abre WhatsApp en tu teléfono`,
          `${sym.arrow} Ajustes → Dispositivos vinculados`,
          `${sym.arrow} Vincular un dispositivo`,
          `${sym.arrow} "Vincular con número de teléfono"`,
          `${c.bold('Ingresa el código de 8 dígitos')}`
        ],
        { color: c.magenta }
      )
    } catch (error_) {
      pairingRequested = false
      error(`No se pudo generar el código de vinculación: ${error_.message}`)
      if (lastQr) {
        warn('Muestro el QR como alternativa:')
        printQr(lastQr)
      }
    }
  }

  async function handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      lastQr = qr
      if (mode === 'pairing' && !registered) await requestPairing()
      else printQr(qr)
    }

    if (connection === 'connecting') {
      logger.debug('conectando a WhatsApp...')
      if (mode === 'pairing' && !registered && !pairingRequested) {
        setTimeout(() => requestPairing().catch(() => {}), 2000)
      }
    }

    if (connection === 'open') {
      attempts = 0
      pairingRequested = false
      registered = true
      lastQr = null
      const me = sock.user
      ok(`Conectado como ${me?.name || 'bot'} (${me?.id?.split('@')[0]})`)
      box(
        [
          `${sym.wave} ${c.bold(config.bot.name)}`,
          `${c.gray('team')}     ${config.bot.team}`,
          `${c.gray('prefix')}   ${config.prefixes.join(' ')}`,
          `${c.gray('comandos')} ${commands.size} entradas (con alias)`,
          `${c.gray('sesión')}   ${config.sessionDir}`,
          `${c.gray('esperando mensajes...')}`
        ],
        { color: c.cyan }
      )
    }

    if (connection === 'close') {
      if (stopped) return
      const { statusCode, message } = describeDisconnect(lastDisconnect)

      if (statusCode === DisconnectReason.loggedOut) {
        error('WhatsApp cerró la sesión (logout). Eliminando credenciales...')
        try {
          rmSync(config.sessionDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
        error('Vuelve a iniciar el bot para vincular un número nuevo.')
        process.exit(1)
      }

      if (statusCode === DisconnectReason.connectionReplaced) {
        error('Otra sesión reemplazó esta conexión. Cierra la otra sesión y reintenta.')
        process.exit(1)
      }

      if (statusCode === DisconnectReason.restartRequired) {
        info('WhatsApp pidió reiniciar la conexión, reconectando...')
        return connect()
      }

      attempts += 1
      if (attempts > 8) {
        error('No se pudo restablecer la conexión después de varios intentos.')
        process.exit(1)
      }

      const wait = Math.min(20000, 1200 * 2 ** Math.min(attempts, 4))
      warn(
        `Conexión cerrada (${statusCode ?? '?'}: ${message}). Reintento ${attempts}/8 en ${(
          wait / 1000
        ).toFixed(0)}s...`
      )
      setTimeout(() => {
        connect().catch((error_) => error(`Reconexión fallida: ${error_.message}`))
      }, wait)
    }
  }

  async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir)

    let version
    try {
      const latest = await fetchLatestBaileysVersion()
      version = latest.version
      logger.debug(`Baileys version ${version?.join('.')}`)
    } catch {
      logger.debug('No se pudo consultar la última versión de WhatsApp Web, usando la incluida.')
    }

    sock = makeWASocket({
      version,
      logger: baileysLogger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger)
      },
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: config.behavior.markOnline,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined
    })

    // Registra los IDs de los mensajes propios para no procesarlos como comandos
    const originalSend = sock.sendMessage.bind(sock)
    sock.sendMessage = async (...args) => {
      const result = await originalSend(...args)
      const id = result?.key?.id
      if (id) {
        store.sentIds.add(id)
        if (store.sentIds.size > 500) {
          store.sentIds.delete(store.sentIds.values().next().value)
        }
      }
      return result
    }

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update) => {
      handleConnectionUpdate(update).catch((error_) => {
        error(`Error en connection.update: ${error_.message}`)
      })
    })
    sock.ev.on('messages.upsert', (event) => {
      onUpsert(sock, event).catch((error_) => {
        error(`Error en messages.upsert: ${error_.message}`)
      })
    })

    logger.debug(`socket creado · sesión: ${config.sessionDir}`)
    return sock
  }

  const shutdown = async (signal) => {
    if (stopped) return
    stopped = true
    info(`Recibido ${signal}, cerrando conexión...`)
    store.packs.destroy()
    try {
      sock?.end?.(undefined)
      sock?.ws?.close?.()
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 300)
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  await connect()
  return sock
}

export { resolveLoginMode }
