import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../src/handler.js'
import {
  LiveMessages,
  RETIRED_MENU_TEXT,
  finishLiveMessage,
  inferLiveKind,
  retireLiveMessages,
  sendLiveMessage
} from '../src/lib/live-messages.js'
import { fakeSock, silentLogger, testConfig, withLiveMessages } from './helpers.js'

function makeCtx() {
  const store = createStore(testConfig(), silentLogger)
  const sock = fakeSock()
  const replies = []
  const ctx = {
    sock,
    store,
    chatJid: '59891111111@s.whatsapp.net',
    logger: silentLogger,
    replies,
    async reply(text) {
      replies.push(text)
      return sock.sendMessage(this.chatJid, { text })
    },
    async send(text) {
      return this.reply(text)
    }
  }
  return withLiveMessages(ctx, sock)
}

const edits = (sock) => sock.sent.filter((item) => item.content?.edit)
const texts = (sock) => sock.sent.filter((item) => typeof item.content?.text === 'string' && !item.content.edit)

test('LiveMessages guarda, lista y olvida las keys por chat y ranura', () => {
  const store = new LiveMessages()
  const a = store.remember('chat@s.whatsapp.net', 'menu', { key: { id: '1' } })
  assert.equal(a.length, 1)

  store.remember('chat@s.whatsapp.net', 'menu', [{ key: { id: '2' } }, { key: { id: '3' } }])
  assert.deepEqual(
    store.entries('chat@s.whatsapp.net', 'menu').map((entry) => entry.key.id),
    ['2', '3', '1']
  )
  assert.equal(store.entries('otro@s.whatsapp.net', 'menu').length, 0)
  assert.equal(store.entries('chat@s.whatsapp.net', 'pack').length, 0)

  store.forget('chat@s.whatsapp.net', 'menu')
  assert.equal(store.entries('chat@s.whatsapp.net', 'menu').length, 0)

  // No guarda mensajes sin key ni se pasa del límite
  store.remember('chat@s.whatsapp.net', 'x', {})
  for (let i = 0; i < 10; i += 1) store.remember('chat@s.whatsapp.net', 'x', { key: { id: `k${i}` } })
  assert.equal(store.entries('chat@s.whatsapp.net', 'x').length, 5)

  store.clear()
  assert.equal(store.entries('chat@s.whatsapp.net', 'x').length, 0)
})

test('sendLive manda una vez y después edita el mismo mensaje', async () => {
  const ctx = makeCtx()

  const first = await sendLiveMessage(ctx, 'pack', '1/30')
  assert.equal(first.edited, false)
  assert.equal(texts(ctx.sock).length, 1)

  const second = await sendLiveMessage(ctx, 'pack', '2/30')
  assert.equal(second.edited, true)
  assert.equal(texts(ctx.sock).length, 1, 'no manda otro mensaje')
  assert.equal(ctx.replies.length, 1)

  const edit = edits(ctx.sock)[0]
  assert.equal(edit.content.text, '2/30')
  assert.equal(edit.content.edit.id, first.response.key.id)

  const third = await sendLiveMessage(ctx, 'pack', '3/30')
  assert.equal(third.edited, true)
  assert.equal(edits(ctx.sock).at(-1).content.edit.id, first.response.key.id)
})

test('sendLive manda uno nuevo si el mensaje ya no se puede editar', async () => {
  const ctx = makeCtx()
  ctx.store.messages.editWindowMs = 0 // simula un mensaje viejo
  await sendLiveMessage(ctx, 'pack', '1/30')
  const again = await sendLiveMessage(ctx, 'pack', '2/30')
  assert.equal(again.edited, false)
  assert.equal(texts(ctx.sock).length, 2)
})

test('sendLive cae al mensaje nuevo si la edición falla', async () => {
  const ctx = makeCtx()
  await sendLiveMessage(ctx, 'pack', '1/30')
  ctx.sock.sendMessage = async (jid, content) => {
    if (content.edit) throw new Error('no se puede editar')
    ctx.sock.sent.push({ jid, content })
    return { key: { id: 'nuevo' } }
  }
  const result = await sendLiveMessage(ctx, 'pack', '2/30')
  assert.equal(result.edited, false)
  assert.equal(result.response.key.id, 'nuevo')
})

test('retireLive deja los mensajes viejos como "Menu eliminado."', async () => {
  const ctx = makeCtx()
  await sendLiveMessage(ctx, 'menu', 'MENU 1')
  await sendLiveMessage(ctx, 'menu', 'MENU 2') // edita el primero

  const firstKey = ctx.store.messages.entries(ctx.chatJid, 'menu')[0].key
  const retired = await retireLiveMessages(ctx, 'menu')
  assert.equal(retired, 1)
  assert.equal(ctx.store.messages.entries(ctx.chatJid, 'menu').length, 0)

  const edit = edits(ctx.sock).at(-1)
  assert.equal(edit.content.text, RETIRED_MENU_TEXT)
  assert.equal(edit.content.text, 'Menu eliminado.')
  assert.equal(edit.content.edit.id, firstKey.id)
})

test('rememberLive deduce si el mensaje enviado es media (respuesta de Baileys)', () => {
  const store = new LiveMessages()
  store.remember('chat@s.whatsapp.net', 'menu', {
    key: { id: 'foto' },
    message: { imageMessage: { caption: 'menú' } }
  })
  store.remember('chat@s.whatsapp.net', 'menu', {
    key: { id: 'texto' },
    message: { extendedTextMessage: { text: 'menú' } }
  })
  assert.equal(inferLiveKind({ message: { imageMessage: {} } }), 'media')
  assert.equal(inferLiveKind({ message: { conversation: 'hola' } }), 'text')
  assert.equal(inferLiveKind({ key: { id: 'sin-mensaje' } }), 'text')

  const byId = new Map(store.entries('chat@s.whatsapp.net', 'menu').map((entry) => [entry.key.id, entry.kind]))
  assert.equal(byId.get('foto'), 'media')
  assert.equal(byId.get('texto'), 'text')
})

test('retireLive elimina los menús con banner en vez de editarlos a texto', async () => {
  const ctx = makeCtx()
  // El menú por defecto es una foto con el menú como pie: WhatsApp no
  // permite editarla hasta convertirla en "Menu eliminado.", así que
  // intentar editarla dejaba el banner viejo en el chat.
  ctx.store.messages.remember(ctx.chatJid, 'menu', { key: { id: 'banner-1' } }, { kind: 'media' })

  const retired = await retireLiveMessages(ctx, 'menu')
  assert.equal(retired, 1)
  assert.equal(ctx.store.messages.entries(ctx.chatJid, 'menu').length, 0)

  const deletion = ctx.sock.sent.find((item) => item.content?.delete)
  assert.ok(deletion, 'el banner anterior se elimina para todos')
  assert.equal(deletion.content.delete.id, 'banner-1')
  assert.equal(edits(ctx.sock).length, 0, 'no se intenta editar la foto a texto')
})

test('retireLive retira todos: borra el banner y edita el texto a "Menu eliminado."', async () => {
  const ctx = makeCtx()
  // Menú largo: banner y texto van en mensajes separados
  ctx.store.messages.remember(ctx.chatJid, 'menu', { key: { id: 'banner-1' } }, { kind: 'media' })
  ctx.store.messages.remember(ctx.chatJid, 'menu', { key: { id: 'texto-1' } }, { kind: 'text' })
  ctx.store.messages.remember(ctx.chatJid, 'menu', { key: { id: 'texto-2' } }, { kind: 'text' })

  const retired = await retireLiveMessages(ctx, 'menu')
  assert.equal(retired, 3, 'se retiran todos los mensajes del menú anterior')
  assert.equal(ctx.store.messages.entries(ctx.chatJid, 'menu').length, 0)

  const deletions = ctx.sock.sent.filter((item) => item.content?.delete)
  assert.deepEqual(
    deletions.map((item) => item.content.delete.id),
    ['banner-1']
  )
  const editList = edits(ctx.sock)
  assert.deepEqual(
    editList.map((item) => item.content.edit.id).sort(),
    ['texto-1', 'texto-2']
  )
  assert.ok(editList.every((item) => item.content.text === 'Menu eliminado.'))
})

test('retireLive elimina para todos los mensajes demasiado viejos', async () => {
  const ctx = makeCtx()
  const sent = await sendLiveMessage(ctx, 'menu', 'MENU')
  ctx.store.messages.editWindowMs = 0

  const retired = await retireLiveMessages(ctx, 'menu')
  assert.equal(retired, 1)
  const deletion = ctx.sock.sent.find((item) => item.content?.delete)
  assert.ok(deletion, 'se pide eliminar el mensaje')
  assert.equal(deletion.content.delete.id, sent.response.key.id)
})

test('el menú guardado sobrevive a un reinicio y se puede retirar después', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tomioka-live-'))
  try {
    const file = path.join(dir, 'live-messages.json')
    const ctx = makeCtx()
    const jid = ctx.chatJid
    const before = new LiveMessages({ persistFile: file })
    before.remember(jid, 'menu', { key: { id: 'banner-1' } }, { kind: 'media' })
    before.remember(jid, 'menu', { key: { id: 'texto-1' } }, { kind: 'text' })
    // Otras ranuras (packs, debug) son de la sesión: no se persisten
    before.remember(jid, 'pack', { key: { id: 'pack-1' } })

    // Simula apagar y volver a encender el bot
    const after = new LiveMessages({ persistFile: file })
    assert.deepEqual(
      after.entries(jid, 'menu').map((entry) => [entry.key.id, entry.kind]),
      [
        ['texto-1', 'text'],
        ['banner-1', 'media']
      ]
    )
    assert.equal(after.entries(jid, 'pack').length, 0)

    // Y el .menu siguiente los retira: texto editado, banner eliminado
    ctx.store.messages = after
    const retired = await retireLiveMessages(ctx, 'menu')
    assert.equal(retired, 2)
    assert.equal(edits(ctx.sock).at(-1).content.text, 'Menu eliminado.')
    assert.equal(ctx.sock.sent.find((item) => item.content?.delete).content.delete.id, 'banner-1')

    // Al retirarlos también desaparecen del disco
    const restarted = new LiveMessages({ persistFile: file })
    assert.equal(restarted.entries(jid, 'menu').length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('finishLive edita el progreso si es reciente y manda texto si no hay', async () => {
  const ctx = makeCtx()
  await sendLiveMessage(ctx, 'pack', '1/30')
  const done = await finishLiveMessage(ctx, 'pack', '✅ enviado')
  assert.equal(done.edited, true)
  assert.equal(edits(ctx.sock).at(-1).content.text, '✅ enviado')
  assert.equal(ctx.store.messages.entries(ctx.chatJid, 'pack').length, 0)

  const fresh = await finishLiveMessage(ctx, 'pack', '🚫 cancelado')
  assert.equal(fresh.edited, false, 'sin mensaje previo manda uno nuevo')
  assert.equal(ctx.replies.at(-1), '🚫 cancelado')
})
