import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyConfigEdit,
  normalizeOwners,
  parseKeys,
  renderFrame,
  createState,
  editFields,
  textWidth,
  clip,
  pad,
  MENU_ITEMS
} from '../scripts/terminal.js'
import { stripAnsi } from '../src/lib/colors.js'
import { inspectSession } from '../src/lib/session.js'
import { testConfig } from './helpers.js'

test('applyConfigEdit edita nombre, team y prefijo', () => {
  const cfg = {}
  applyConfigEdit(cfg, 'name', 'TomiOka')
  applyConfigEdit(cfg, 'team', '© TomiOka')
  applyConfigEdit(cfg, 'prefix', '!')
  assert.equal(cfg.bot.name, 'TomiOka')
  assert.equal(cfg.bot.team, '© TomiOka')
  assert.equal(cfg.bot.prefix, '!')
})

test('applyConfigEdit edita pairing, owners, login, pack y banner', () => {
  const cfg = {}
  applyConfigEdit(cfg, 'pairingPhone', '+598 99 123 456')
  assert.equal(cfg.pairingPhone, '59899123456')
  applyConfigEdit(cfg, 'owners', '59899123456, 5215512345678')
  assert.deepEqual(cfg.owner.numbers, ['59899123456', '5215512345678'])
  applyConfigEdit(cfg, 'login', 'qr')
  assert.equal(cfg.login, 'qr')
  applyConfigEdit(cfg, 'packName', 'TomiOka Stickers')
  applyConfigEdit(cfg, 'packAuthor', 'TomiOka')
  assert.equal(cfg.stickers.packName, 'TomiOka Stickers')
  assert.equal(cfg.stickers.packAuthor, 'TomiOka')
  applyConfigEdit(cfg, 'menuImage', 'https://example.com/banner.jpg')
  assert.equal(cfg.menu.image, 'https://example.com/banner.jpg')
  applyConfigEdit(cfg, 'menuImage', '')
  assert.equal(cfg.menu.image, '', 'banner vacío = sin banner')
})

test('applyConfigEdit rechaza valores inválidos', () => {
  assert.throws(() => applyConfigEdit({}, 'name', '  '), /no puede estar vacío/)
  assert.throws(() => applyConfigEdit({}, 'prefix', 'a b'), /Prefijo inválido/)
  assert.throws(() => applyConfigEdit({}, 'prefix', ''), /Prefijo inválido/)
  assert.throws(() => applyConfigEdit({}, 'pairingPhone', '123'), /teléfono debe tener/i)
  assert.throws(() => applyConfigEdit({}, 'login', 'whatsapp'), /login inválido/i)
  assert.throws(() => applyConfigEdit({}, 'otra', 'x'), /no editable/i)
})

test('normalizeOwners limpia formato y filtra inválidos', () => {
  assert.deepEqual(
    normalizeOwners('+598 99 123 456, 5215512345678; 123'),
    ['59899123456', '5215512345678']
  )
  assert.deepEqual(normalizeOwners(''), [])
})

test('textWidth, clip y pad miden ancho visible (emoji = 2)', () => {
  assert.equal(textWidth('hola'), 4)
  assert.equal(textWidth('🌊'), 2)
  assert.equal(clip('123456', 3), '123')
  assert.equal(pad('ab', 5), 'ab   ')
})

test('parseKeys interpreta flechas, enter, esc y caracteres', () => {
  assert.deepEqual(parseKeys('\x1b[B').map((k) => k.name), ['down'])
  assert.deepEqual(parseKeys('\x1b[A').map((k) => k.name), ['up'])
  assert.deepEqual(parseKeys('\r').map((k) => k.name), ['enter'])
  assert.deepEqual(parseKeys('\x1b').map((k) => k.name), ['escape'])
  assert.deepEqual(parseKeys('\x1b[6~').map((k) => k.name), ['pagedown'])
  assert.deepEqual(parseKeys('q').map((k) => k.char), ['q'])
  assert.deepEqual(parseKeys('j\x1b[B').map((k) => k.name), ['char', 'down'])
})

test('la TUI renderiza logo, secciones, estado y ayudas sin terminal real', () => {
  const config = testConfig()
  const env = { config, session: inspectSession('no-existe-sesion-tomioka') }
  const frame = renderFrame(createState(), env, 100, 30).map((line) => stripAnsi(line))

  const text = frame.join('\n')
  assert.ok(text.includes('████████'), 'logo grande en pantallas amplias')
  assert.ok(text.includes('Iniciar el bot'))
  assert.ok(text.includes('Editar configuración'))
  assert.ok(text.includes('Menú de WhatsApp'))
  assert.ok(text.includes('sin sesión'))
  assert.ok(text.includes('q salir'), 'ayuda de teclas al pie')
  assert.equal(frame.length, 30, 'el frame llena exactamente la pantalla')

  const small = renderFrame(createState(), env, 40, 16).map((line) => stripAnsi(line))
  assert.ok(small.join('\n').includes('🌊 TomiOka'), 'cabecera compacta en pantallas chicas')
  assert.equal(small.length, 16)
})

test('la TUI renderiza el editor, el input y el diálogo de borrar sesión', () => {
  const config = testConfig()
  const env = { config, session: inspectSession('no-existe-sesion-tomioka') }

  const edit = createState()
  edit.mode = 'edit'
  const editText = renderFrame(edit, env, 100, 30).map((line) => stripAnsi(line)).join('\n')
  assert.ok(editText.includes('Nombre del bot'))
  assert.ok(editText.includes('Banner del menú'))

  const input = createState()
  input.mode = 'input'
  input.field = editFields(config)[0]
  input.buffer = 'TomiOka'
  const inputText = renderFrame(input, env, 100, 30).map((line) => stripAnsi(line)).join('\n')
  assert.ok(inputText.includes('Nombre del bot: TomiOka'))

  const confirm = createState()
  confirm.mode = 'confirm'
  const confirmText = renderFrame(confirm, env, 100, 30).map((line) => stripAnsi(line)).join('\n')
  assert.ok(confirmText.includes('Borrar la sesión de WhatsApp'))
  assert.ok(confirmText.includes('Cancelar'))
})

test('editFields refleja los valores actuales de la config', () => {
  const config = testConfig()
  const fields = editFields(config)
  const byId = Object.fromEntries(fields.map((field) => [field.id, field]))
  assert.equal(byId.name.raw, config.bot.name)
  assert.equal(byId.prefix.raw, config.prefixes[0])
  assert.deepEqual(byId.login.cycle, ['ask', 'pairing', 'qr'])
  assert.equal(byId.owners.raw, config.owner.numbers.join(', '))
})

test('la terminal queda expuesta como script npm y cubre las acciones del bot', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.terminal, 'node scripts/terminal.js')
  const source = readFileSync(new URL('../scripts/terminal.js', import.meta.url), 'utf8')
  for (const needle of ['Iniciar el bot', 'pairing code', 'Editar configuración', 'Menú de WhatsApp', 'Diagnóstico', 'Borrar sesión']) {
    assert.ok(source.includes(needle), `falta la acción: ${needle}`)
  }
  assert.ok(MENU_ITEMS.length >= 10, 'la TUI tiene todas las secciones')
})
