import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  homeList,
  applyConfigEdit,
  normalizeOwners,
  parseKeys,
  renderFrame,
  createState,
  editFields,
  textWidth,
  clip,
  pad,
  gradient,
  fuzzyScore,
  filterActions,
  LogBuffer,
  diffRows,
  viewerLines,
  paletteList,
  THEMES,
  MENU_ITEMS
} from '../scripts/terminal.js'
import { stripAnsi } from '../src/lib/colors.js'
import { inspectSession } from '../src/lib/session.js'
import { testConfig } from './helpers.js'

const fakeEnv = (extra = {}) => ({
  config: testConfig(),
  session: inspectSession('no-existe-sesion-tomioka'),
  theme: THEMES.ocean,
  bot: { running: false, title: '', lines: [] },
  actions: [],
  ...extra
})

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
  assert.equal(cfg.menu?.image, undefined)
  applyConfigEdit(cfg, 'menuImage', 'https://example.com/banner.jpg')
  assert.equal(cfg.menu.image, 'https://example.com/banner.jpg')
  applyConfigEdit(cfg, 'menuImage', '')
  assert.equal(cfg.menu.image, '', 'banner vacío = sin banner')
})

test('applyConfigEdit maneja los interruptores del menú (sí/no)', () => {
  const cfg = {}
  applyConfigEdit(cfg, 'sendAsCaption', 'no')
  assert.equal(cfg.menu.sendAsCaption, false)
  applyConfigEdit(cfg, 'sendAsCaption', 'sí')
  assert.equal(cfg.menu.sendAsCaption, true)
  applyConfigEdit(cfg, 'showDescriptions', true)
  assert.equal(cfg.menu.showDescriptions, true)
  assert.throws(() => applyConfigEdit(cfg, 'sendAsCaption', 'quizás'), /sí\/no/)
})

test('applyConfigEdit rechaza valores inválidos', () => {
  assert.throws(() => applyConfigEdit({}, 'name', '  '), /no puede estar vacío/)
  assert.throws(() => applyConfigEdit({}, 'prefix', 'a b'), /Prefijo inválido/)
  assert.throws(() => applyConfigEdit({}, 'pairingPhone', '123'), /teléfono debe tener/i)
  assert.throws(() => applyConfigEdit({}, 'login', 'whatsapp'), /login inválido/i)
  assert.throws(() => applyConfigEdit({}, 'otra', 'x'), /no editable/i)
})

test('normalizeOwners limpia formato y filtra inválidos', () => {
  assert.deepEqual(normalizeOwners('+598 99 123 456, 5215512345678; 123'), ['59899123456', '5215512345678'])
  assert.deepEqual(normalizeOwners(''), [])
})

test('textWidth, clip y pad miden ancho visible (emoji = 2)', () => {
  assert.equal(textWidth('hola'), 4)
  assert.equal(textWidth('🌊'), 2)
  assert.equal(clip('123456', 3), '123')
  assert.equal(pad('ab', 5), 'ab   ')
})

test('gradient pinta truecolor sin cambiar el texto visible', () => {
  const painted = gradient('TomiOka', THEMES.ocean)
  assert.ok(painted.includes('38;2;'), 'usa colores truecolor')
  assert.equal(stripAnsi(painted), 'TomiOka')
})

test('parseKeys interpreta flechas, enter, ctrl+p, mouse y rueda', () => {
  assert.deepEqual(parseKeys('\x1b[B').map((k) => k.name), ['down'])
  assert.deepEqual(parseKeys('\x10').map((k) => k.name), ['ctrl-p'])
  assert.deepEqual(parseKeys('\r').map((k) => k.name), ['enter'])
  const click = parseKeys('\x1b[<0;10;5M')[0]
  assert.equal(click.name, 'mouse')
  assert.equal(click.x, 10)
  assert.equal(click.y, 5)
  assert.equal(parseKeys('\x1b[<64;3;3M')[0].button, 64, 'rueda hacia arriba')
  assert.deepEqual(parseKeys('j\x1b[B').map((k) => k.name), ['char', 'down'])
})

test('fuzzyScore y filterActions encuentran acciones escribiendo poco', () => {
  const actions = [
    { title: 'Editar configuración', hint: 'nombre y prefijo' },
    { title: 'Vincular · pairing code', hint: 'código' },
    { title: 'Estado del bot', hint: 'sesión' }
  ]
  assert.ok(fuzzyScore('pair', 'Vincular · pairing code') > 0)
  assert.equal(fuzzyScore('zzz', 'Estado del bot'), -1)
  assert.equal(filterActions(actions, 'pair')[0].title, 'Vincular · pairing code')
  assert.equal(filterActions(actions, '').length, 3)
})

test('LogBuffer arma líneas desde chunks, respeta \\r y recorta', () => {
  const buffer = new LogBuffer(3)
  buffer.push('hola ')
  buffer.push('mundo\nsegunda\n')
  assert.deepEqual(buffer.view(), ['hola mundo', 'segunda'])
  buffer.push('progreso 10%\rprogreso 80%\n')
  assert.ok(buffer.view().includes('progreso 80%'))
  buffer.push('a\nb\nc\nd\n')
  assert.equal(buffer.view().length, 3, 'se queda con las últimas líneas')
  buffer.clear()
  assert.deepEqual(buffer.view(), [])
})

test('diffRows detecta solo las filas que cambian', () => {
  assert.deepEqual(diffRows(['a', 'b', 'c'], ['a', 'B', 'c']), [{ row: 1, text: 'B' }])
  assert.deepEqual(diffRows(['a'], ['a']), [])
})

test('viewerLines filtra comandos y marca coincidencias en vistas de texto', () => {
  const filterable = { lines: ['.sticker crea', '.tiktok baja', '.steal roba'], query: 'st', filterable: true, scroll: 0 }
  assert.deepEqual(viewerLines(filterable).lines, ['.sticker crea', '.steal roba'])
  const searchable = { lines: ['uno', 'dos sticker', 'tres'], query: 'sticker', filterable: false, scroll: 0 }
  const result = viewerLines(searchable)
  assert.equal(result.lines.length, 3, 'en búsqueda no se ocultan líneas')
  assert.deepEqual(result.matches, [1])
})

test('la TUI renderiza logo, secciones, estado y ayudas sin terminal real', () => {
  const frame = renderFrame(createState(), fakeEnv(), 110, 32).map((line) => stripAnsi(line))
  const text = frame.join('\n')
  assert.ok(text.includes('████████'), 'logo grande en pantallas amplias')
  assert.ok(text.includes('Iniciar el bot'))
  assert.ok(text.includes('Editar configuración'))
  assert.ok(text.includes('sin sesión'))
  assert.ok(text.includes('ctrl+p'), 'ayuda de teclas al pie')
  assert.ok(text.includes('Escribí para buscar'), 'prompt de la home estilo OpenCode')

  const endState = createState()
  endState.sel = MENU_ITEMS.length - 1
  const endText = renderFrame(endState, fakeEnv(), 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(endText.includes('Cambiar tema'), 'al bajar se ven las últimas secciones')

  const filtered = createState()
  filtered.homeQuery = 'pairing'
  const filteredText = renderFrame(filtered, fakeEnv(), 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(filteredText.includes('pairing code'))
  assert.ok(!filteredText.includes('Editar configuración'), 'la home filtra mientras escribes')
  assert.equal(frame.length, 32, 'el frame llena exactamente la pantalla')

  const small = renderFrame(createState(), fakeEnv(), 42, 18).map((line) => stripAnsi(line))
  assert.ok(small.join('\n').includes('🌊 TomiOka'), 'cabecera compacta en pantallas chicas')
  assert.equal(small.length, 18)
})

test('la TUI renderiza la consola en vivo con sus logs', () => {
  const state = createState()
  state.mode = 'console'
  const env = fakeEnv({ bot: { running: true, title: 'Bot de TomiOka', lines: ['línea uno', 'código de vinculación: 1234-5678'] } })
  const text = renderFrame(state, env, 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(text.includes('Bot de TomiOka'))
  assert.ok(text.includes('código de vinculación: 1234-5678'), 'el pairing se lee en la consola')
})

test('la TUI renderiza paleta, editor con interruptores, confirmación y ayuda', () => {
  const env = fakeEnv({ actions: [{ title: 'Iniciar el bot', hint: 'consola', run() {} }] })

  const palette = createState()
  palette.overlay = 'palette'
  const paletteText = renderFrame(palette, env, 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(paletteText.includes('Paleta de comandos'))
  assert.equal(paletteList(palette, env).length, 1)

  const config = createState()
  config.mode = 'config'
  const configText = renderFrame(config, env, 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(configText.includes('Nombre del bot'))
  assert.ok(configText.includes('Menú como pie de foto'), 'interruptor nuevo visible')

  const confirm = createState()
  confirm.overlay = 'confirm'
  confirm.confirm = { title: 'Borrar', body: '¿Seguro?', okLabel: 'Borrar sesión' }
  const confirmText = renderFrame(confirm, env, 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(confirmText.includes('Borrar sesión'))
  assert.ok(confirmText.includes('Cancelar'))

  const help = createState()
  help.overlay = 'help'
  const helpText = renderFrame(help, env, 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(helpText.includes('Atajos de teclado'))
})

test('editFields refleja valores e interruptores de la config', () => {
  const config = testConfig()
  const fields = editFields(config)
  const byId = Object.fromEntries(fields.map((field) => [field.id, field]))
  assert.equal(byId.name.raw, config.bot.name)
  assert.deepEqual(byId.login.cycle, ['ask', 'pairing', 'qr'])
  assert.deepEqual(byId.sendAsCaption.cycle, ['sí', 'no'])
  assert.deepEqual(byId.showDescriptions.cycle, ['sí', 'no'])
})

test('homeList filtra las secciones de la home y createState trae lo nuevo', () => {
  const state = createState()
  assert.equal(state.homeQuery, '')
  assert.equal(state.leader, false)
  assert.equal(homeList(state).length, MENU_ITEMS.length)
  state.homeQuery = 'tema'
  assert.equal(homeList(state)[0].id, 'theme', 'el tema sale primero al escribir "tema"')
  state.homeQuery = 'zzz-sin-resultado'
  assert.equal(homeList(state).length, 0)
})

test('parseKeys reconoce la tecla líder ctrl+x', () => {
  assert.deepEqual(parseKeys('\x18').map((k) => k.name), ['ctrl-x'])
})

test('la terminal queda expuesta como script npm y cubre las acciones del bot', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.terminal, 'node scripts/terminal.js')
  const source = readFileSync(new URL('../scripts/terminal.js', import.meta.url), 'utf8')
  for (const needle of ['Iniciar el bot', 'pairing code', 'Editar configuración', 'Menú de WhatsApp', 'Diagnóstico', 'Borrar sesión', 'Paleta de comandos']) {
    assert.ok(source.includes(needle), `falta: ${needle}`)
  }
  assert.ok(MENU_ITEMS.length >= 12, 'la TUI tiene todas las secciones')
})
