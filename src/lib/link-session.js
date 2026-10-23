/**
 * Sesiones de vinculación de WhatsApp para el panel web.
 *
 * Abre un socket real de Baileys por sub-bot, pide el pairing code a
 * WhatsApp (nunca lo inventa), vigila la conexión y avisa cada cambio
 * de estado. Al vincularse, el socket queda vivo y el llamador puede
 * enganchar el handler de comandos con `attachSocket`: el sub-bot
 * responde mensajes desde el mismo proceso del panel.
 */
import { mkdirSync, rmSync } from 'node:fs'

const PAIRING_CODE_TTL_MS = 55_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 'abcd1234' -> 'ABCD-1234' (formato que muestra WhatsApp). */
export function formatPairingCode(code) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!clean) return ''
  return clean.match(/.{1,4}/g).join('-')
}

/**
 * Convierte el QR de WhatsApp en una imagen (data URL) para mostrarlo en el
 * panel. `qrcode` es una dependencia OPCIONAL: si no está instalada, el panel
 * sigue funcionando y ofrece el pairing code.
 */
let qrEncoderPromise = null
export async function encodeQrDataUrl(text) {
  const value = String(text || '')
  if (!value) return ''
  try {
    if (!qrEncoderPromise) qrEncoderPromise = import('qrcode')
    const QR = await qrEncoderPromise
    const encode = QR?.toDataURL || QR?.default?.toDataURL
    if (typeof encode !== 'function') return ''
    return await encode(value, { margin: 1, width: 320, errorCorrectionLevel: 'L' })
  } catch {
    qrEncoderPromise = null
    return ''
  }
}

let runtimePromise = null
async function defaultLoadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const baileys = await import('@whiskeysockets/baileys')
      const pino = (await import('pino')).default
      return { ...baileys, logger: pino({ level: 'silent' }) }
    })()
  }
  return runtimePromise
}

export function createLinkSessionManager({ loadRuntime = defaultLoadRuntime, onStatus = null, attachSocket = null } = {}) {
  const sessions = new Map()
  let versionPromise = null

  function emit(rt, patch = {}) {
    if (patch.status) rt.status = patch.status
    try { onStatus?.(rt, patch) } catch { /* el panel decide cómo persistir */ }
  }

  function getState(id) {
    const rt = sessions.get(id)
    if (!rt) return null
    return {
      id: rt.id,
      status: rt.status,
      connected: rt.status === 'open',
      registered: rt.registered,
      pairingCode: rt.pairingCode || '',
      pairingFormatted: rt.pairingFormatted || '',
      pairingCodeAt: rt.pairingCodeAt || null,
      qr: rt.qr || '',
      qrDataUrl: rt.qrDataUrl || '',
      qrAt: rt.qrAt || null,
      lastError: rt.lastError || '',
      phone: rt.phone || ''
    }
  }

  async function resolveVersion(mod) {
    if (!versionPromise) {
      versionPromise = (async () => {
        try {
          // Con timeout: si la red deja colgada la consulta, se usa la
          // versión incluida en Baileys en vez de no conectar nunca.
          const latest = await Promise.race([
            mod.fetchLatestBaileysVersion(),
            sleep(8_000).then(() => null)
          ])
          return latest?.version
        } catch { return undefined }
      })()
    }
    return versionPromise
  }

  async function openSocket(rt) {
    const mod = await loadRuntime()
    mkdirSync(rt.sessionDir, { recursive: true })
    const { state, saveCreds } = await mod.useMultiFileAuthState(rt.sessionDir)
    rt.registered = Boolean(state.creds?.registered)
    const version = await resolveVersion(mod)
    const sock = mod.makeWASocket({
      version,
      logger: mod.logger,
      auth: {
        creds: state.creds,
        keys: mod.makeCacheableSignalKeyStore(state.keys, mod.logger)
      },
      browser: mod.Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined
    })
    rt.sock = sock
    rt.attachFailed = false
    rt.pairingAttempts = 0
    rt.lastPairingAttemptAt = 0
    emit(rt, { status: rt.status === 'open' ? 'open' : 'connecting' })

    sock.ev.on('creds.update', () => { saveCreds().catch(() => {}) })
    sock.ev.on('connection.update', (update) => {
      handleUpdate(rt, mod, update).catch((error) => fail(rt, error))
    })
    if (attachSocket) {
      try {
        await attachSocket({ instance: rt.instance, sock, runtime: rt })
      } catch (error) {
        // Si el handler no se pudo enganchar, el sub-bot quedaría conectado
        // pero sordo. Se avisa en el panel en vez de dejarlo así en silencio.
        rt.attachFailed = true
        rt.lastError = `No se pudo activar el bot en esta sesión: ${error?.message || error}`
        emit(rt, { status: 'error' })
      }
    }
    return rt
  }

  async function handleUpdate(rt, mod, update) {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      rt.qr = qr
      rt.qrAt = Date.now()
      rt.qrDataUrl = ''
      encodeQrDataUrl(qr).then((dataUrl) => {
        // Solo si el QR sigue siendo el actual (se renueva cada ~20 s)
        if (rt.qr === qr && dataUrl) rt.qrDataUrl = dataUrl
      }).catch(() => {})
      if (!rt.registered) {
        emit(rt, { status: rt.instance.pairingMode === 'qr' ? 'qr' : 'connecting' })
        if (rt.instance.pairingMode !== 'qr') ensurePairingCode(rt).catch(() => {})
      }
    }
    if (connection === 'open') {
      rt.registered = true
      rt.attempts = 0
      if (rt.attachFailed) {
        // Vinculado, pero sin handler: no se muestra como "conectado".
        emit(rt, { status: 'error' })
        return
      }
      rt.pairingCode = ''
      rt.pairingFormatted = ''
      rt.pairingCodeAt = null
      rt.qr = ''
      rt.qrDataUrl = ''
      rt.lastError = ''
      emit(rt, { status: 'open', activated: true, linkedAt: new Date().toISOString() })
      return
    }
    if (connection !== 'close' || rt.intentionalClose) return

    const statusCode = lastDisconnect?.error?.output?.statusCode
    rt.sock = null
    if (statusCode === mod.DisconnectReason?.loggedOut) {
      rt.registered = false
      rt.pairingCode = ''
      rt.pairingFormatted = ''
      rt.pairingCodeAt = null
      rt.lastError = 'WhatsApp cerró la sesión. Vuelve a pedir un pairing code.'
      try { rmSync(rt.sessionDir, { recursive: true, force: true }) } catch { /* ignore */ }
      emit(rt, { status: 'loggedout', activated: false })
      return
    }

    rt.lastError = `La conexión se cerró (${statusCode ?? 'sin código'}).`
    if (rt.stopped) return
    rt.attempts += 1
    if (rt.attempts > 5) {
      emit(rt, { status: 'error' })
      return
    }
    const codeAlive = rt.pairingCode && Date.now() - (rt.pairingCodeAt || 0) < PAIRING_CODE_TTL_MS
    emit(rt, { status: codeAlive ? 'pairing' : 'connecting' })
    const delay = statusCode === mod.DisconnectReason?.restartRequired ? 800 : Math.min(10_000, 1200 * rt.attempts)
    rt.reconnectTimer = setTimeout(() => {
      if (rt.stopped || rt.sock) return
      openSocket(rt).catch((error) => fail(rt, error))
    }, delay)
  }

  function fail(rt, error) {
    rt.lastError = error?.message || String(error)
    emit(rt, { status: 'error' })
  }

  function ensurePairingCode(rt) {
    if (rt.pairingCode && Date.now() - (rt.pairingCodeAt || 0) < PAIRING_CODE_TTL_MS) {
      return Promise.resolve(rt.pairingFormatted)
    }
    if (rt.pairingPromise) return rt.pairingPromise
    if (!rt.sock) return Promise.reject(new Error('La sesión de WhatsApp todavía no está lista.'))
    if (rt.registered) {
      const error = new Error('Este número ya tiene una sesión vinculada: no hace falta un pairing code.')
      error.statusCode = 409
      return Promise.reject(error)
    }
    // Freno anti-martilleo: pedir el código muchas veces seguidas hace
    // que WhatsApp corte la conexión. Máximo 3 intentos por socket y
    // al menos 1,5 s entre intentos (igual que el bot principal).
    if (rt.pairingAttempts >= 3) {
      return Promise.reject(new Error('Se alcanzó el máximo de intentos de pairing en esta conexión. Pide un código nuevo.'))
    }
    if (Date.now() - (rt.lastPairingAttemptAt || 0) < 1_500) {
      return Promise.reject(new Error('Espera un momento antes de pedir otro código.'))
    }
    rt.pairingAttempts += 1
    rt.lastPairingAttemptAt = Date.now()
    rt.pairingPromise = (async () => {
      const raw = await rt.sock.requestPairingCode(rt.phone)
      rt.pairingCode = String(raw || '').replace(/[^A-Za-z0-9]/g, '')
      rt.pairingFormatted = formatPairingCode(raw)
      rt.pairingCodeAt = Date.now()
      rt.lastError = ''
      emit(rt, { status: 'pairing' })
      return rt.pairingFormatted
    })()
      .catch((error) => { rt.lastError = error.message; throw error })
      .finally(() => { rt.pairingPromise = null })
    return rt.pairingPromise
  }

  async function start(instance) {
    const id = instance.id
    const phone = String(instance.phone || '').replace(/\D/g, '')
    let rt = sessions.get(id)
    if (rt && rt.phone !== phone) { await stop(id); rt = null }
    if (!rt) {
      rt = {
        id, instance, phone,
        sessionDir: instance.sessionDirAbs,
        sock: null, starting: null, status: 'created',
        registered: false, pairingCode: '', pairingFormatted: '', pairingCodeAt: null,
        pairingPromise: null, qr: '', qrAt: null, lastError: '',
        attempts: 0, pairingAttempts: 0, lastPairingAttemptAt: 0,
        stopped: false, intentionalClose: false, reconnectTimer: null
      }
      sessions.set(id, rt)
    }
    rt.instance = instance
    rt.stopped = false
    rt.intentionalClose = false
    if (rt.sock) return getState(id)
    if (!rt.starting) rt.starting = openSocket(rt).finally(() => { rt.starting = null })
    await rt.starting
    return getState(id)
  }

  async function requestPairing(instance, { waitMs = 15_000, force = false } = {}) {
    const phone = String(instance.phone || '').replace(/\D/g, '')
    if (phone.length < 8) {
      const error = new Error('Este sub-bot no tiene un número de WhatsApp válido para pedir el pairing code.')
      error.statusCode = 400
      throw error
    }
    if (force) await stop(instance.id)
    let rt = sessions.get(instance.id)
    await start(instance)
    rt = sessions.get(instance.id)
    if (rt.status === 'open') return { ...getState(instance.id), alreadyLinked: true }

    const deadline = Date.now() + Math.max(1_000, Math.min(30_000, waitMs))
    while (Date.now() < deadline) {
      if (rt.pairingCode && Date.now() - (rt.pairingCodeAt || 0) < PAIRING_CODE_TTL_MS) {
        return { ...getState(instance.id), code: rt.pairingCode, formatted: rt.pairingFormatted, issuedAt: rt.pairingCodeAt }
      }
      if (rt.status === 'open') return { ...getState(instance.id), alreadyLinked: true }
      if (rt.status === 'loggedout') {
        const error = new Error(rt.lastError || 'WhatsApp cerró la sesión.')
        error.statusCode = 409
        throw error
      }
      if (rt.registered) {
        const error = new Error('Este número ya tiene una sesión vinculada: no hace falta un pairing code.')
        error.statusCode = 409
        throw error
      }
      if (rt.sock && !rt.pairingPromise) ensurePairingCode(rt).catch(() => {})
      await sleep(150)
    }
    if (rt.pairingCode) {
      return { ...getState(instance.id), code: rt.pairingCode, formatted: rt.pairingFormatted, issuedAt: rt.pairingCodeAt }
    }
    const error = new Error(rt.lastError || 'WhatsApp no entregó el pairing code a tiempo. Revisa la conexión e inténtalo de nuevo.')
    error.statusCode = 504
    throw error
  }

  async function stop(id) {
    const rt = sessions.get(id)
    if (!rt) return null
    rt.stopped = true
    rt.intentionalClose = true
    if (rt.reconnectTimer) clearTimeout(rt.reconnectTimer)
    try { rt.sock?.end?.(undefined) } catch { /* ignore */ }
    try { rt.sock?.ws?.close?.() } catch { /* ignore */ }
    rt.sock = null
    rt.pairingCode = ''
    rt.pairingFormatted = ''
    rt.pairingCodeAt = null
    rt.qr = ''
    rt.qrDataUrl = ''
    emit(rt, { status: 'stopped' })
    return getState(id)
  }

  async function closeAll() {
    await Promise.allSettled([...sessions.keys()].map((id) => stop(id)))
  }

  return { start, requestPairing, stop, closeAll, getState, formatPairingCode }
}
