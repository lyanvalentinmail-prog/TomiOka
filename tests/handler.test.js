import test from 'node:test'
import assert from 'node:assert/strict'
import { commands } from '../src/commands/index.js'
import { createStore, handleMessage } from '../src/handler.js'
import { fakeSock, sentTexts, silentLogger, testConfig, textMessage } from './helpers.js'

function setup(overrides = {}) {
  const config = testConfig(overrides)
  const logger = silentLogger
  const store = createStore(config, logger)
  const sock = fakeSock()
  return { config, logger, store, sock }
}

test('.help responde con el menú completo', async () => {
  const { config, logger, store, sock } = setup()
  const msg = textMessage('.help')
  await handleMessage({ sock, msg, config, logger, store, commands })

  const texts = sentTexts(sock)
  assert.equal(texts.length, 1)
  const text = texts[0].content.text
  assert.match(text, /𝓜𝓮𝓷𝓾 𝓭𝓮 𝓬𝓸𝓶𝓪𝓷𝓭𝓸𝓼/)
  assert.match(text, /\.sticker/)
  assert.ok(sock.presence.some((item) => item.mode === 'composing'))
  assert.ok(sock.presence.some((item) => item.mode === 'paused'))
})

test('.help sticker muestra la ayuda del comando', async () => {
  const { config, logger, store, sock } = setup()
  await handleMessage({ sock, msg: textMessage('.help take'), config, logger, store, commands })
  assert.match(sentTexts(sock)[0].content.text, /\.take/)
})

test('.menu es un alias de .help', async () => {
  const { config, logger, store, sock } = setup()
  await handleMessage({ sock, msg: textMessage('.menu'), config, logger, store, commands })
  assert.match(sentTexts(sock)[0].content.text, /𝕰𝐍𝐃 𝐎𝐅 𝐌𝐄𝐍𝐔/)
})

test('los comandos desconocidos reciben una respuesta amable', async () => {
  const { config, logger, store, sock } = setup()
  await handleMessage({ sock, msg: textMessage('.comandoinexistente'), config, logger, store, commands })
  assert.match(sentTexts(sock)[0].content.text, /No conozco/)
})

test('los mensajes sin prefijo se ignoran', async () => {
  const { config, logger, store, sock } = setup()
  await handleMessage({ sock, msg: textMessage('hola bot'), config, logger, store, commands })
  assert.equal(sock.sent.length, 0)
})

test('en grupos exige prefijo aunque el modo sin prefijo esté activo en privado', async () => {
  const { config, logger, store, sock } = setup({ behavior: { requirePrefixInDM: false } })
  const group = textMessage('help', { jid: '120363000000000000@g.us' })
  group.key.participant = '59891111111@s.whatsapp.net'
  await handleMessage({ sock, msg: group, config, logger, store, commands })
  assert.equal(sock.sent.length, 0)
})

test('en privado permite comandos sin prefijo si está configurado', async () => {
  const { config, logger, store, sock } = setup({ behavior: { requirePrefixInDM: false } })
  await handleMessage({ sock, msg: textMessage('help'), config, logger, store, commands })
  assert.equal(sentTexts(sock).length, 1)
})

test('ignora notas de voz y mensajes de estado', async () => {
  const { config, logger, store, sock } = setup()
  const audio = {
    key: { remoteJid: '59891111111@s.whatsapp.net', fromMe: false, id: 'audio1' },
    message: { audioMessage: { mimetype: 'audio/ogg' } }
  }
  await handleMessage({ sock, msg: audio, config, logger, store, commands })
  assert.equal(sock.sent.length, 0)

  const status = {
    key: { remoteJid: 'status@broadcast', fromMe: false, id: 'status1' },
    message: { conversation: '.help' }
  }
  await handleMessage({ sock, msg: status, config, logger, store, commands })
  assert.equal(sock.sent.length, 0)
})

test('respeta el cooldown por usuario', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 60000 } })
  await handleMessage({ sock, msg: textMessage('.help'), config, logger, store, commands })
  await handleMessage({ sock, msg: textMessage('.help'), config, logger, store, commands })
  assert.equal(sentTexts(sock).length, 1, 'el segundo comando se ignora por cooldown')
})

test('los errores de comando se informan al usuario', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  await handleMessage({ sock, msg: textMessage('.toimg'), config, logger, store, commands })
  assert.match(sentTexts(sock)[0].content.text, /No se pudo completar/)
  assert.match(sentTexts(sock)[0].content.text, /sticker/)
})

test('.pack inicia una sesión y muestra instrucciones', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  await handleMessage({
    sock,
    msg: textMessage('.pack Olas del mar | Tomi'),
    config,
    logger,
    store,
    commands
  })
  const text = sentTexts(sock)[0].content.text
  assert.match(text, /Nuevo pack iniciado/)
  assert.match(text, /Olas del mar/)
  assert.match(text, /pack done/)
  assert.equal(store.packs.size, 1)
})

test('.pack done sin sesión devuelve un error claro', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  await handleMessage({ sock, msg: textMessage('.pack done'), config, logger, store, commands })
  assert.match(sentTexts(sock)[0].content.text, /No hay ningún pack en curso/)
})

test('.pack cancel descarta la sesión', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  const msg = textMessage('.pack Test')
  await handleMessage({ sock, msg, config, logger, store, commands })
  assert.equal(store.packs.size, 1)
  await handleMessage({ sock, msg: textMessage('.pack cancel'), config, logger, store, commands })
  assert.equal(store.packs.size, 0)
  assert.match(sentTexts(sock).at(-1).content.text, /cancelado/)
})

test('reacciona a los comandos si está habilitado', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0, reactToCommands: true } })
  await handleMessage({ sock, msg: textMessage('.help'), config, logger, store, commands })
  assert.ok(sock.reactions.some((reaction) => reaction.text === '✅'))
})

test('ignora los mensajes que el propio bot envió', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  store.sentIds.add('propio-1')
  const own = textMessage('.help')
  own.key.id = 'propio-1'
  own.key.fromMe = true
  await handleMessage({ sock, msg: own, config, logger, store, commands })
  assert.equal(sentTexts(sock).length, 0)
})

test('un dueño escribiendo desde su propio número es reconocido', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  const own = textMessage('.help')
  own.key.fromMe = true
  await handleMessage({ sock, msg: own, config, logger, store, commands })
  assert.equal(sentTexts(sock).length, 1)
})

test('el handler pasa fotos y videos al pack en curso', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  const packCommand = commands.get('pack')
  const original = packCommand.onMedia
  const seen = []
  packCommand.onMedia = async (ctx) => {
    seen.push(ctx.current?.kind)
    return true
  }

  try {
    const jid = '59891111111@s.whatsapp.net'
    for (const [id, media] of [
      ['foto-1', { imageMessage: { mimetype: 'image/png', fileLength: 1000, caption: '' } }],
      ['video-1', { videoMessage: { mimetype: 'video/mp4', fileLength: 1000, caption: '' } }],
      ['sticker-1', { stickerMessage: { mimetype: 'image/webp', fileLength: 1000 } }]
    ]) {
      await handleMessage({
        sock,
        msg: { key: { remoteJid: jid, fromMe: false, id }, pushName: 'Tester', message: media },
        config,
        logger,
        store,
        commands
      })
    }
  } finally {
    packCommand.onMedia = original
  }

  assert.deepEqual(seen, ['image', 'video', 'sticker'], 'el handler entrega fotos, videos y stickers')
})

test('el handler ignora captions sueltas cuando no hay pack en curso', async () => {
  const { config, logger, store, sock } = setup({ behavior: { cooldownMs: 0 } })
  await handleMessage({
    sock,
    msg: {
      key: { remoteJid: '59891111111@s.whatsapp.net', fromMe: false, id: 'foto-x' },
      message: { imageMessage: { mimetype: 'image/png', caption: 'hola' } }
    },
    config,
    logger,
    store,
    commands
  })
  assert.equal(sentTexts(sock).length, 0)
})
