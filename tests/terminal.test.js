import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  homeList,
  logoLines,
  pal,
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
  highlightMatches,
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
  const filterable = { lines: ['.sticker crea', '.tiktok baja', '.pinterest descarga'], query: 'st', filterable: true, scroll: 0 }
  assert.deepEqual(viewerLines(filterable).lines, ['.sticker crea', '.pinterest descarga'])
  const searchable = { lines: ['uno', 'dos sticker', 'tres'], query: 'sticker', filterable: false, scroll: 0 }
  const result = viewerLines(searchable)
  assert.equal(result.lines.length, 3, 'en búsqueda no se ocultan líneas')
  assert.deepEqual(result.matches, [1])
})

test('la TUI renderiza logo, secciones, estado y ayudas sin terminal real', () => {
  const frame = renderFrame(createState(), fakeEnv(), 110, 32).map((line) => stripAnsi(line))
  const text = frame.join('\n')
  assert.ok(text.includes('██'), 'logo bitono en pantallas amplias')
  assert.ok(text.includes('┃'), 'prompt con borde izquierdo de OpenCode')
  assert.ok(text.includes('sin sesión'))
  assert.ok(text.includes('ctrl+p'), 'ayuda de teclas al pie')
  assert.ok(text.includes('╹'), 'sombra del prompt estilo OpenCode')

  const endState = createState()
  endState.homeQuery = 'tema'
  const endText = renderFrame(endState, fakeEnv(), 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(endText.includes('Cambiar tema'), 'al escribir se filtran las secciones')

  const filtered = createState()
  filtered.homeQuery = 'pairing'
  const filteredText = renderFrame(filtered, fakeEnv(), 110, 32).map((line) => stripAnsi(line)).join('\n')
  assert.ok(filteredText.includes('pairing code'))
  assert.ok(!filteredText.includes('Editar configuración'), 'la home filtra mientras escribes')
  assert.equal(frame.length, 32, 'el frame llena exactamente la pantalla')

  const small = renderFrame(createState(), fakeEnv(), 42, 18).map((line) => stripAnsi(line))
  assert.ok(small.join('\n').includes('⊙'), 'pie de la home estilo OpenCode en pantallas chicas')
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

test('la TUI mantiene sincronizados el render y los controles de edición', () => {
  const env = fakeEnv({ theme: THEMES.opencode })

  const config = createState()
  config.mode = 'config'
  config.configSel = 3
  const configFrame = renderFrame(config, env, 100, 30)
  const selectedLine = configFrame.find((line) => line.includes('Teléfono pairing'))
  assert.ok(selectedLine?.includes('[48;2;250;178;131m'), 'la fila elegida con configSel se ve seleccionada')
  assert.ok(configFrame.map((line) => stripAnsi(line)).join('\n').includes('Enter edita/cambia'))

  const smallConfig = createState()
  smallConfig.mode = 'config'
  smallConfig.configSel = 10
  const smallConfigFrame = renderFrame(smallConfig, env, 50, 14)
  assert.ok(smallConfigFrame.some((line) => line.includes('[48;2;250;178;131m')), 'en pantallas chicas el último campo también se ve seleccionado')

  const input = createState()
  input.overlay = 'input'
  input.input = { kind: 'field', title: '✏️ Nombre del bot', hint: 'Nombre visible', field: { label: 'Nombre del bot', about: 'Se ve en el menú' } }
  input.buffer = 'TomiOka Nuevo'
  input.inputCursor = input.buffer.length
  input.fieldError = 'Error de prueba'
  const inputText = renderFrame(input, env, 100, 30).map((line) => stripAnsi(line)).join('\n')
  assert.ok(inputText.includes('Nombre del bot'), 'el editor muestra su título')
  assert.ok(inputText.includes('TomiOka Nuevo'), 'el editor muestra el texto que se está escribiendo')
  assert.ok(inputText.includes('Error de prueba'), 'el editor muestra errores de validación')
  assert.deepEqual(Object.values(input.hit), [], 'un diálogo abierto no deja clics hacia la pantalla de atrás')

  const longInput = createState()
  longInput.overlay = 'input'
  longInput.input = { kind: 'field', title: 'Editar URL', hint: '', field: { label: 'URL' } }
  longInput.buffer = `https://example.com/${'a'.repeat(90)}`
  longInput.inputCursor = [...longInput.buffer].length
  const longInputText = renderFrame(longInput, env, 80, 24).map((line) => stripAnsi(line)).join('\n')
  assert.ok(longInputText.includes('…'), 'un texto largo se desplaza y mantiene visible el final')

  const session = createState()
  session.mode = 'session'
  session.sessionSel = 1
  const sessionText = renderFrame(session, env, 100, 30).map((line) => stripAnsi(line)).join('\n')
  assert.ok(sessionText.includes('Sesión y respaldos'))
  assert.ok(sessionText.includes('Crear respaldo de la sesión'))
  assert.ok(sessionText.includes('Borrar sesión'))

  const viewer = createState()
  viewer.mode = 'viewer'
  viewer.viewer = { title: 'Comandos', kind: 'commands', filterable: true, scroll: 0, query: 'sticker', searching: false, lines: ['.sticker crea', '.tiktok baja'] }
  const viewerText = renderFrame(viewer, env, 100, 30).map((line) => stripAnsi(line)).join('\n')
  assert.ok(viewerText.includes('.sticker crea'), 'el visor usa state.viewer')
  assert.ok(!viewerText.includes('.tiktok baja'), 'el visor filtra comandos')

  const confirm = createState()
  confirm.overlay = 'confirm'
  confirm.confirm = { title: 'Borrar', body: '¿Seguro que quieres borrar?', okLabel: 'Borrar sesión' }
  const confirmText = renderFrame(confirm, env, 100, 30).map((line) => stripAnsi(line)).join('\n')
  assert.ok(confirmText.includes('¿Seguro que quieres borrar?'), 'la confirmación muestra su mensaje')
  const confirmButtons = Object.values(confirm.hit).flat().filter((hit) => hit.kind === 'confirm-btn')
  assert.deepEqual(confirmButtons.map((hit) => hit.which), [0, 1], 'ambos botones son clicables por separado')

  const consoleState = createState()
  consoleState.mode = 'console'
  consoleState.follow = false
  consoleState.botScroll = 5
  const consoleEnv = fakeEnv({ bot: { running: true, title: 'Bot', lines: Array.from({ length: 30 }, (_, i) => `log ${i}`) } })
  const consoleText = renderFrame(consoleState, consoleEnv, 80, 24).map((line) => stripAnsi(line)).join('\n')
  assert.ok(consoleText.includes('log 5'), 'la consola respeta botScroll')
  assert.ok(!consoleText.includes('log 29'), 'la consola no salta sola al final al hacer scroll')

  assert.ok(highlightMatches('hola sticker', 'sticker', pal(THEMES.opencode)).includes('[48;2;250;178;131m'), 'la búsqueda resalta coincidencias')
  assert.deepEqual(
    filterActions([{ title: 'Editar · Nombre del bot', description: 'El nombre visible del bot' }], 'nombre visible').length,
    1,
    'la paleta también busca en las descripciones'
  )
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
  state.homeQuery = 'sesion'
  assert.equal(homeList(state)[0].id, 'session', 'buscar sin acentos también encuentra «Sesión»')
  state.homeQuery = 'zzz-sin-resultado'
  assert.equal(homeList(state).length, 0)
})

test('logoLines dibuja el logo bitono y pal trae la paleta OpenCode', () => {
  const lines = logoLines(THEMES.opencode, 100).map((line) => stripAnsi(line))
  assert.equal(lines.length, 4)
  assert.ok(lines[2].includes('██'), 'bloques del logo')
  assert.deepEqual(pal(THEMES.opencode).primary, [250, 178, 131], 'primary de OpenCode #fab283')
  assert.deepEqual(pal(THEMES.opencode).bg, [10, 10, 10], 'fondo de OpenCode #0a0a0a')
})

test('parseKeys reconoce la tecla líder ctrl+x', () => {
  assert.deepEqual(parseKeys('\x18').map((k) => k.name), ['ctrl-x'])
})

test('parseKeys reconoce Ctrl+H, Delete y atajos de edición', () => {
  assert.deepEqual(parseKeys('\b\x1b[3~\x01\x05\x0e').map((k) => k.name), ['backspace', 'delete', 'ctrl-a', 'ctrl-e', 'ctrl-n'])
  assert.deepEqual(parseKeys('\x1bOA\x1bOB').map((k) => k.name), ['up', 'down'], 'también acepta flechas SS3 de algunos Termux')
})

test('el pairing se hace escribiendo el número en la consola (sin QR)', () => {
  const source = readFileSync(new URL('../scripts/terminal.js', import.meta.url), 'utf8')
  assert.ok(source.includes("TOMIOKA_CONSOLE: '1'"), 'la consola avisa al bot que puede preguntar')
  assert.ok(source.includes("spawnConsole('Vincular · pairing code'"), 'pairing arranca directo en la consola')
  assert.ok(!source.includes("kind: 'pair'"), 'ya no hay diálogo previo de número')
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
