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
import { backupSession, describeSession, inspectSession } from './lib/session.js'
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

async function resolveLoginMode(config, { askFn = ask, chooseFn = choose, interactive = isInteractive() } = {}) {
  let mode = config.login
  let phone = config.pairingPhone

  if (mode === 'ask') {
    if (!interactive) {
      // Sin TTY (consola de la terminal, panel web): si hay teléfono
      // configurado se usa pairing; si no, QR. Nunca se pregunta.
      mode = isValidPhone(phone) ? 'pairing' : 'qr'
    } else {
      mode = await chooseFn('¿Cómo quieres vincular WhatsApp?', [
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
        await askFn('Número de WhatsApp con código de país (ej: 59891234567)')
      )
    }
    if (!isValidPhone(phone)) {
      // Elegir pairing es definitivo: jamás se sustituye por el QR.
      // Se avisa el problema y el arranque reintenta pedir el código.
      warn('Elegiste pairing code pero falta un número válido (con código de país).')
      warn('No se mostrará el QR: define el número con --phone 598XXXXXXXX o en config.json (pairingPhone).')
    }
  }

  config.pairingPhone = normalizePhone(phone || '')
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
  const store = createStore(config, logger, { persistLiveMessages: true })
  const onUpsert = createUpsertHandler({ config, logger, store, commands })

  let sock = null
  let stopped = false
  let attempts = 0
  let pairingRequested = false
  let pairingAttempts = 0
  let registered = false
  let lastQr = null
  let mode = 'qr'
  let modeChosen = false // true cuando ya se decidió pairing/QR

  // ¿Ya hay sesión? En Termux lo normal es reabrir el bot y que entre solo:
  // no se pregunta nada, no se muestra QR y los flags --qr/--pair se ignoran.
  const session = inspectSession(config.sessionDir)
  registered = session.valid

  if (config.relink && session.exists) {
    const backup = backupSession(config.sessionDir)
    registered = false
    warn(
      backup
        ? `Se olvidó la sesión anterior (respaldo en ${backup}). Hay que vincular de nuevo.`
        : 'Se pidió --relink pero no se pudo mover la sesión anterior.'
    )
  } else if (session.valid) {
    ok(`Sesión encontrada: ${describeSession(session)}`)
    step('Conectando automáticamente, sin pedir código ni mostrar QR...')
  } else if (session.hasCreds) {
    warn(`La sesión guardada no sirve (${session.reason}).`)
    const backup = backupSession(config.sessionDir)
    if (backup) warn(`Se guardó una copia en ${backup} y se pedirá vincular de nuevo.`)
  }

  if (registered && (config.login === 'pairing' || config.login === 'qr')) {
    info(`Se ignora el método de vinculación (${config.login}) porque ya hay una sesión activa.`)
  }

  async function ensureLoginMode() {
    if (modeChosen) return mode
    mode = await resolveLoginMode(config)
    modeChosen = true
    step(`Método de vinculación: ${c.bold(mode === 'pairing' ? 'pairing code' : 'QR code')}`)
    return mode
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
      warn('Reintentando pedir el código (no se muestra el QR porque elegiste pairing)...')
    }
  }

  async function handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update

    if (qr && registered) {
      // Había credenciales pero WhatsApp pidió QR: la sesión ya no vale.
      registered = false
      warn('La sesión guardada expiró o fue cerrada desde el teléfono: hay que vincular de nuevo.')
    }

    if (qr) {
      lastQr = qr
      // Si ya hay sesión válida, nunca se muestra QR ni se pide pairing.
      if (!registered) {
        await ensureLoginMode()
        if (mode === 'pairing') await requestPairing()
        else printQr(qr)
      }
    }

    if (connection === 'connecting') {
      logger.debug('conectando a WhatsApp...')
      if (!registered && modeChosen && mode === 'pairing' && !pairingRequested) {
        setTimeout(() => requestPairing().catch(() => {}), 2000)
      }
    }

    if (connection === 'open') {
      const wasRegistered = registered
      attempts = 0
      pairingRequested = false
      registered = true
      lastQr = null
      const me = sock.user
      ok(
        `${wasRegistered ? 'Sesión restaurada' : 'Vinculación completada'} como ` +
          `${me?.name || 'bot'} (${me?.id?.split('@')[0]})`
      )
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

      pairingRequested = false
      pairingAttempts = 0
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
      // Con timeout de 8 s: si la red deja colgada la consulta, se sigue
      // con la versión incluida en Baileys en vez de no conectar nunca.
      const latest = await Promise.race([
        fetchLatestBaileysVersion(),
        sleep(8_000).then(() => null)
      ])
      version = latest?.version
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

    sock.ev.on('creds.update', () => {
      saveCreds().catch((error_) => logger.debug?.(`No se pudieron guardar las credenciales: ${error_.message}`))
    })
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

    // Patrón recomendado por Baileys: pedir el pairing apenas existe el
    // socket (sin esperar al evento qr), solo si no hay sesión válida.
    if (!registered && mode === 'pairing') {
      setTimeout(() => requestPairing().catch(() => {}), 1200)
    }
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

  // Sin sesión válida, el método (y el teléfono) se definen antes de
  // abrir el socket: así el pairing se pide de una y nunca aparece el QR.
  if (!registered) await ensureLoginMode()

  await connect()
  return sock
}

export { resolveLoginMode }
