import test from 'node:test'
import assert from 'node:assert/strict'
import {
  boldDigits,
  extractEmojis,
  formatDuration,
  jidToNumber,
  parseCommand,
  splitGraphemes,
  splitNameAuthor,
  truncate
} from '../src/lib/text.js'

test('parseCommand detecta prefijo, comando y argumentos', () => {
  const parsed = parseCommand('.sticker hola mundo', ['.'])
  assert.equal(parsed.prefix, '.')
  assert.equal(parsed.command, 'sticker')
  assert.deepEqual(parsed.args, ['hola', 'mundo'])
  assert.equal(parsed.argsText, 'hola mundo')
})

test('parseCommand es insensible a mayúsculas', () => {
  assert.equal(parseCommand('.TaKe Nombre', ['.']).command, 'take')
})

test('parseCommand acepta varios prefijos y el más largo', () => {
  assert.equal(parseCommand('!help', ['.', '!']).command, 'help')
  assert.equal(parseCommand('!!help', ['!', '!!']).prefix, '!!')
})

test('parseCommand ignora textos sin prefijo o vacíos', () => {
  assert.equal(parseCommand('hola', ['.']), null)
  assert.equal(parseCommand('', ['.']), null)
  assert.equal(parseCommand('.', ['.']), null)
  assert.equal(parseCommand('. help', ['.']), null)
})

test('splitNameAuthor separa nombre y autor con |', () => {
  assert.deepEqual(splitNameAuthor('Mi pack | Tomi'), { name: 'Mi pack', author: 'Tomi' })
  assert.deepEqual(splitNameAuthor('Solo nombre', { name: 'x', author: 'y' }), {
    name: 'Solo nombre',
    author: 'y'
  })
  assert.deepEqual(splitNameAuthor('', { name: 'x', author: 'y' }), { name: 'x', author: 'y' })
  assert.deepEqual(splitNameAuthor('A | B | C'), { name: 'A', author: 'B | C' })
})

test('boldDigits convierte números aesthetic', () => {
  assert.equal(boldDigits('01'), '𝟎𝟏')
  assert.equal(boldDigits(2026), '𝟐𝟎𝟐𝟔')
  assert.equal(boldDigits('a1'), 'a𝟏')
})

test('extractEmojis ignora texto y conserva emojis compuestos', () => {
  assert.deepEqual(extractEmojis('😺 🐼'), ['😺', '🐼'])
  assert.deepEqual(extractEmojis('hola 123'), [])
  assert.deepEqual(extractEmojis('❤️'), ['❤️'])
  assert.equal(splitGraphemes('👨‍👩‍👧').length, 1)
})

test('jidToNumber limpia el JID', () => {
  assert.equal(jidToNumber('59891234567:12@s.whatsapp.net'), '59891234567')
  assert.equal(jidToNumber('120363000000000000@g.us'), '120363000000000000')
})

test('truncate y formatDuration', () => {
  assert.equal(truncate('abcdef', 4), 'abc…')
  assert.equal(truncate('abc', 4), 'abc')
  assert.equal(formatDuration(65), '1m 05s')
  assert.equal(formatDuration(9), '9s')
})
