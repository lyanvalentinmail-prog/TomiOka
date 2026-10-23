/**
 * WhatsApp falso para los tests del panel web.
 *
 * `scripts/serve-web.js` usa este módulo cuando `TOMIOKA_WEB_RUNTIME` apunta
 * acá: imita la API de Baileys que usa el gestor de vinculación y deja los
 * sockets en `globalThis.__fakeWA` para poder emitir eventos desde el test.
 */

export const DisconnectReason = { loggedOut: 401, restartRequired: 515, connectionClosed: 428 }
export const Browsers = { ubuntu: () => ['Ubuntu', 'Chrome', '1'] }
export const logger = { child: () => logger, trace() {}, debug() {}, info() {}, warn() {}, error() {} }

export async function fetchLatestBaileysVersion() {
  return { version: [2, 3000, 0] }
}

export async function useMultiFileAuthState(dir) {
  return {
    state: { creds: { registered: false, me: null }, keys: {} },
    saveCreds: async () => {
      globalThis.__fakeWA = globalThis.__fakeWA || { saves: 0 }
      globalThis.__fakeWA.saves = (globalThis.__fakeWA.saves || 0) + 1
    },
    dir
  }
}

export function makeCacheableSignalKeyStore(keys) {
  return keys
}

export function makeWASocket() {
  const listeners = {}
  const sent = []
  const store = (globalThis.__fakeWA = globalThis.__fakeWA || { sockets: [] })

  const sock = {
    sent,
    listeners,
    user: { id: '59890000000:1@s.whatsapp.net', name: 'TomiOka' },
    ev: {
      on(event, fn) {
        listeners[event] = listeners[event] || []
        listeners[event].push(fn)
      }
    },
    async sendMessage(jid, content) {
      sent.push({ jid, content })
      return { key: { id: `fake-${sent.length}`, remoteJid: jid } }
    },
    async sendPresenceUpdate() {},
    async updateMediaMessage() {
      throw new Error('no soportado en el WhatsApp falso')
    },
    async requestPairingCode(phone) {
      sock.phoneRequested = phone
      return 'ABCD1234'
    },
    end() {
      sock.ended = true
    },
    ws: { close() {} }
  }

  store.sockets.push(sock)
  store.last = () => store.sockets.at(-1)
  /** Emite un evento en el último socket (como haría WhatsApp) */
  store.emit = (event, payload) => {
    const target = store.last()
    for (const fn of target?.listeners?.[event] || []) fn(payload)
  }
  store.reset = () => {
    store.sockets = []
  }
  return sock
}
