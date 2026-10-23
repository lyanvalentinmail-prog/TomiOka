import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const html = read('web/index.html')
const css = read('web/styles.css')
const js = read('web/app.js')
const sw = read('web/sw.js')
const manifest = read('web/manifest.webmanifest')
const server = read('scripts/serve-web.js')
const panelBot = read('scripts/lib/panel-bot.js')

async function waitForServer(base) {
  let lastError
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch (error) { lastError = error }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw lastError || new Error('El servidor web no respondió')
}

test('la web copiada existe como SPA/PWA de TomiOka', () => {
  for (const file of ['web/index.html', 'web/styles.css', 'web/app.js', 'web/sw.js', 'web/manifest.webmanifest', 'web/icon.svg', 'web/fonts/outfit-latin-wght-normal.woff2', 'scripts/serve-web.js']) {
    assert.ok(existsSync(path.join(root, file)), `falta ${file}`)
  }
  assert.ok(html.includes('<title>TomiOka — Plataforma de SubBots para WhatsApp</title>'))
  assert.ok(html.includes('href="/manifest.webmanifest"') && html.includes('href="/icon.svg"'))
  assert.ok(js.includes("navigator.serviceWorker.register('/sw.js')"))
  assert.ok(manifest.includes('"name": "TomiOka · Panel"'))
  assert.ok(sw.includes("const CACHE = 'tomioka-v1'"))
})

test('la copia quedó rebrandeada: sin marca Stellar ni Versova', () => {
  const source = `${html}\n${css}\n${js}\n${sw}\n${manifest}`
  assert.ok(!/stellar|versova/i.test(source), 'no debe quedar marca de la referencia')
  assert.ok(source.includes('TomiOka'))
  assert.ok(source.includes('https://github.com/lyanvalentinmail-prog/TomiOka'))
  assert.ok(!source.includes('api.stellarwa.xyz') && !source.includes('web.stellarwa.xyz'))
})

test('la SPA conserva las rutas y la navegación inferior horizontal de la referencia', () => {
  for (const route of ['/home', '/register', '/bots', '/metrics', '/store', '/endpoints', '/favorites', '/tickets', '/profile', '/cmds']) {
    assert.ok(js.includes(`'${route}'`) || js.includes(`"${route}"`), `falta la ruta ${route}`)
  }
  assert.ok(html.includes('id="bottom-navigation"'))
  assert.ok(js.includes('bottom-nav-item') && js.includes('navItems'))
  assert.ok(css.includes('.bottom-navigation') && css.includes('position: fixed') && css.includes('grid-template-columns: repeat(6'))
  assert.ok(css.includes('.bottom-nav-item.is-active'))
})

test('el diseño copiado es claro y minimalista, con fuentes locales', () => {
  assert.ok(css.includes('--bg: #ffffff') && css.includes('--text: #111111'))
  assert.ok(css.includes('--border: #e3e3e3'))
  assert.ok(css.includes("font-family: 'Outfit'") && css.includes('@font-face'))
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'))
  assert.ok(!html.includes('fonts.googleapis') && !css.includes('@import'))
})

test('el servidor local ofrece la API que la SPA espera', () => {
  for (const route of ['/health', '/me', '/state', '/stream', '/groups', '/system', '/commands', '/endpoints/catalog', '/v1', '/menu/styles', '/instances']) {
    assert.ok(server.includes(`'${route}'`) || server.includes(`"${route}"`), `falta la ruta API ${route}`)
  }
  assert.ok(server.includes("url.pathname.startsWith('/api/')"), 'las rutas /api no deben caer en el fallback SPA')
  assert.ok(server.includes('data/web-subbots.json') || server.includes("path.join(DATA_DIR, 'web-subbots.json')"))
  assert.ok(server.includes('SESSION_DIR=') && server.includes('PAIRING_PHONE=') && server.includes('npm run pair'))
  assert.ok(server.includes('no está implementado en el panel local de TomiOka'), 'lo no implementado debe responder con honestidad')
})

test('endpoints: solo los nueve de WhatsApp, agrupados en Descargas y Stickers', () => {
  for (const name of ['TikTok downloader', 'Instagram downloader', 'Pinterest downloader', 'Youtube Mp3', 'Youtube Mp4', 'Brat', 'Attp', 'Ttp', 'Sticker']) {
    assert.ok(server.includes(`'${name}'`), `falta el endpoint ${name}`)
  }
  for (const command of ['.tiktok', '.instagram', '.pinterest', '.ytmp3', '.ytmp4', '.brat', '.attp', '.ttp', '.sticker']) {
    assert.ok(server.includes(`'${command}'`), `falta el comando ${command}`)
  }
  assert.ok(server.includes("name: 'Descargas'") && server.includes("name: 'Stickers'"))
  assert.ok(server.includes('no es un endpoint HTTP del panel local'), 'debe aclarar que se ejecutan en WhatsApp')
})

test('el servidor sirve la SPA y responde la API local real', async (t) => {
  const port = 3219
  const base = `http://127.0.0.1:${port}`
  const suffix = Date.now()
  const ownerEmail = `dueno-${suffix}@example.com`
  const child = spawn(process.execPath, ['scripts/serve-web.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OWNER_EMAIL: ownerEmail },
    stdio: 'ignore'
  })
  t.after(() => { child.kill() })
  await waitForServer(base)

  const home = await fetch(`${base}/home`)
  assert.equal(home.status, 200)
  assert.ok((await home.text()).includes('TomiOka'))

  const health = await (await fetch(`${base}/api/health`)).json()
  assert.equal(health.ok, true)
  assert.equal(health.service, 'TomiOka')
  assert.ok(health.commands >= 8)

  const catalog = await (await fetch(`${base}/api/endpoints/catalog`)).json()
  assert.equal(catalog.ok, true)
  assert.equal(catalog.total, 9)
  assert.deepEqual(catalog.categories.map((category) => category.name), ['Descargas', 'Stickers'])
  assert.deepEqual(catalog.categories.flatMap((category) => category.items.map((item) => item.name)), [
    'TikTok downloader', 'Instagram downloader', 'Pinterest downloader', 'Youtube Mp3', 'Youtube Mp4', 'Brat', 'Attp', 'Ttp', 'Sticker'
  ])

  const commands = await (await fetch(`${base}/api/commands`)).json()
  assert.equal(commands.prefix, '.')
  for (const name of ['tiktok', 'instagram', 'pinterest', 'ytmp3', 'ytmp4', 'brat', 'attp', 'ttp', 'sticker', 'gif', 'emojimix', 'toimg', 'tovideo', 'take', 'pack', 'gemini', 'chatgpt', 'deepseek', 'help', 'debug']) {
    const found = commands.commands.find((command) => command.name === name)
    assert.ok(found, `falta el comando ${name}`)
    assert.equal(found.hidden, false, `${name} debe estar visible`)
  }

  const whatsapp = await fetch(`${base}/api/whatsapp/tiktok?url=https://www.tiktok.com/`)
  assert.equal(whatsapp.status, 501)
  assert.ok((await whatsapp.json()).error.includes('se ejecuta en WhatsApp'))

  const name = `Panel Test ${Date.now()}`
  const createdResponse = await fetch(`${base}/api/instances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, phone: '59899123456', pairingMode: 'pairing', prefix: '.' })
  })
  assert.equal(createdResponse.status, 201)
  const created = await createdResponse.json()
  assert.ok(created.instance.id)
  assert.equal(created.instance.sessionDir, `sessions/${created.instance.id}`)
  assert.ok(created.instance.launchCommand.includes('SESSION_DIR=sessions/'))
  assert.ok(created.instance.launchCommand.includes('PAIRING_PHONE=59899123456'))
  assert.ok(created.instance.launchCommand.includes('npm run pair'))

  const state = await (await fetch(`${base}/api/state`)).json()
  assert.ok(state.instances.some((instance) => instance.id === created.instance.id))

  const previewRes = await (await fetch(`${base}/api/instances/${created.instance.id}/preview`)).json()
  assert.equal(previewRes.ok, true)
  for (const name of ['tiktok', 'instagram', 'pinterest', 'ytmp3', 'ytmp4', 'brat', 'attp', 'ttp', 'sticker', 'gif', 'emojimix', 'toimg', 'tovideo', 'take', 'pack', 'gemini', 'chatgpt', 'deepseek', 'help', 'debug']) {
    assert.ok(previewRes.preview.includes(`.${name}`), `falta .${name} en la vista previa del menú`)
  }

  // Pairing sin número válido: se rechaza antes de tocar WhatsApp
  await fetch(`${base}/api/instances/${created.instance.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '123' })
  })
  const badStart = await fetch(`${base}/api/instances/${created.instance.id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(badStart.status, 400)
  const badPairing = await fetch(`${base}/api/instances/${created.instance.id}/pairing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ waitMs: 1000 })
  })
  assert.equal(badPairing.status, 400)
  const link = await (await fetch(`${base}/api/instances/${created.instance.id}/link`)).json()
  assert.equal(link.ok, true)
  assert.equal(link.connected, false)
  assert.equal(link.pairingFormatted, '')

  const removed = await fetch(`${base}/api/instances/${created.instance.id}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)

  // Login real: registro como owner (OWNER_EMAIL), login, sesión y API keys
  const jsonHeaders = { 'content-type': 'application/json' }
  const register = await fetch(`${base}/api/account/register`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: ownerEmail, username: `dueno${suffix}`, password: 'secreto123' })
  })
  assert.equal(register.status, 201)
  const regData = await register.json()
  assert.ok(regData.token.startsWith('ses_'))
  assert.equal(regData.user.isOwner, true)
  assert.equal(regData.user.email, ownerEmail)

  const wrong = await fetch(`${base}/api/account/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: ownerEmail, password: 'incorrecta' })
  })
  assert.equal(wrong.status, 401)

  const login = await fetch(`${base}/api/account/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: ownerEmail, password: 'secreto123' })
  })
  assert.equal(login.status, 200)
  const loginData = await login.json()
  assert.equal(loginData.user.isOwner, true)
  const authHeaders = { ...jsonHeaders, authorization: `Bearer ${loginData.token}` }

  const me = await (await fetch(`${base}/api/account/me`, { headers: authHeaders })).json()
  assert.equal(me.user.email, ownerEmail)
  assert.equal(me.user.plan, 'OWNER')
  assert.equal((await fetch(`${base}/api/account/me`)).status, 401)

  const keyRes = await fetch(`${base}/api/account/keys`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'Test', days: 30 })
  })
  assert.equal(keyRes.status, 201)
  const keyData = await keyRes.json()
  assert.ok(keyData.key.startsWith('tk_'))
  const keys = await (await fetch(`${base}/api/account/keys`, { headers: authHeaders })).json()
  assert.ok(keys.keys.some((key) => key.id === keyData.apiKey.id && key.status === 'active'))

  const overview = await (await fetch(`${base}/api/account/owner/overview`, { headers: authHeaders })).json()
  assert.ok(overview.totals.users >= 1)
  assert.equal((await fetch(`${base}/api/account/owner/overview`)).status, 401)
})

test('el pairing code del panel lo pide Baileys a WhatsApp, no se inventa', () => {
  assert.ok(server.includes('createLinkSessionManager'))
  assert.ok(server.includes("action === 'pairing'") && server.includes("action === 'start'") && server.includes("action === 'stop'"))
  const link = read('src/lib/link-session.js')
  assert.ok(link.includes('requestPairingCode'), 'usa la API real de Baileys')
  assert.ok(link.includes('formatPairingCode'))
  assert.ok(link.includes('useMultiFileAuthState'), 'persiste la sesión del sub-bot')
})

test('el login del panel es real: cuentas cifradas, sesiones y owner', () => {
  for (const route of ['/account/register', '/account/login', '/account/me', '/account/keys', '/account/usage', '/account/owner/overview']) {
    assert.ok(server.includes(route), `falta la ruta ${route}`)
  }
  assert.ok(server.includes('scryptSync') && server.includes('createSession'), 'contraseñas cifradas y sesiones con token')
  assert.ok(server.includes('lyanvalentinmail@gmail.com'), 'el email del owner viene por defecto')
  assert.ok(read('render.yaml').includes('npm install'), 'Render debe instalar las dependencias (Baileys) en el build')
})

test('editar bot muestra la info de TomiOka y el arranque instala dependencias', () => {
  assert.ok(!/raiden/i.test(js), 'sin estilos de otros bots')
  assert.ok(js.includes("['download', 'Descargas']") && js.includes("['info', 'Información']"), 'categorías de TomiOka')
  assert.ok(js.includes('Números owner de este sub-bot'), 'los números son owners del sub-bot')
  assert.ok(!js.includes('staff only'), 'sin promesas ajenas')
  // La personalización vive en el módulo del bot del panel (testeable aparte)
  assert.ok(server.includes('createPanelBotManager'), 'el panel usa el gestor de bots')
  assert.ok(panelBot.includes('panelBeforeCommand') && panelBot.includes('beforeCommand'), 'la personalización se aplica al sub-bot')
  assert.ok(panelBot.includes('config.owner') && panelBot.includes('adminNumbers'), 'los owners se cargan en la config del sub-bot')
  assert.ok(panelBot.includes('messages.upsert'), 'el sub-bot escucha los mensajes de WhatsApp')
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.start, 'node scripts/boot.js')
  assert.ok(read('scripts/boot.js').includes('Faltan dependencias'), 'npm start instala si falta Baileys')
})

test('package.json expone cómo servir la página', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.web, 'node scripts/serve-web.js')
})
