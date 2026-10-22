import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULTS,
  deepMerge,
  isValidPhone,
  loadConfig,
  normalizeLoginMode,
  normalizePhone,
  normalizePrefixes
} from '../src/config.js'

test('deepMerge respeta objetos anidados y reemplaza arrays', () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] }
  const extra = { nested: { y: 3 }, list: [9] }
  assert.deepEqual(deepMerge(base, extra), { a: 1, nested: { x: 1, y: 3 }, list: [9] })
  assert.deepEqual(base, { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] }, 'no muta la base')
})

test('normalizePrefixes acepta string y arrays', () => {
  assert.deepEqual(normalizePrefixes('.'), ['.'])
  assert.deepEqual(normalizePrefixes(['.', '!', '.']), ['.', '!'])
  assert.deepEqual(normalizePrefixes([]), ['.'])
  assert.deepEqual(normalizePrefixes(['  ', '/']), ['/'])
})

test('normalizePhone limpia signos y prefijo 00', () => {
  assert.equal(normalizePhone('+598 91 234 567'), '59891234567')
  assert.equal(normalizePhone('00598 91 234 567'), '59891234567')
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone(undefined), '')
})

test('isValidPhone valida largos razonables', () => {
  assert.equal(isValidPhone('59891234567'), true)
  assert.equal(isValidPhone('123'), false)
  assert.equal(isValidPhone('12345678901234567890'), false)
})

test('normalizeLoginMode entiende variantes', () => {
  assert.equal(normalizeLoginMode('pair'), 'pairing')
  assert.equal(normalizeLoginMode('PAIRING'), 'pairing')
  assert.equal(normalizeLoginMode('qr'), 'qr')
  assert.equal(normalizeLoginMode('cualquier-cosa'), 'ask')
  assert.equal(normalizeLoginMode(undefined), 'ask')
})

test('loadConfig mezcla defaults, config.json y normaliza', () => {
  const config = loadConfig()
  assert.equal(config.prefixes[0], '.')
  assert.equal(typeof config.bot.name, 'string')
  assert.ok(Array.isArray(config.menu.categories))
  assert.equal(config.menu.categories.length, 6)
  assert.deepEqual(config.menu.categories[0].commands, ['tiktok', 'instagram', 'pinterest', 'ytmp3', 'ytmp4'])
  assert.deepEqual(config.menu.categories[1].commands, ['brat', 'attp', 'ttp', 'sticker', 'gif', 'emojimix'])
  assert.deepEqual(config.menu.categories[2].commands, ['toimg', 'tovideo', 'take'])
  assert.deepEqual(config.menu.categories[3].commands, ['pack'])
  assert.deepEqual(config.menu.categories[4].commands, ['gemini', 'chatgpt', 'deepseek'])
  assert.deepEqual(config.menu.categories[5].commands, ['help', 'debug'])
  assert.ok(config.paths.session.endsWith('sessions'))
  assert.equal(config.stickers.size, 512)
  assert.equal(typeof DEFAULTS.stickers.maxStaticKB, 'number')
})

test('loadConfig respeta BOT_PREFIX y SESSION_DIR', () => {
  const previous = { prefix: process.env.BOT_PREFIX, dir: process.env.SESSION_DIR }
  process.env.BOT_PREFIX = '#'
  process.env.SESSION_DIR = 'tmp-session-test'
  try {
    const config = loadConfig()
    assert.deepEqual(config.prefixes, ['#'])
    assert.ok(config.sessionDir.endsWith('tmp-session-test'))
  } finally {
    if (previous.prefix === undefined) delete process.env.BOT_PREFIX
    else process.env.BOT_PREFIX = previous.prefix
    if (previous.dir === undefined) delete process.env.SESSION_DIR
    else process.env.SESSION_DIR = previous.dir
  }
})
