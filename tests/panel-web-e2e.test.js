import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Prueba de punta a punta del panel web con un WhatsApp falso:
 * API HTTP → gestor de vinculación → bot del sub-bot → respuesta.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tomioka-web-data-'))
const port = 3400 + (process.pid % 200)
process.env.PORT = String(port)
process.env.HOST = '127.0.0.1'
process.env.TOMIOKA_WEB_DATA = dataDir
process.env.TOMIOKA_WEB_RUNTIME = new URL('./fixtures/fake-baileys.mjs', import.meta.url).href

const base = `http://127.0.0.1:${port}`
const { stopServer } = await import('../scripts/serve-web.js')

const fakeWA = () => globalThis.__fakeWA

async function waitFor(fn, { timeout = 6000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  if (last) throw last
  return null
}

async function waitForServer() {
  const ok = await waitFor(async () => (await fetch(`${base}/api/health`)).ok)
  assert.ok(ok, 'el panel no respondió')
}

const json = (res) => res.json()
const post = (url, body = {}) =>
  fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

const incoming = (text, jid = '59891111111@s.whatsapp.net') => ({
  key: { remoteJid: jid, fromMe: false, id: `in-${Math.random().toString(36).slice(2)}` },
  pushName: 'Tester',
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000)
})

const repliesOf = (sock) =>
  sock.sent.filter((item) => typeof item.content?.text === 'string').map((item) => item.content.text)

test.after(async () => {
  await stopServer().catch(() => {})
  rmSync(dataDir, { recursive: true, force: true })
})

test('panel web: vincular un sub-bot y que responda comandos de verdad', async () => {
  await waitForServer()

  // 1) Crear el sub-bot desde la API (como hace el panel)
  const created = await (await post('/api/instances', {
    name: 'E2E Bot',
    phone: '59899123456',
    prefix: '#',
    pairingMode: 'pairing'
  })).json()
  assert.equal(created.ok, true)
  const id = created.instance.id
  assert.equal(created.instance.status, 'created')
  assert.equal(created.instance.botActive, false)

  // 2) Conectar: se abre el socket falso y se pide el pairing code
  const started = await (await post(`/api/instances/${id}/start`)).json()
  assert.equal(started.ok, true)
  assert.equal(started.status, 'connecting')

  await waitFor(() => fakeWA()?.last())
  const sock = fakeWA().last()

  const pairing = await (await post(`/api/instances/${id}/pairing`, { waitMs: 5000 })).json()
  assert.equal(pairing.ok, true)
  assert.equal(pairing.formatted, 'ABCD-1234', 'el panel debe mostrar el código REAL que dio WhatsApp')
  assert.equal(sock.phoneRequested, '59899123456')

  // 3) WhatsApp confirma la vinculación
  fakeWA().emit('connection.update', { connection: 'open' })
  const linked = await waitFor(async () => {
    const data = await (await fetch(`${base}/api/instances/${id}/link`)).json()
    return data.status === 'open' ? data : null
  })
  assert.equal(linked.connected, true)
  assert.equal(linked.activated, true)
  assert.equal(linked.botActive, true, 'el handler de comandos tiene que estar activo')
  assert.equal(linked.lastError, '')

  // 4) Llega un mensaje de WhatsApp y el sub-bot responde con SU prefijo
  fakeWA().emit('messages.upsert', { type: 'notify', messages: [incoming('#tiktok')] })
  const reply = await waitFor(() => repliesOf(sock).find((text) => /Uso: |No se pudo completar/.test(text)))
  assert.ok(reply, `el sub-bot no respondió: ${JSON.stringify(sock.sent)}`)

  const ignored = repliesOf(sock).length
  fakeWA().emit('messages.upsert', { type: 'notify', messages: [incoming('.tiktok')] })
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(repliesOf(sock).length, ignored, 'el prefijo "." no es el de este sub-bot')

  // 5) Al detenerlo el bot queda inactivo
  const stopped = await (await post(`/api/instances/${id}/stop`)).json()
  assert.equal(stopped.ok, true)
  assert.equal(stopped.botActive, false)
  assert.notEqual(stopped.status, 'open')

  await fetch(`${base}/api/instances/${id}`, { method: 'DELETE' })
})

test('panel web: modo QR entrega la imagen lista para mostrar', async () => {
  await waitForServer()
  fakeWA()?.reset?.()

  const created = await (await post('/api/instances', {
    name: 'QR Bot',
    phone: '59899111222',
    prefix: '.',
    pairingMode: 'qr'
  })).json()
  const id = created.instance.id

  await post(`/api/instances/${id}/start`)
  await waitFor(() => fakeWA()?.last())

  // WhatsApp emite un QR (cadena real de pairing de Baileys)
  const qr = '2@AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/=,Q2xhc3NpYy1XaGF0c0FwcA==,AbCdEf=='
  fakeWA().emit('connection.update', { qr })

  const link = await waitFor(async () => {
    const data = await (await fetch(`${base}/api/instances/${id}/link`)).json()
    return data.qrDataUrl ? data : null
  })
  assert.equal(link.status, 'qr')
  assert.ok(link.qrDataUrl.startsWith('data:image/png;base64,'), 'el QR debe llegar como imagen (PNG)')
  assert.ok(link.qrDataUrl.length > 500, 'una imagen de QR real no puede ser un pixel')

  await post(`/api/instances/${id}/stop`)
  await fetch(`${base}/api/instances/${id}`, { method: 'DELETE' })
})

test('panel web: el registro guarda el resultado de la vinculación', async () => {
  await waitForServer()
  const registry = JSON.parse(
    (await import('node:fs')).readFileSync(path.join(dataDir, 'web-subbots.json'), 'utf8')
  )
  assert.ok(Array.isArray(registry), 'el registro es un array de sub-bots')
})
