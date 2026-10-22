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

test('la portada es minimalista estilo Stellar Wa: hero, 3 pasos, ventajas y FAQ', () => {
  const html = read('web/index.html')
  const css = read('web/styles.css')
  const js = read('web/app.js')

  // Portada primero (como stellarwa.xyz), el panel viene después
  assert.ok(html.includes('id="landingView"'), 'landing inicial')
  assert.ok(html.includes('Plataforma oficial'), 'pill de plataforma')
  assert.ok(html.includes('Automatiza WhatsApp'), 'titular del hero')
  assert.ok(html.includes('Ir al Panel'))
  assert.ok(html.includes('Cómo empezar en 3 pasos'))
  assert.ok(html.includes('Vincula tu número') && html.includes('Personaliza tu SubBot'))
  assert.ok(html.includes('¿Por qué elegir TomiOka?'))
  assert.ok(html.includes('<details class="faq">'), 'FAQ desplegable')
  assert.ok(html.includes('id="landingCommands"'), 'preview de comandos en la portada')

  // Minimalismo: tema plano de un solo acento, sin el fondo oceánico anterior
  assert.ok(!html.includes('class="ocean"'), 'sin fondo decorativo pesado')
  assert.ok(css.includes('--accent:'), 'un color de acento')
  assert.ok(!css.includes('backdrop-filter: blur(10px)'), 'sin glassmorphism')

  // Detalles del panel de Stellar: saludo por hora y buscador con `/`
  assert.ok(js.includes('function greeting()'))
  assert.ok(js.includes("event.key !== '/'"), 'atajo / para buscar comandos')
  assert.ok(html.includes('commandCats'), 'filtro por categorías en Comandos')
})

test('hay Blueprint de Render para desplegar el panel', () => {
  assert.ok(existsSync(path.join(root, 'render.yaml')), 'falta render.yaml')
  const yaml = read('render.yaml')
  assert.ok(yaml.includes('type: web'), 'el Blueprint crea un servicio web')
  assert.ok(yaml.includes('name: tomioka-panel'))
  assert.ok(yaml.includes('startCommand: node scripts/serve-web.js'), 'arranca el servidor del panel (usa el PORT de Render)')
  assert.ok(yaml.includes('healthCheckPath: /'))
})

test('hay configuración de Vercel y botones de despliegue en la página', () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.equal(vercel.outputDirectory, 'web', 'Vercel publica la carpeta web/ como estático')

  const html = read('web/index.html')
  assert.ok(html.includes('https://render.com/deploy?repo=https://github.com/lyanvalentinmail-prog/TomiOka'), 'botón Deploy to Render')
  assert.ok(html.includes('https://vercel.com/new/clone?repository-url=https://github.com/lyanvalentinmail-prog/TomiOka'), 'botón Deploy with Vercel')
  assert.ok(html.includes('Blueprint en Render') && html.includes('Desplegar en Vercel'))
})
