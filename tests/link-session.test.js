import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLinkSessionManager, formatPairingCode } from '../src/lib/link-session.js'

function fakeRuntime({ registered = false } = {}) {
  const listeners = {}
  const sock = {
    user: null,
    phoneRequested: '',
    ev: { on: (event, fn) => { listeners[event] = fn } },
    requestPairingCode: async (phone) => { sock.phoneRequested = phone; return 'abcd1234' },
    end() {},
    ws: { close() {} }
  }
  return {
    DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    Browsers: { ubuntu: () => ['Ubuntu', 'Chrome', '1'] },
    logger: { child: () => ({}) },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
    useMultiFileAuthState: async () => ({ state: { creds: { registered }, keys: {} }, saveCreds: async () => {} }),
    makeCacheableSignalKeyStore: (keys) => keys,
    makeWASocket: () => sock,
    emit: (update) => listeners['connection.update']?.(update),
    sock
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

test('formatPairingCode agrupa de 4 en 4 en mayúsculas', () => {
  assert.equal(formatPairingCode('abcd1234'), 'ABCD-1234')
  assert.equal(formatPairingCode('ABCD-1234'), 'ABCD-1234')
  assert.equal(formatPairingCode(''), '')
})

test('el gestor pide el código a Baileys y refleja pairing → open → stopped', async () => {
  const mod = fakeRuntime()
  const patches = []
  const manager = createLinkSessionManager({
    loadRuntime: async () => mod,
    onStatus: (rt, patch) => patches.push(patch)
  })
  const instance = {
    id: 'test-bot',
    phone: '59899123456',
    pairingMode: 'pairing',
    sessionDirAbs: mkdtempSync(path.join(os.tmpdir(), 'tomioka-link-'))
  }

  const started = await manager.start(instance)
  assert.equal(started.status, 'connecting')

  // WhatsApp emite el QR interno: ahí el gestor pide el pairing code
  mod.emit({ qr: 'qr-interno' })
  await tick()
  let state = manager.getState('test-bot')
  assert.equal(state.status, 'pairing')
  assert.equal(state.pairingFormatted, 'ABCD-1234')
  assert.equal(mod.sock.phoneRequested, '59899123456')
  assert.ok(state.pairingCodeAt > 0)

  const result = await manager.requestPairing(instance, { waitMs: 1000 })
  assert.equal(result.formatted, 'ABCD-1234')
  assert.equal(result.code, 'abcd1234')
  assert.ok(result.issuedAt > 0)

  mod.emit({ connection: 'open' })
  await tick()
  state = manager.getState('test-bot')
  assert.equal(state.status, 'open')
  assert.equal(state.connected, true)
  assert.ok(patches.some((patch) => patch.status === 'open' && patch.activated === true))

  await manager.stop('test-bot')
  assert.equal(manager.getState('test-bot').status, 'stopped')
})

test('si WhatsApp rechaza el pedido, no se martillea: máximo 3 intentos por conexión', async () => {
  const mod = fakeRuntime()
  let calls = 0
  mod.sock.requestPairingCode = async () => { calls += 1; throw new Error('Connection Closed') }
  const manager = createLinkSessionManager({ loadRuntime: async () => mod })
  const instance = {
    id: 'test-rechazo',
    phone: '59899123456',
    pairingMode: 'pairing',
    sessionDirAbs: mkdtempSync(path.join(os.tmpdir(), 'tomioka-link-'))
  }
  await assert.rejects(
    manager.requestPairing(instance, { waitMs: 2000 }),
    (error) => error.statusCode === 504
  )
  assert.ok(calls >= 1 && calls <= 3, `requestPairingCode se llamó ${calls} veces (debe ser 1..3)`)
})

test('sin número válido no se intenta pedir el código', async () => {
  const manager = createLinkSessionManager({ loadRuntime: async () => fakeRuntime() })
  await assert.rejects(
    manager.requestPairing({ id: 'x', phone: '123', pairingMode: 'pairing', sessionDirAbs: os.tmpdir() }),
    (error) => error.statusCode === 400
  )
})
