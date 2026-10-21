import test from 'node:test'
import assert from 'node:assert/strict'
import { commands, commandList, findCommand } from '../src/commands/index.js'
import { buildCommandHelp, buildMenu } from '../src/menu.js'
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

test('todos los comandos del menú están registrados', () => {
  for (const category of config.menu.categories) {
    for (const name of category.commands) {
      assert.ok(commands.get(name), `el menú referencia el comando inexistente ${name}`)
    }
  }
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
