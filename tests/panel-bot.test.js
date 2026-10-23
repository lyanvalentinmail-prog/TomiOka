import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPanelBotManager, categoryIdOf, panelBeforeCommand } from '../scripts/lib/panel-bot.js'
import { createLinkSessionManager } from '../src/lib/link-session.js'
import { silentLogger } from './helpers.js'

/* ── utilidades ───────────────────────────────────────────────────── */

/** Módulos que el gestor importa, con el logger silenciado y sin banner de red */
const deps = {
  logger: { createLogger: () => ({ logger: silentLogger }) },
  banner: { loadMenuImage: async () => null }
}

function makeInstance(overrides = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tomioka-panel-'))
  return {
    dir,
    instance: {
      id: overrides.id || 'demo',
      name: 'Demo',
      phone: '59899123456',
      prefix: '.',
      sessionDir: path.relative(process.cwd(), dir),
      adminNumbers: [],
      customization: {},
      ...overrides
    }
  }
}

/** Socket falso de WhatsApp: guarda lo enviado y permite emitir mensajes */
function fakeSock() {
  const listeners = {}
  const sent = []
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
      return { key: { id: `srv-${sent.length}`, remoteJid: jid } }
    },
    async sendPresenceUpdate() {},
    async updateMediaMessage() {
      throw new Error('no soportado')
    },
    emit(event, payload) {
      for (const fn of listeners[event] || []) fn(payload)
    }
  }
  return sock
}

const incoming = (text, { fromMe = false, id = null, jid = '59891111111@s.whatsapp.net' } = {}) => ({
  key: { remoteJid: jid, fromMe, id: id || `in-${Math.random().toString(36).slice(2)}` },
  pushName: 'Tester',
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000)
})

const texts = (sock) => sock.sent.filter((item) => typeof item.content?.text === 'string').map((item) => item.content.text)
const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

/* ── pruebas ─────────────────────────────────────────────────────── */

test('categoryIdOf traduce las categorías reales del bot', () => {
  assert.equal(categoryIdOf({ name: 'tiktok', category: 'descargas' }), 'download')
  assert.equal(categoryIdOf({ name: 'sticker', category: 'stickers' }), 'stickers')
  assert.equal(categoryIdOf({ name: 'toimg', category: 'conversion' }), 'tools')
  assert.equal(categoryIdOf({ name: 'gemini', category: 'ai' }), 'ai')
  assert.equal(categoryIdOf({ name: 'help', category: 'extras' }), 'info')
  assert.equal(categoryIdOf({ name: 'cualquiera' }), 'tools')
})

test('attach() engancha el handler con el objeto { instance, sock } (regresión del panel)', async () => {
  const { instance, dir } = makeInstance({ id: 'regresion' })
  const sock = fakeSock()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })

  const runtime = await manager.attach({ instance, sock })
  assert.ok(runtime, 'devuelve el runtime')
  assert.equal(sock.listeners['messages.upsert']?.length, 1, 'registró messages.upsert')

  // Un comando real que responde sin red ni FFmpeg
  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('.tiktok')] })
  await wait()

  const replies = texts(sock)
  assert.ok(
    replies.some((text) => /Uso: .tiktok|No se pudo completar/.test(text)),
    `el sub-bot no respondió: ${JSON.stringify(replies)}`
  )
  rmSync(dir, { recursive: true, force: true })
})

test('el sub-bot responde con SU prefijo y no con otro', async () => {
  const { instance, dir } = makeInstance({ id: 'prefijo', prefix: '#' })
  const sock = fakeSock()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  await manager.attach({ instance, sock })

  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('.tiktok')] })
  await wait()
  assert.equal(texts(sock).length, 0, 'el prefijo "." no es el de este sub-bot')

  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('#tiktok')] })
  await wait()
  assert.ok(texts(sock).length >= 1, 'con su prefijo sí responde')
  rmSync(dir, { recursive: true, force: true })
})

test('no responde sus propios mensajes ni los que no son comandos', async () => {
  const { instance, dir } = makeInstance({ id: 'propios' })
  const sock = fakeSock()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  await manager.attach({ instance, sock })

  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('hola, ¿cómo estás?')] })
  await wait()
  assert.equal(texts(sock).length, 0, 'un saludo normal no dispara nada')

  // Lo que el bot envía vuelve por messages.upsert: se ignora por ID
  const own = await sock.sendMessage('59891111111@s.whatsapp.net', { text: 'mensaje del bot' })
  sock.emit('messages.upsert', {
    type: 'notify',
    messages: [{ ...incoming('.tiktok', { fromMe: true }), key: { ...incoming('.tiktok').key, id: own.key.id } }]
  })
  await wait()
  assert.equal(texts(sock).length, 1, 'solo el que mandó el propio bot')
  rmSync(dir, { recursive: true, force: true })
})

test('los comandos personalizados del panel responden y respetan el permiso owner', async () => {
  const { instance, dir } = makeInstance({
    id: 'custom',
    customization: {
      customCommands: [
        { name: 'hola', response: 'Hola {{user}}, soy {{botName}} (prefijo {{prefix}})' },
        { name: 'secreto', response: 'solo dueños', permission: 'owner' }
      ]
    }
  })
  const sock = fakeSock()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  await manager.attach({ instance, sock })

  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('.hola')] })
  await wait()
  assert.ok(texts(sock).some((text) => /Hola Tester, soy TomiOka \(prefijo \.\)/.test(text)))

  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('.secreto')] })
  await wait()
  assert.ok(texts(sock).some((text) => /solo para el dueño/.test(text)))
  rmSync(dir, { recursive: true, force: true })
})

test('un comando deshabilitado en el panel no responde', async () => {
  const { instance, dir } = makeInstance({ id: 'apagado', customization: { disabled: ['tiktok'] } })
  const sock = fakeSock()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  await manager.attach({ instance, sock })

  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('.tiktok')] })
  await wait()
  assert.equal(texts(sock).length, 0, 'el comando quedó apagado')

  sock.emit('messages.upsert', { type: 'notify', messages: [incoming('.help')] })
  await wait()
  assert.ok(texts(sock).length >= 1, 'los demás siguen funcionando')
  rmSync(dir, { recursive: true, force: true })
})

test('attach() avisa si el socket no sirve (para que el panel lo muestre)', async () => {
  const { instance, dir } = makeInstance({ id: 'sin-sock' })
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  await assert.rejects(() => manager.attach({ instance }), /socket de WhatsApp válido/)
  await assert.rejects(() => manager.attach({}), /instancia válida/)
  rmSync(dir, { recursive: true, force: true })
})

test('attach() acepta también la forma antigua (instance, sock)', async () => {
  const { instance, dir } = makeInstance({ id: 'vieja-firma' })
  const sock = fakeSock()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  await manager.attach(instance, sock)
  assert.equal(sock.listeners['messages.upsert']?.length, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('destroy() tira el runtime y attach() lo reconstruye', async () => {
  const { instance, dir } = makeInstance({ id: 'reinicio' })
  const sock = fakeSock()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  const first = await manager.attach({ instance, sock })
  assert.equal(manager.get('reinicio'), first)
  assert.equal(manager.destroy('reinicio'), true)
  assert.equal(manager.get('reinicio'), null)
  assert.equal(manager.destroy('no-existe'), false)

  const sock2 = fakeSock()
  const second = await manager.attach({ instance, sock: sock2 })
  assert.notEqual(second, first, 'runtime nuevo')
  sock2.emit('messages.upsert', { type: 'notify', messages: [incoming('.tiktok')] })
  await wait()
  assert.ok(texts(sock2).length >= 1, 'vuelve a responder')
  rmSync(dir, { recursive: true, force: true })
})

test('panelBeforeCommand ignora sin instancia y respeta alias extra', async () => {
  const instance = {
    id: 'x',
    prefix: '.',
    customization: { aliases: { tiktok: ['tt'] } }
  }
  const findCommand = async (name) => {
    const { findCommand: real } = await import('../src/commands/index.js')
    return real(name)
  }
  const ctx = { commands: new Map(), config: { menu: {} }, displayName: 'T', isOwner: false }
  assert.equal(await panelBeforeCommand('no-existe', ctx, { command: 'tt' }, { getInstance: () => null }), null)

  const decision = await panelBeforeCommand('x', ctx, { command: 'tt' }, {
    getInstance: () => instance,
    commands: { findCommand },
    deps: { commands: async () => ({ findCommand }) }
  })
  assert.ok(decision, 'el alias resuelve al comando real')
  assert.equal(typeof decision, 'object')
})

/* ── cadena completa: gestor de vinculación + bot del panel ───────── */

function fakeRuntime({ registered = false } = {}) {
  const listeners = {}
  const sent = []
  const sock = {
    user: null,
    sent,
    ev: { on: (event, fn) => { listeners[event] = listeners[event] || []; listeners[event].push(fn) } },
    async sendMessage(jid, content) {
      sent.push({ jid, content })
      return { key: { id: `wa-${sent.length}` } }
    },
    async sendPresenceUpdate() {},
    requestPairingCode: async () => 'abcd1234',
    end() {},
    ws: { close() {} }
  }
  return {
    sent,
    sock,
    DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    Browsers: { ubuntu: () => ['Ubuntu', 'Chrome', '1'] },
    logger: { child: () => ({}) },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
    useMultiFileAuthState: async () => ({ state: { creds: { registered }, keys: {} }, saveCreds: async () => {} }),
    makeCacheableSignalKeyStore: (keys) => keys,
    makeWASocket: () => sock,
    emit: (update) => { for (const fn of listeners['connection.update'] || []) fn(update) },
    emitUpsert: (event) => { for (const fn of listeners['messages.upsert'] || []) fn(event) }
  }
}

test('cadena completa: al conectar, el sub-bot responde por el socket de Baileys', async () => {
  const { instance, dir } = makeInstance({ id: 'cadena', customization: { customCommands: [{ name: 'ping', response: 'pong' }] } })
  const mod = fakeRuntime()
  const manager = createPanelBotManager({ getInstance: () => instance, deps })
  const linkSessions = createLinkSessionManager({
    loadRuntime: async () => mod,
    attachSocket: (payload) => manager.attach(payload)
  })

  await linkSessions.start({ ...instance, sessionDirAbs: dir })
  mod.emit({ connection: 'open' })
  await wait()

  const state = linkSessions.getState('cadena')
  assert.equal(state.status, 'open', 'queda conectado')
  assert.equal(state.lastError, '', 'sin errores de activación')

  mod.emitUpsert({ type: 'notify', messages: [incoming('.ping')] })
  await wait()
  const replies = mod.sent.filter((item) => typeof item.content?.text === 'string').map((item) => item.content.text)
  assert.ok(replies.includes('pong'), `el sub-bot conectado debe responder: ${JSON.stringify(replies)}`)
  await linkSessions.closeAll()
  rmSync(dir, { recursive: true, force: true })
})

test('si el handler no se puede enganchar, el estado no se reporta como conectado', async () => {
  const mod = fakeRuntime()
  const linkSessions = createLinkSessionManager({
    loadRuntime: async () => mod,
    attachSocket: async () => { throw new Error('sin runtime') }
  })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tomioka-link-fail-'))
  const patches = []
  const manager = createLinkSessionManager({
    loadRuntime: async () => mod,
    onStatus: (rt, patch) => patches.push({ status: patch.status, error: rt.lastError }),
    attachSocket: async () => { throw new Error('sin runtime') }
  })
  void linkSessions
  await manager.start({ id: 'roto', phone: '59899123456', pairingMode: 'pairing', sessionDirAbs: dir })
  mod.emit({ connection: 'open' })
  await wait()

  const state = manager.getState('roto')
  assert.equal(state.status, 'error', 'no debe figurar como conectado si no responde')
  assert.match(state.lastError, /No se pudo activar el bot/)
  await manager.closeAll()
  rmSync(dir, { recursive: true, force: true })
})
