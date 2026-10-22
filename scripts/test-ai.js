#!/usr/bin/env node
/**
 * Prueba real de las tres IA del bot contra el gateway de OpenCode.
 *
 * A diferencia de `npm test` (que simula el gateway), acá se hace la llamada
 * de verdad: sirve para confirmar que la IA funciona en TU equipo y ver qué
 * modelo contesta cada comando, con qué protocolo y en cuánto tiempo.
 *
 * Uso: npm run ai:test
 *      npm run ai:test -- "tu pregunta"     ← misma pregunta a las tres
 */
import { loadConfig } from '../src/config.js'
import { askAi, endpointCandidates, friendlyAiError, protocolForModel } from '../src/lib/ai.js'
import { c, sym } from '../src/lib/colors.js'

const config = loadConfig()
const ai = config.ai || {}
const prompt = process.argv.slice(2).join(' ').trim() || 'Responde en una línea: ¿quién eres y qué modelo eres?'

const REQUESTS = [
  { request: 'gemini', label: 'Gemini', emoji: '💠' },
  { request: 'chatgpt', label: 'ChatGPT', emoji: '🤖' },
  { request: 'deepseek', label: 'DeepSeek', emoji: '🐋' }
]

const withKey = Boolean(String(ai.apiKey || '').trim())

console.log('')
console.log(c.bold(`${sym.wave} TomiOka Bot · prueba de IA (OpenCode)`))
console.log(
  c.gray(
    `   gateway: ${ai.baseUrl}\n` +
      `   clave:   ${withKey ? 'configurada (modelos oficiales de cada marca)' : 'SIN clave → free tier (modelos gratuitos)'}`
  )
)
console.log(c.gray(`   pregunta: ${prompt}`))
console.log('')

if (ai.enabled === false) {
  console.log(c.yellow(`${sym.warn} La categoría AI está desactivada (ai.enabled = false).`))
  process.exit(0)
}

const results = []

for (const { request, label, emoji } of REQUESTS) {
  const configured = ai.models?.[request] || []
  const firstProtocol = configured[0] ? protocolForModel(configured[0]) : 'chat'
  const urls = configured[0] ? endpointCandidates(configured[0], ai) : []

  console.log(c.bold(`${emoji} ${label}`))
  console.log(
    c.gray(
      `   configurados: ${configured.join(', ') || '(ninguno)'}\n` +
        `   protocolo:    ${firstProtocol}\n` +
        `   endpoint:     ${urls[0] || '?'}`
    )
  )

  const startedAt = Date.now()
  try {
    const answer = await askAi({
      request,
      prompt,
      // Un intento por modelo y timeout acotado: se recorre la cadena de
      // respaldo completa (que es lo que se quiere diagnosticar) sin que un
      // modelo lento trabe el reporte de los demás.
      config: {
        ...ai,
        retriesPerModel: 1,
        timeoutMs: Math.min(Number(ai.timeoutMs) || 90000, 45000)
      }
    })
    const ms = Date.now() - startedAt
    results.push({ label, ok: true, answer })

    console.log(c.green(`   ${sym.ok} respondió ${answer.model} (${answer.protocol}, ${ms} ms)`))
    if (answer.fallback) {
      console.log(
        c.yellow(
          `   ${sym.warn} es un modelo de respaldo, no el de la marca.` +
            (withKey
              ? ' Revisa créditos/categoría del modelo en opencode.ai.'
              : ' Con OPENCODE_API_KEY responde el oficial.')
        )
      )
    }
    const text = answer.text.replace(/\s+/g, ' ').slice(0, 220)
    console.log(c.gray(`   ↳ ${text}${answer.text.length > 220 ? '…' : ''}`))
  } catch (error) {
    results.push({ label, ok: false, error })
    console.log(c.red(`   ${sym.err} falló tras ${Date.now() - startedAt} ms`))
    console.log(c.gray(`   ↳ ${friendlyAiError(error, label)}`))
    if (error?.status) console.log(c.gray(`     HTTP ${error.status}${error.type ? ` · ${error.type}` : ''}`))
  }
  console.log('')
}

const failed = results.filter((result) => !result.ok)
console.log(
  failed.length
    ? c.yellow(`${sym.warn} ${results.length - failed.length}/${results.length} IA respondieron`)
    : c.green(`${sym.ok} ${results.length}/${results.length} IA respondieron`)
)

if (!withKey) {
  console.log(
    c.gray(
      '   Sin clave el free tier es anónimo y compartido (cuota por IP): puede saturarse.\n' +
        '   Para los modelos oficiales:  export OPENCODE_API_KEY="sk-..."   (https://opencode.ai/auth)'
    )
  )
}
console.log('')

if (failed.length === results.length) process.exitCode = 1
