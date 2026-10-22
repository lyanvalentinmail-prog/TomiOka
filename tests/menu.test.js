import test from 'node:test'
import assert from 'node:assert/strict'
import { commands, commandList, findCommand } from '../src/commands/index.js'
import { buildCommandHelp, buildMenu, resolveCategoryCommands } from '../src/menu.js'
import { testConfig } from './helpers.js'

const config = testConfig()

test('todos los comandos pedidos existen', () => {
  for (const name of [
    'tiktok',
    'instagram',
    'ytmp3',
    'ytmp4',
    'brat',
    'attp',
    'ttp',
    'sticker',
    'gif',
    'toimg',
    'tovideo',
    'take',
    'steal',
    'emojimix',
    'pack',
    'help'
  ]) {
    assert.ok(findCommand(name), `falta el comando ${name}`)
    assert.equal(typeof findCommand(name).run, 'function')
  }
})

test('los alias apuntan al mismo comando', () => {
  assert.equal(findCommand('menu'), findCommand('help'))
  assert.equal(findCommand('s'), findCommand('sticker'))
  assert.equal(findCommand('noexiste'), null)
})

test('el menú usa cinco categorías con TODOS los comandos visibles', () => {
  assert.equal(config.menu.categories.length, 5)
  const [downloads, stickers, conversion, packs, info] = config.menu.categories
  assert.deepEqual(downloads.commands, ['tiktok', 'instagram', 'ytmp3', 'ytmp4'])
  assert.deepEqual(stickers.commands, ['brat', 'attp', 'ttp', 'sticker', 'gif', 'emojimix', 'steal'])
  assert.deepEqual(conversion.commands, ['toimg', 'tovideo', 'take'])
  assert.deepEqual(packs.commands, ['pack'])
  assert.deepEqual(info.commands, ['help'])
  assert.deepEqual(
    resolveCategoryCommands(downloads, commands).map((command) => command.name),
    ['tiktok', 'instagram', 'ytmp3', 'ytmp4']
  )
  assert.deepEqual(
    resolveCategoryCommands(stickers, commands).map((command) => command.name),
    ['brat', 'attp', 'ttp', 'sticker', 'gif', 'emojimix', 'steal']
  )

  // Cada comando visible aparece exactamente una vez en alguna categoría
  const allListed = config.menu.categories.flatMap((category) =>
    resolveCategoryCommands(category, commands).map((command) => command.name)
  )
  const expected = commandList.filter((command) => !command.hidden).map((command) => command.name)
  assert.deepEqual([...allListed].sort(), [...expected].sort())
  assert.equal(new Set(allListed).size, allListed.length, 'sin duplicados')
})

test('resolveCategoryCommands filtra por nombre y evita duplicados', () => {
  const resolved = resolveCategoryCommands(
    { commands: ['sticker', 's', 'STICKER', 'inexistente', 'help'] },
    commands
  )
  assert.deepEqual(
    resolved.map((command) => command.name),
    ['sticker', 'help']
  )
})

test('el menú incluye la info del bot y todos los comandos', () => {
  const menu = buildMenu({ config, commands, sender: { label: 'Tester' } })
  assert.ok(menu.includes(config.bot.name))
  assert.ok(menu.includes(config.bot.team))
  assert.ok(menu.includes('𝓜𝓮𝓷𝓾 𝓭𝓮 𝓬𝓸𝓶𝓪𝓷𝓭𝓸𝓼'))
  assert.ok(menu.includes('𝕰𝐍𝐃 𝐎𝐅 𝐌𝐄𝐍𝐔'))
  assert.ok(menu.includes('𝖾𝗌𝗍.'))
  for (const name of ['tiktok', 'instagram', 'ytmp3', 'ytmp4', 'brat', 'attp', 'ttp', 'sticker']) {
    assert.ok(menu.includes(`${config.prefixes[0]}${name}`), `el menú no muestra ${name}`)
  }
  assert.ok(menu.length > 500)
})

test('el menú no tiene líneas vacías ni espacios sobrantes', () => {
  const menu = buildMenu({ config, commands, sender: { label: 'Tester' } })
  const lines = menu.split('\n')
  assert.equal(lines.filter((line) => line.trim() === '').length, 0, 'no hay líneas en blanco')
  assert.equal(lines.filter((line) => line !== line.trimEnd()).length, 0, 'no hay espacios al final')
  assert.ok(!/\n\s*\n/.test(menu), 'no hay saltos dobles')
})

test('el menú muestra solo el comando, sin descripciones', () => {
  const menu = buildMenu({ config, commands, sender: {} })
  const listed = config.menu.categories.flatMap((category) => resolveCategoryCommands(category, commands))
  const visibleCount = commandList.filter((command) => !command.hidden).length
  assert.equal(listed.length, visibleCount, 'todos los comandos visibles')
  for (const command of listed) {
    assert.ok(menu.includes(`୨ৎㅤ${config.prefixes[0]}${command.name}`), `falta ${command.name}`)
    if (command.description) {
      assert.ok(!menu.includes(command.description), `no debe mostrarse la descripción de ${command.name}`)
    }
  }
  // Todos los comandos visibles se listan (antes solo salían 8)
  const commandLines = menu.split('\n').filter((line) => line.startsWith('୨ৎ'))
  for (const name of ['gif', 'toimg', 'tovideo', 'take', 'steal', 'emojimix', 'pack', 'help']) {
    assert.ok(commandLines.some((line) => line.includes(`${config.prefixes[0]}${name} `) || line.trimEnd().endsWith(`${config.prefixes[0]}${name}`)), `${name} debe listarse`)
  }
  assert.ok(!commandLines.some((line) => line.includes(`${config.prefixes[0]}debug`)), 'debug es oculto y no se lista')
  assert.ok(!menu.includes('›'), 'no usa el separador de descripción')
})

test('el menú agrupa todos los comandos en cinco categorías', () => {
  const menu = buildMenu({ config, commands, sender: {} })
  assert.equal((menu.match(/◢ /g) || []).length, 5, 'cinco bloques de categoría')
  assert.equal((menu.match(/𝕮𝖆𝖙𝖊𝖌𝖔𝖗𝖎𝖆/g) || []).length, 5)
  const commandLines = menu.split('\n').filter((line) => line.startsWith('୨ৎ'))
  const visibleCount = commandList.filter((command) => !command.hidden).length
  assert.equal(commandLines.length, visibleCount, 'una línea por comando, sin separación')
})

test('el menú respeta las categorías configuradas', () => {
  const custom = testConfig({
    menu: {
      ...config.menu,
      categories: [
        { emoji: '🌊', description: 'Solo sticker', kaomoji: '( ˶ˆ꒳ˆ˵ )', divider: ['💧', '🌊'], commands: ['sticker'] }
      ]
    }
  })
  const menu = buildMenu({ config: custom, commands, sender: {} })
  assert.ok(menu.includes('𝕮𝖆𝖙𝖊𝖌𝖔𝖗𝖎𝖆𝟎𝟏'))
  assert.ok(menu.includes('.sticker'))
  assert.ok(!menu.includes('.toimg'))
})

test('buildCommandHelp muestra uso y alias', () => {
  const help = buildCommandHelp({ config, command: findCommand('take') })
  assert.ok(help.includes('.take'))
  assert.ok(help.includes('Nombre | Autor'))
  assert.ok(help.includes('.autor'))
})

test('commandList no tiene nombres duplicados', () => {
  const names = commandList.map((command) => command.name)
  assert.equal(new Set(names).size, names.length)
})

test('el menú por defecto usa el banner de Drive configurado', () => {
  const image = config.menu.image
  assert.ok(image, 'menu.image debe tener el banner')
  assert.match(image, /drive\.google\.com\/file\/d\/[\w-]+/)
})
