import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

test('el panel web existe: html, estilos y lógica', () => {
  for (const file of ['web/index.html', 'web/styles.css', 'web/app.js', 'scripts/serve-web.js']) {
    assert.ok(existsSync(path.join(root, file)), `falta ${file}`)
  }
})

test('la página tiene las tabs Panel, Endpoints, Comandos y Perfil/Login', () => {
  const html = read('web/index.html')
  for (const tab of ['data-tab="panel"', 'data-tab="endpoints"', 'data-tab="comandos"', 'data-tab="perfil"']) {
    assert.ok(html.includes(tab), `falta la tab ${tab}`)
  }
  assert.ok(html.includes('Perfil / Login'))
  assert.ok(html.includes('Sin endpoints todavía'), 'Endpoints es solo la base, sin rutas')
})

test('el flujo de despliegue está completo: login, prefijo/etiqueta, teléfono, pairing o QR y finalizar', () => {
  const html = read('web/index.html')
  const js = read('web/app.js')

  // 1 · Entrar al panel
  assert.ok(html.includes('id="loginForm"') && html.includes('Entrar al panel'))
  // 3 · Configurar prefijo y etiqueta, después siguiente
  assert.ok(html.includes('id="wLabel"'), 'campo de etiqueta')
  assert.ok(html.includes('id="wPrefix"'), 'campo de prefijo')
  assert.ok(html.includes('Siguiente &gt;'))
  // 4 · Teléfono + pairing code o QR code, después siguiente
  assert.ok(html.includes('id="wPhone"'), 'campo de teléfono')
  assert.ok(html.includes('value="pairing"') && html.includes('value="qr"'))
  // 5 · Muestra el QR o el pairing según lo elegido y finaliza
  assert.ok(html.includes('id="pairingCode"') && html.includes('id="qrCanvas"'))
  assert.ok(html.includes('id="wizardFinishBtn"') && html.includes('Finalizar'))
  assert.ok(js.includes('wizard.method'), 'el paso final depende del método elegido')
})

test('los sub-bots tienen máximo 3 y botones de panel y editar', () => {
  const html = read('web/index.html')
  const js = read('web/app.js')
  assert.ok(js.includes('const MAX_BOTS = 3'))
  assert.ok(js.includes('bots.length >= MAX_BOTS'))
  assert.ok(js.includes('Panel del bot') && html.includes('id="botPanel"'))
  assert.ok(js.includes('data-edit-bot') && html.includes('id="editModal"'))
})

test('el panel del bot muestra consola y usuarios con foto, número y nombre', () => {
  const html = read('web/index.html')
  const js = read('web/app.js')
  assert.ok(html.includes('id="consoleLog"'), 'consola del bot')
  assert.ok(html.includes('Usuarios registrados'))
  assert.ok(js.includes('pravatar.cc'), 'foto de perfil de los usuarios')
  assert.ok(js.includes('u.phone') && js.includes('u.name'), 'número y nombre de cada usuario')
})

test('editar permite cambiar el banner y pasar al menú de lista con categorías', () => {
  const html = read('web/index.html')
  const js = read('web/app.js')
  assert.ok(html.includes('id="eBannerUrl"') && html.includes('id="eBannerFile"'), 'cambiar banner por URL o subida')
  assert.ok(html.includes('value="list"') && html.includes('Menú de lista'))
  assert.ok(html.includes('Ver lista de categorías'), 'botón para ver la lista de categorías')
  assert.ok(js.includes('categoriesField'), 'las categorías aparecen con el menú de lista')
})

test('package.json expone cómo servir el panel', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.web, 'node scripts/serve-web.js')
})
