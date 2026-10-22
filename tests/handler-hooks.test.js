import test from 'node:test'
import assert from 'node:assert/strict'
import { commands, findCommand } from '../src/commands/index.js'
import { createStore, handleMessage } from '../src/handler.js'
import { fakeSock, sentTexts, silentLogger, testConfig, textMessage } from './helpers.js'

function setup(hooks) {
  const config = testConfig()
  const store = createStore(config, silentLogger)
  const sock = fakeSock()
  return { config, store, sock, hooks }
}

test('un comando deshabilitado por el panel no responde', async () => {
  const hooks = {
    beforeCommand: ({ parsed }) => (parsed.command === 'tiktok' ? { type: 'ignore' } : null)
  }
  const { config, store, sock } = setup(hooks)
  await handleMessage({ sock, msg: textMessage('.tiktok https://www.tiktok.com/x'), config, logger: silentLogger, store, commands, hooks })
  assert.equal(sock.sent.length, 0, 'el sub-bot debe quedarse en silencio')
})

test('un alias extra del panel ejecuta el comando real', async () => {
  const hooks = {
    beforeCommand: ({ parsed }) => (parsed.command === 'menu2' ? { type: 'run', command: findCommand('help') } : null)
  }
  const { config, store, sock } = setup(hooks)
  await handleMessage({ sock, msg: textMessage('.menu2'), config, logger: silentLogger, store, commands, hooks })
  const texts = sentTexts(sock)
  assert.equal(texts.length, 1)
  assert.match(texts[0].content.text, /𝓜𝓮𝓷𝓾 𝓭𝓮 𝓬𝓸𝓶𝓪𝓷𝓭𝓸𝓼/)
})

test('un comando personalizado del panel responde su texto', async () => {
  const hooks = {
    beforeCommand: ({ parsed }) => (parsed.command === 'saludo' ? { type: 'custom', response: '¡Hola desde el panel!' } : null)
  }
  const { config, store, sock } = setup(hooks)
  await handleMessage({ sock, msg: textMessage('.saludo'), config, logger: silentLogger, store, commands, hooks })
  const texts = sentTexts(sock)
  assert.equal(texts.length, 1)
  assert.equal(texts[0].content.text, '¡Hola desde el panel!')
})
