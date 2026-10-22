import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLoginMode } from '../src/connection.js'

const base = (extra = {}) => ({ login: 'pairing', pairingPhone: '', ...extra })

test('pairing con teléfono válido no pregunta nada y sigue en pairing', async () => {
  const config = base({ pairingPhone: '59899123456' })
  const mode = await resolveLoginMode(config, {
    interactive: true,
    askFn: async () => { throw new Error('no debería preguntar') },
    chooseFn: async () => { throw new Error('no debería preguntar') }
  })
  assert.equal(mode, 'pairing')
})

test('pairing sin teléfono válido NUNCA cae a QR', async () => {
  const config = base()
  const mode = await resolveLoginMode(config, {
    interactive: false,
    askFn: async () => '',
    chooseFn: async () => 'qr'
  })
  assert.equal(mode, 'pairing', 'elegir pairing es definitivo: nada de QR de reemplazo')
})

test('pairing pregunta el número y lo normaliza', async () => {
  const config = base()
  const mode = await resolveLoginMode(config, {
    interactive: true,
    askFn: async () => '+598 99 123 456',
    chooseFn: async () => 'qr'
  })
  assert.equal(mode, 'pairing')
  assert.equal(config.pairingPhone, '59899123456')
})

test('pairing reintenta el número en la consola hasta que sea válido', async () => {
  const answers = ['123', '+598 99 123 456']
  const config = base()
  const mode = await resolveLoginMode(config, {
    interactive: true,
    askFn: async () => answers.shift(),
    chooseFn: async () => 'qr'
  })
  assert.equal(mode, 'pairing')
  assert.equal(config.pairingPhone, '59899123456', 'el segundo intento válido queda guardado')
})

test('ask sin TTY usa pairing si hay teléfono y QR si no hay', async () => {
  assert.equal(
    await resolveLoginMode(base({ login: 'ask', pairingPhone: '59899123456' }), { interactive: false }),
    'pairing'
  )
  assert.equal(
    await resolveLoginMode(base({ login: 'ask' }), { interactive: false }),
    'qr'
  )
})

test('ask con TTY respeta la elección del usuario', async () => {
  assert.equal(
    await resolveLoginMode(base({ login: 'ask' }), { interactive: true, chooseFn: async () => 'qr' }),
    'qr'
  )
  assert.equal(
    await resolveLoginMode(base({ login: 'ask', pairingPhone: '59899123456' }), { interactive: true, chooseFn: async () => 'pairing' }),
    'pairing'
  )
})
