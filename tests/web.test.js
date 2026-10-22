import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const html = read('web/index.html')
const css = read('web/styles.css')
const js = read('web/app.js')

test('la plataforma web existe: html, estilos, lógica y logo propio', () => {
  for (const file of ['web/index.html', 'web/styles.css', 'web/app.js', 'web/favicon.svg', 'scripts/serve-web.js']) {
    assert.ok(existsSync(path.join(root, file)), `falta ${file}`)
  }
  assert.ok(html.includes('favicon.svg'), 'usa una identidad visual propia')
})

test('está organizada en las secciones pedidas, con Sub-Bots y Endpoints', () => {
  for (const section of ['id="inicio"', 'id="subbots"', 'id="endpoints"', 'id="herramientas"', 'id="proyectos"', 'id="documentacion"', 'id="repositorio"', 'id="contacto"']) {
    assert.ok(html.includes(section), `falta la sección ${section}`)
  }
  for (const label of ['Inicio', 'Herramientas', 'Proyectos', 'Documentación', 'Repositorio', 'Contacto']) {
    assert.ok(html.includes(`>${label}<`), `falta el enlace de navegación ${label}`)
  }
})

test('el diseño es claro y minimalista: blanco, acento negro y bordes finos', () => {
  assert.ok(css.includes('--bg: #ffffff') && css.includes('--text: #111111'), 'fondo blanco y texto negro')
  assert.ok(css.includes('--border: #e3e3e3'), 'bordes finos grises')
  assert.ok(css.includes("font-family: 'Outfit'") && css.includes('@font-face'), 'tipografía Outfit servida local')
  assert.ok(css.includes('.btn-primary') && css.includes('background: #111'), 'botón principal negro')
  assert.ok(!css.includes('linear-gradient'), 'sin degradados')
  assert.ok(css.includes('@media (max-width: 720px)') || css.includes('@media (max-width: 640px)'), 'adaptación móvil')
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'respeta reducir movimiento')
  assert.ok(css.includes('.card-hover:hover') && css.includes('border-color: #c9c9c9'), 'hover sutil en tarjetas')
  assert.ok(!css.includes('@import') && !html.includes('fonts.googleapis'), 'sin fuentes externas pesadas')
  assert.ok(html.includes('theme-color" content="#ffffff"'), 'theme-color claro')
})

test('el panel de herramientas genera configuración local sin backend', () => {
  assert.ok(html.includes('id="configForm"') && html.includes('id="configOutput"'))
  assert.ok(html.includes('Sin backend'), 'aclara que no hay backend')
  assert.ok(js.includes('downloadConfig') || html.includes('id="downloadConfig"'), 'permite descargar el JSON')
  assert.ok(js.includes('currentConfig') && js.includes('JSON.stringify'), 'genera config en el navegador')
})

test('el catálogo es filtrable y enlaza al código real del repositorio', () => {
  assert.ok(html.includes('data-filter="stickers"') && html.includes('id="catalogSearch"'))
  assert.ok(js.includes('applyCatalogFilter'))
  assert.ok(html.includes('github.com/lyanvalentinmail-prog/TomiOka/tree/main/src'))
  assert.ok(html.includes('Motor de stickers') && html.includes('Creador de packs') && html.includes('Emoji Mix'))
})

test('la documentación incluye ejemplos de instalación, configuración y comandos', () => {
  assert.ok(html.includes('npm run doctor') && html.includes('pkg install'))
  assert.ok(html.includes('src/commands/saludo.js'), 'ejemplo de comando modular')
  assert.ok(html.includes('data-copy-target="codeCommand"'), 'los ejemplos se pueden copiar')
})

test('no simula backend ni funcionalidades remotas inexistentes', () => {
  const source = `${html}\n${js}`
  for (const fake of ['localStorage', 'pravatar.cc', 'Esperando vinculación', 'Usuarios registrados con foto', 'id="loginForm"', 'id="wizard"', 'Generar pairing']) {
    assert.ok(!source.includes(fake), `no debería incluir simulación: ${fake}`)
  }
  assert.ok(source.includes('no inicia sesiones') || source.includes('Sin backend'), 'declara los límites reales')
})

test('la navegación replica el patrón de la referencia: enlaces arriba y tabs abajo en móvil', () => {
  assert.ok(html.includes('id="bottomNav"'), 'existe la barra de tabs inferior')
  assert.ok(html.includes('class="bottom-nav-item'), 'items de la navegación inferior')
  assert.ok(html.includes('href="#subbots"') && html.includes('href="#endpoints"'), 'las tabs enlazan a Sub-Bots y Endpoints')
  assert.ok(css.includes('.bottom-navigation { display: none; }'), 'en escritorio manda el header')
  const mobile = css.slice(css.indexOf('@media (max-width: 900px)'))
  assert.ok(/\.bottom-navigation\s*\{[^}]*position: fixed/.test(mobile), 'en móvil la barra queda fija abajo')
  assert.ok(/\.bottom-navigation\s*\{[^}]*grid-template-columns: repeat\(8/.test(mobile), 'las ocho tabs en horizontal')
  assert.ok(/\.header-links[^{]*\{[^}]*display: none/.test(mobile), 'en móvil se ocultan los enlaces del header')
})

test('se puede crear un sub-bot desde la web, sin fingir backend', () => {
  assert.ok(html.includes('id="subbotForm"') && html.includes('id="subbotList"'), 'formulario y lista de sub-bots')
  assert.ok(html.includes('id="subbotName"') && html.includes('id="subbotPhone"'), 'pide nombre y número')
  assert.ok(js.includes('renderSubbots') && js.includes('SESSION_DIR=sessions/'), 'genera la sesión propia de cada sub-bot')
  assert.ok(js.includes("addEventListener('submit'"), 'el formulario crea el sub-bot')
})

test('la tab de Endpoints contiene solo los ocho endpoints, por categorías', () => {
  const cards = html.match(/data-endpoint/g) || []
  assert.equal(cards.length, 8, 'exactamente ocho endpoints')
  for (const name of ['Tiktok downloader', 'Instagram downloader', 'Youtube Mp3', 'Youtube Mp4', 'Brat', 'Attp', 'Ttp', 'Sticker']) {
    assert.ok(html.includes(name), `falta el endpoint ${name}`)
  }
  for (const command of ['.tiktok', '.instagram', '.ytmp3', '.ytmp4', '.brat', '.attp', '.ttp', '.sticker']) {
    assert.ok(html.includes(`data-copy-text="${command}`), `falta copiar ${command}`)
  }
  assert.ok(html.includes('<h3>Descargas</h3>') && html.includes('<h3>Stickers</h3>'), 'agrupados en dos categorías')
})

test('el menú de la web muestra solo los ocho endpoints en categorías', () => {
  const items = html.match(/menu-command/g) || []
  assert.equal(items.length, 8, 'el menú lista ocho comandos')
  assert.ok(html.includes('<h4>📥 Descargas</h4>') && html.includes('<h4>🎨 Stickers</h4>'), 'el menú usa las dos categorías')
})

test('repositorio y contacto usan únicamente enlaces verificables del proyecto', () => {
  assert.ok(html.includes('https://github.com/lyanvalentinmail-prog/TomiOka/issues'))
  assert.ok(html.includes('https://github.com/lyanvalentinmail-prog/TomiOka/pulls'))
  assert.ok(html.includes('https://github.com/lyanvalentinmail-prog'))
  assert.ok(!html.includes('twitter.com/') && !html.includes('href="https://www.instagram.com'), 'sin redes sociales inventadas')
})

test('package.json expone cómo servir la página', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.web, 'node scripts/serve-web.js')
})
