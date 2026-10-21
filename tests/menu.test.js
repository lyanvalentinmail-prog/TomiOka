import test from 'node:test'
import assert from 'node:assert/strict'
import { commands, commandList, findCommand } from '../src/commands/index.js'
import { buildCommandHelp, buildMenu, resolveCategoryCommands } from '../src/menu.js'
import { testConfig } from './helpers.js'

const config = testConfig()

test('todos los comandos pedidos existen', () => {
  for (const name of ['sticker', 'gif', 'toimg', 'tovideo', 'take', 'steal', 'emojimix', 'pack', 'help']) {
    assert.ok(findCommand(name), `falta el comando ${name}`)
    assert.equal(typeof findCommand(name).run, 'function')
  }
})

test('los alias apuntan al mismo comando', () => {
  assert.equal(findCommand('menu'), findCommand('help'))
  assert.equal(findCommand('s'), findCommand('sticker'))
  assert.equal(findCommand('noexiste'), null)
})

test('el menú usa una sola categoría con todos los comandos', () => {
  assert.equal(config.menu.categories.length, 1)
  assert.deepEqual(config.menu.categories[0].commands, [], 'la categoría sin lista muestra todos')
  const resolved = resolveCategoryCommands(config.menu.categories[0], commands)
  assert.deepEqual(
    resolved.map((command) => command.name),
    ['sticker', 'gif', 'toimg', 'tovideo', 'take', 'steal', 'emojimix', 'pack', 'help']
  )
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
  for (const name of ['sticker', 'gif', 'toimg', 'tovideo', 'take', 'steal', 'emojimix', 'pack', 'help']) {
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
  for (const command of commandList.filter((item) => !item.hidden)) {
    assert.ok(menu.includes(`୨ৎㅤ${config.prefixes[0]}${command.name}`), `falta ${command.name}`)
    if (command.description) {
      assert.ok(!menu.includes(command.description), `no debe mostrarse la descripción de ${command.name}`)
    }
  }
  assert.ok(!menu.includes('›'), 'no usa el separador de descripción')
})

test('el menú agrupa todo en una sola categoría', () => {
  const menu = buildMenu({ config, commands, sender: {} })
  assert.equal((menu.match(/◢ /g) || []).length, 1, 'un solo bloque de categoría')
  assert.equal((menu.match(/𝕮𝖆𝖙𝖊𝖌𝖔𝖗𝖎𝖆/g) || []).length, 1)
  const commandLines = menu.split('\n').filter((line) => line.startsWith('୨ৎ'))
  const visible = commandList.filter((command) => !command.hidden)
  assert.equal(commandLines.length, visible.length, 'una línea por comando visible, sin separación')
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
