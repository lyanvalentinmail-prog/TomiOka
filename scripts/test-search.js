#!/usr/bin/env node
/**
 * Prueba REAL de la búsqueda de stickers (`.search` y `.searchpack`).
 *
 * `npm test` simula la red; este script hace las llamadas de verdad para
 * confirmar que el servicio responde desde TU equipo, qué ruta funciona y
 * cuántos resultados trae.
 *
 * Uso:
 *   npm run search:test
 *   npm run search:test -- "gatitos"
 *   npm run search:test -- "anime" --packs
 *   npm run search:test -- "anime" --no-download
 */
import { loadConfig } from '../src/config.js'
import {
  downloadSticker,
  friendlySearchError,
  packInfoEndpointCandidates,
  resetSearchEndpoints,
  resolvePack,
  searchEndpointCandidates,
  searchPacks,
  searchSettings,
  searchStickers
} from '../src/lib/sticker-search.js'
import { auditSticker } from '../src/lib/webp.js'
import { c, sym } from '../src/lib/colors.js'

const args = process.argv.slice(2)
const onlyPacks = args.includes('--packs')
const skipDownload = args.includes('--no-download')
const query = args.filter((arg) => !arg.startsWith('--')).join(' ').trim() || 'gatitos'

const config = loadConfig()
const settings = searchSettings(config)

console.log('')
console.log(c.bold(`${sym.wave} TomiOka Bot · prueba de búsqueda de stickers`))
console.log(c.gray(`   proveedor: ${settings.provider} · ${settings.baseUrl || '(sin baseUrl)'}`))
console.log(c.gray(`   búsqueda: «${query}» · timeout ${settings.timeoutMs} ms`))
console.log('')

if (!settings.enabled) {
  console.log(`${sym.warn} La búsqueda está desactivada: pon "search.enabled": true en config.json`)
  process.exit(1)
}

resetSearchEndpoints()

async function trySearch(kind, runner) {
  const startedAt = Date.now()
  console.log(c.bold(kind === 'packs' ? 'Paquetes' : 'Stickers'))
  console.log(c.gray(`   rutas candidatas: ${searchEndpointCandidates({ kind, query, config }).length}`))
  try {
    const found = await runner()
    const elapsed = Date.now() - startedAt
    const worked = searchEndpointCandidates({ kind, query, config })[0]
    console.log(`${sym.ok} ${found.results.length} resultado(s) en ${elapsed} ms`)
    console.log(c.gray(`   ruta usada: ${worked.slice(settings.baseUrl.length).split('?')[0]}`))
    for (const [index, item] of found.results.slice(0, 5).entries()) {
      const label = kind === 'packs' ? item.name : item.packName || item.url
      console.log(
        `   ${index + 1}. ${label}${item.count ? ` · ${item.count} sticker(s)` : ''}${
          item.author ? ` · ${item.author}` : ''
        }${item.id ? c.gray(` · ${item.id}`) : ''}`
      )
    }
    return found.results
  } catch (error) {
    console.log(`${sym.err} ${friendlySearchError(error)}`)
    console.log(c.gray(`   detalle: ${error.message}`))
    return []
  }
}

const stickers = onlyPacks ? [] : await trySearch('stickers', () => searchStickers({ query, limit: 3, config }))
console.log('')
const packs = await trySearch('packs', () => searchPacks({ query, limit: 3, config }))

if (!skipDownload && stickers.length) {
  console.log('')
  console.log(c.bold('Descarga'))
  const first = stickers[0]
  try {
    const startedAt = Date.now()
    const buffer = await downloadSticker(first, { config })
    const audit = auditSticker(buffer, { maxSize: 512 })
    console.log(
      `${sym.ok} ${(buffer.length / 1024).toFixed(1)} KB en ${Date.now() - startedAt} ms · ` +
        `${audit.info ? `${audit.info.width}x${audit.info.height}` : 'sin dimensiones'}` +
        `${audit.info?.animated ? ' · animado' : ''}`
    )
    if (audit.issues.length) console.log(`${sym.warn} problemas: ${audit.issues.join(', ')}`)
  } catch (error) {
    console.log(`${sym.err} no se pudo descargar: ${error.message}`)
  }
}

if (!onlyPacks && packs.length) {
  console.log('')
  console.log(c.bold('Detalle de un paquete (lo que hace .searchpack 1)'))
  const target = packs[0].id
  try {
    const pack = await resolvePack(target, { config })
    console.log(`${sym.ok} ${pack.name} · ${pack.stickers.length} sticker(s) descargables`)
    console.log(c.gray(`   código: ${pack.id} · ${pack.url}`))
    console.log(c.gray(`   rutas de detalle: ${packInfoEndpointCandidates(target, { config }).length}`))
  } catch (error) {
    console.log(`${sym.err} ${friendlySearchError(error)}`)
  }
}

console.log('')
if (!stickers.length && !packs.length) {
  console.log(`${sym.warn} Nada respondió. Revisa el internet del equipo o cambia "search.baseUrl"/"provider" en config.json.`)
  process.exit(1)
}
console.log(`${sym.ok} La búsqueda funciona en este equipo.`)
