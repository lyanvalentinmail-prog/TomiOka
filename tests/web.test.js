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

test('está organizada en las seis secciones pedidas', () => {
  for (const section of ['id="inicio"', 'id="herramientas"', 'id="proyectos"', 'id="documentacion"', 'id="repositorio"', 'id="contacto"']) {
    assert.ok(html.includes(section), `falta la sección ${section}`)
  }
  for (const label of ['Inicio', 'Herramientas', 'Proyectos', 'Documentación', 'Repositorio', 'Contacto']) {
    assert.ok(html.includes(`>${label}<`), `falta el enlace de navegación ${label}`)
  }
})

test('el diseño es oscuro, morado/azul, responsive y con tarjetas interactivas', () => {
  assert.ok(css.includes('--violet:') && css.includes('--blue:') && css.includes('--bg:'))
  assert.ok(css.includes('@media (max-width: 720px)'), 'adaptación móvil')
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'respeta reducir movimiento')
  assert.ok(css.includes('.project-card:hover') && css.includes('transform: translateY(-5px)'), 'efecto hover en tarjetas')
  assert.ok(!css.includes('@import') && !html.includes('fonts.googleapis'), 'sin fuentes externas pesadas')
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

test('repositorio y contacto usan únicamente enlaces verificables del proyecto', () => {
  assert.ok(html.includes('https://github.com/lyanvalentinmail-prog/TomiOka/issues'))
  assert.ok(html.includes('https://github.com/lyanvalentinmail-prog/TomiOka/pulls'))
  assert.ok(html.includes('https://github.com/lyanvalentinmail-prog'))
  assert.ok(!html.includes('twitter.com/') && !html.includes('instagram.com/'), 'sin redes sociales inventadas')
})

test('package.json expone cómo servir la página', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.web, 'node scripts/serve-web.js')
})
