import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyConfigEdit, normalizeOwners } from '../scripts/terminal.js'

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

test('la terminal queda expuesta como script npm y cubre las acciones del bot', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.terminal, 'node scripts/terminal.js')
  const source = readFileSync(new URL('../scripts/terminal.js', import.meta.url), 'utf8')
  for (const needle of ['Iniciar el bot', 'pairing code', 'Editar configuración', 'Ver el menú de WhatsApp', 'Diagnóstico', 'Borrar sesión']) {
    assert.ok(source.includes(needle), `falta la acción: ${needle}`)
  }
})
