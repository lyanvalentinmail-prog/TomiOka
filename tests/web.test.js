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

test('endpoints: solo los ocho de WhatsApp, agrupados en Descargas y Stickers', () => {
  for (const name of ['TikTok downloader', 'Instagram downloader', 'Youtube Mp3', 'Youtube Mp4', 'Brat', 'Attp', 'Ttp', 'Sticker']) {
    assert.ok(server.includes(`'${name}'`), `falta el endpoint ${name}`)
  }
  for (const command of ['.tiktok', '.instagram', '.ytmp3', '.ytmp4', '.brat', '.attp', '.ttp', '.sticker']) {
    assert.ok(server.includes(`'${command}'`), `falta el comando ${command}`)
  }
  assert.ok(server.includes("name: 'Descargas'") && server.includes("name: 'Stickers'"))
  assert.ok(server.includes('no es un endpoint HTTP del panel local'), 'debe aclarar que se ejecutan en WhatsApp')
})

test('el servidor sirve la SPA y responde la API local real', async (t) => {
  const port = 3219
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['scripts/serve-web.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
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
  assert.equal(catalog.total, 8)
  assert.deepEqual(catalog.categories.map((category) => category.name), ['Descargas', 'Stickers'])
  assert.deepEqual(catalog.categories.flatMap((category) => category.items.map((item) => item.name)), [
    'TikTok downloader', 'Instagram downloader', 'Youtube Mp3', 'Youtube Mp4', 'Brat', 'Attp', 'Ttp', 'Sticker'
  ])

  const commands = await (await fetch(`${base}/api/commands`)).json()
  assert.equal(commands.prefix, '.')
  for (const name of ['tiktok', 'instagram', 'ytmp3', 'ytmp4', 'brat', 'attp', 'ttp', 'sticker', 'help']) {
    assert.ok(commands.commands.some((command) => command.name === name), `falta el comando ${name}`)
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
})

test('el pairing code del panel lo pide Baileys a WhatsApp, no se inventa', () => {
  assert.ok(server.includes('createLinkSessionManager'))
  assert.ok(server.includes("action === 'pairing'") && server.includes("action === 'start'") && server.includes("action === 'stop'"))
  const link = read('src/lib/link-session.js')
  assert.ok(link.includes('requestPairingCode'), 'usa la API real de Baileys')
  assert.ok(link.includes('formatPairingCode'))
  assert.ok(link.includes('useMultiFileAuthState'), 'persiste la sesión del sub-bot')
})

test('package.json expone cómo servir la página', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.web, 'node scripts/serve-web.js')
})
