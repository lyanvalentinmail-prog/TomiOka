import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandContext } from '../src/lib/context.js'
import { createStore } from '../src/handler.js'
import { findCommand } from '../src/commands/index.js'
import {
  askAi,
  buildBody,
  buildHeaders,
  buildPrompt,
  currentSessionId,
  endpointCandidates,
  endpointFor,
  extractText,
  friendlyAiError,
  generateSessionId,
  gateReadTool,
  isFreeModel,
  isRetryableFailure,
  parseSseChunk,
  protocolForModel,
  resetEndpointPreference,
  resetSession,
  resolveModelChain,
  runAiCommand,
  AiError
} from '../src/lib/ai.js'
import { fakeSock, silentLogger, testConfig, textMessage } from './helpers.js'

/** Config de IA con los valores por defecto del proyecto */
const aiConfig = (overrides = {}) => ({ ...testConfig().ai, ...overrides })

/**
 * Socket falso que contesta como el gateway de OpenCode.
 * `handler(url, body)` devuelve { status, text } y queda registrado en `calls`.
 */
function gatewaySock(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}')
    calls.push({ url: String(url), body, headers: options.headers || {} })
    const result = await handler(String(url), body, calls.length)
    return {
      ok: (result.status || 200) >= 200 && (result.status || 200) < 300,
      status: result.status || 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? result.contentType || 'text/event-stream' : null) },
      text: async () => result.text ?? ''
    }
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    }
  }
}

/** SSE mínimo de OpenAI-compatible con el texto partido en dos deltas */
const chatSse = (text = 'hola mundo') =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, 4) } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(4) } }] })}`,
    'data: [DONE]'
  ].join('\n')

function makeContext(commandText, { quoted = null, config = testConfig() } = {}) {
  const sock = fakeSock()
  const msg = quoted
    ? {
        key: { remoteJid: '59891111111@s.whatsapp.net', fromMe: false, id: 'ai-1' },
        pushName: 'Tester',
        message: {
          extendedTextMessage: {
            text: commandText,
            contextInfo: { stanzaId: 'q1', participant: '59892222222@s.whatsapp.net', quotedMessage: quoted }
          }
        }
      }
    : textMessage(commandText)
  const ctx = new CommandContext({
    sock,
    msg,
    config,
    logger: silentLogger,
    store: createStore(config, silentLogger),
    text: commandText
  })
  return { ctx, sock }
}

const sentTexts = (sock) => sock.sent.filter((item) => typeof item.content?.text === 'string').map((item) => item.content.text)

// ---------------------------------------------------------------------------
// Selección de protocolo
// ---------------------------------------------------------------------------

test('protocolForModel elige el protocolo que usa OpenCode para cada familia', () => {
  assert.equal(protocolForModel('gemini-3-flash'), 'google')
  assert.equal(protocolForModel('gemini-3.1-pro'), 'google')
  assert.equal(protocolForModel('gpt-5.6-terra'), 'responses')
  assert.equal(protocolForModel('gpt-5-nano'), 'responses')
  assert.equal(protocolForModel('grok-4.7'), 'responses')
  assert.equal(protocolForModel('claude-sonnet-5'), 'messages')
  assert.equal(protocolForModel('deepseek-v4.1-flash'), 'chat')
  assert.equal(protocolForModel('deepseek-v4.1-flash-free'), 'chat')
  assert.equal(protocolForModel('glm-5.3-flash-free'), 'chat')
  assert.equal(protocolForModel('big-pickle'), 'chat')
  assert.equal(protocolForModel('qwen3.8-max'), 'chat')
  assert.equal(protocolForModel('qwen3.8-flash'), 'messages')
})

test('isFreeModel reconoce el free tier de OpenCode', () => {
  assert.equal(isFreeModel('deepseek-v4.1-flash-free'), true)
  assert.equal(isFreeModel('big-pickle'), true)
  assert.equal(isFreeModel('gemini-3-flash'), false)
  assert.equal(isFreeModel('gpt-5-nano'), false)
  assert.equal(isFreeModel(''), false)
})

test('endpointCandidates arma las URLs documentadas por protocolo', () => {
  const opts = {
    baseUrl: 'https://opencode.ai/inference/v1',
    openaiBaseUrl: 'https://opencode.ai/inference/openai/v1',
    anthropicBaseUrl: 'https://opencode.ai/inference/anthropic/v1',
    googleBaseUrl: 'https://opencode.ai/inference/google/v1beta'
  }
  // La tabla oficial de OpenCode separa por familia…
  assert.deepEqual(endpointCandidates('deepseek-v4.1-flash', opts), [
    'https://opencode.ai/inference/openai/v1/chat/completions',
    // …y el CLI usa la base unificada: se deja como segunda opción.
    'https://opencode.ai/inference/v1/chat/completions'
  ])
  assert.deepEqual(endpointCandidates('gpt-5-nano', opts), [
    'https://opencode.ai/inference/openai/v1/responses',
    'https://opencode.ai/inference/v1/responses'
  ])
  assert.deepEqual(endpointCandidates('claude-sonnet-5', opts), [
    'https://opencode.ai/inference/anthropic/v1/messages',
    'https://opencode.ai/inference/v1/messages'
  ])
  assert.deepEqual(endpointCandidates('gemini-3-flash', opts), [
    'https://opencode.ai/inference/google/v1beta/models/gemini-3-flash:streamGenerateContent?alt=sse',
    'https://opencode.ai/inference/google/v1beta/models/gemini-3-flash:generateContent'
  ])
  assert.equal(endpointFor('deepseek-v4.1-flash', opts), endpointCandidates('deepseek-v4.1-flash', opts)[0])
})

test('endpointCandidates deriva las rutas por familia si solo se configura la base', () => {
  const candidates = endpointCandidates('deepseek-v4.1-flash', {
    baseUrl: 'https://opencode.ai/inference/v1'
  })
  assert.equal(candidates[0], 'https://opencode.ai/inference/openai/v1/chat/completions')
  assert.equal(candidates[1], 'https://opencode.ai/inference/v1/chat/completions')
})

test('endpointCandidates no duplica si ambos esquemas coinciden', () => {
  const candidates = endpointCandidates('deepseek-v4.1-flash', {
    baseUrl: 'https://opencode.ai/inference/v1',
    openaiBaseUrl: 'https://opencode.ai/inference/v1'
  })
  assert.deepEqual(candidates, ['https://opencode.ai/inference/v1/chat/completions'])
})

// ---------------------------------------------------------------------------
// La puerta del free tier (sesión + herramienta "read")
// ---------------------------------------------------------------------------

test('generateSessionId tiene el formato que valida el gateway', () => {
  const id = generateSessionId(1_760_000_000_000, 1)
  assert.match(id, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  assert.equal(id.length, 30)
  // Dos id seguidos no chocan
  assert.notEqual(generateSessionId(1_760_000_000_000, 1), generateSessionId(1_760_000_000_000, 2))
})

test('generateSessionId embebe el timestamp en los primeros 12 hex', () => {
  const now = Date.now()
  const id = generateSessionId(now, 1)
  const hex = id.slice(4, 16)
  // El gateway lee 6 bytes big-endian y les aplica ~. Como el stamp es
  // ms * 0x1000 (mayor que 2^48), lo que entra en esos 48 bits es el
  // timestamp módulo 2^36 ms: suficiente para que la fecha parezca real, que
  // es exactamente lo que valida. Se revierte para comprobarlo.
  let unsigned = 0n
  for (let i = 0; i < 6; i += 1) {
    unsigned = (unsigned << 8n) | BigInt(parseInt(hex.slice(i * 2, i * 2 + 2), 16))
  }
  const masked = unsigned >= 2n ** 47n ? unsigned - 2n ** 48n : unsigned
  const decoded = Number((~masked) >> 12n)
  assert.ok(
    Math.abs(decoded - (now % 2 ** 36)) < 4096,
    `timestamp decodificado ${decoded} vs ${now % 2 ** 36}`
  )
  // Distinto momento => distinto prefijo (el gateway rechaza los repetidos/viejos)
  assert.notEqual(generateSessionId(now, 1).slice(4, 16), generateSessionId(now + 60_000, 1).slice(4, 16))
})

test('currentSessionId reutiliza la sesión y la remite cuando envejece', () => {
  resetSession()
  const first = currentSessionId(1_000)
  assert.equal(currentSessionId(2_000), first, 'misma sesión mientras es reciente')
  const later = currentSessionId(1_000 + 31 * 60_000)
  assert.notEqual(later, first, 'se remite al pasar los 30 minutos')
  resetSession()
})

test('buildHeaders manda el par de cabeceras de sesión y el UA de opencode', () => {
  resetSession()
  const headers = buildHeaders({ apiKey: '', userAgent: 'opencode/1.18.30' })
  assert.equal(headers['user-agent'], 'opencode/1.18.30')
  assert.equal(headers.authorization, 'Bearer public', 'sin clave va anónimo')
  assert.ok(headers['x-opencode-session'], 'falta x-opencode-session')
  assert.ok(headers['x-opencode-session-id'], 'falta x-opencode-session-id')
  assert.equal(headers['x-opencode-session'], headers['x-opencode-session-id'], 'las dos con el mismo valor')
  assert.equal(headers.accept, 'application/json, text/event-stream')

  const withKey = buildHeaders({ apiKey: 'sk-prueba' })
  assert.equal(withKey.authorization, 'Bearer sk-prueba')
  resetSession()
})

test('buildBody abre la puerta del free tier: stream + herramienta read', () => {
  const free = buildBody({ modelId: 'deepseek-v4.1-flash-free', prompt: 'hola', maxTokens: 512 })
  assert.equal(free.stream, true)
  assert.equal(free.model, 'deepseek-v4.1-flash-free')
  assert.deepEqual(free.tools, [gateReadTool()])
  assert.equal(free.tools[0].function.name, 'read', 'la puerta solo acepta una herramienta llamada read')
  assert.deepEqual(free.messages.at(-1), { role: 'user', content: 'hola' })

  const paid = buildBody({ modelId: 'gpt-5-nano', prompt: 'hola' })
  assert.equal(paid.tools, undefined, 'los modelos de pago no necesitan el stub')
  assert.equal(paid.stream, true)
})

test('buildBody respeta el formato de cada protocolo', () => {
  const google = buildBody({ modelId: 'gemini-3-flash', prompt: 'hola', system: 'sé breve' })
  assert.ok(Array.isArray(google.contents), 'Gemini usa contents')
  assert.ok(google.generationConfig, 'Gemini usa generationConfig')
  assert.equal(google.model, undefined)
  assert.deepEqual(google.systemInstruction, { parts: [{ text: 'sé breve' }] }, 'el system va en systemInstruction')
  assert.deepEqual(google.contents.at(-1), { role: 'user', parts: [{ text: 'hola' }] })

  // El historial viaja con los roles de Gemini (model = asistente)
  const withHistory = buildBody({
    modelId: 'gemini-3-flash',
    prompt: '¿y ahora?',
    history: [{ role: 'user', content: 'antes' }, { role: 'assistant', content: 'respuesta' }]
  })
  assert.deepEqual(withHistory.contents.map((item) => item.role), ['user', 'model', 'user'])

  const anthropic = buildBody({ modelId: 'claude-sonnet-5', prompt: 'hola', system: 'sé breve' })
  assert.equal(anthropic.system, 'sé breve', 'Claude lleva el system aparte')
  assert.ok(!anthropic.messages.some((message) => message.role === 'system'))
  assert.equal(anthropic.max_tokens > 0, true)

  const responses = buildBody({ modelId: 'gpt-5-nano', prompt: 'hola' })
  assert.ok(Array.isArray(responses.input), 'Responses usa input')
  assert.equal(responses.messages, undefined)
})

// ---------------------------------------------------------------------------
// Lectura de respuestas
// ---------------------------------------------------------------------------

test('parseSseChunk extrae los eventos data y descarta [DONE] y basura', () => {
  const chunk = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\ndata: roto{\n'
  assert.deepEqual(parseSseChunk(chunk), [{ a: 1 }, { b: 2 }])
  assert.deepEqual(parseSseChunk('event: ping\n: comentario\n'), [])
})

test('extractText entiende los cuatro protocolos, con y sin streaming', () => {
  // OpenAI-compatible en streaming
  assert.equal(
    extractText({ choices: [{ delta: { content: 'hola' } }] }, 'chat'),
    'hola'
  )
  // OpenAI-compatible sin streaming
  assert.equal(
    extractText({ choices: [{ message: { content: 'mundo' } }] }, 'chat'),
    'mundo'
  )
  // Anthropic en streaming y completo
  assert.equal(extractText({ type: 'content_block_delta', delta: { text: 'claude' } }, 'messages'), 'claude')
  assert.equal(
    extractText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, 'messages'),
    'ab'
  )
  // OpenAI Responses en streaming y completo
  assert.equal(
    extractText({ type: 'response.output_text.delta', delta: 'gpt' }, 'responses'),
    'gpt'
  )
  assert.equal(
    extractText({ output: [{ content: [{ type: 'output_text', text: 'respuesta' }] }] }, 'responses'),
    'respuesta'
  )
  // Google Gemini
  assert.equal(
    extractText({ candidates: [{ content: { parts: [{ text: 'gemini ' }, { text: 'ok' }] } }] }, 'google'),
    'gemini ok'
  )
  assert.equal(extractText(null, 'chat'), '')
  assert.equal(extractText({ choices: [] }, 'chat'), '')
})

test('las llamadas a herramienta no se cuelan como texto', () => {
  // El gateway ignora tool_choice:none y puede responder con una herramienta.
  const payload = { choices: [{ delta: { tool_calls: [{ function: { name: 'read', arguments: '{}' } }] } }] }
  assert.equal(extractText(payload, 'chat'), '', 'no aporta texto')
  assert.equal(
    extractText({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'read' } }, 'messages'),
    ''
  )
})

// ---------------------------------------------------------------------------
// Cadena de modelos
// ---------------------------------------------------------------------------

test('resolveModelChain usa los modelos de la marca y cae a los gratis', () => {
  const ai = aiConfig({ apiKey: 'sk-real' })
  const chain = resolveModelChain({ ai, request: 'gemini' })
  assert.equal(chain[0], 'gemini-3-flash', 'con clave prueba primero el modelo oficial')
  assert.ok(chain.includes('deepseek-v4.1-flash-free'), 'y termina en la red de seguridad gratis')
  assert.equal(new Set(chain).size, chain.length, 'sin duplicados')
})

test('resolveModelChain sin clave salta los modelos de pago', () => {
  const ai = aiConfig({ apiKey: '' })
  const chain = resolveModelChain({ ai, request: 'gemini' })
  assert.ok(!chain.includes('gemini-3-flash'), 'sin clave no gasta un pedido en un modelo pago')
  assert.ok(chain.every((model) => isFreeModel(model)), 'toda la cadena es gratis')
  assert.ok(chain.length > 0)
})

test('resolveModelChain sin clave deja a DeepSeek en su modelo gratuito real', () => {
  const chain = resolveModelChain({ ai: aiConfig({ apiKey: '' }), request: 'deepseek' })
  assert.equal(chain[0], 'deepseek-v4.1-flash-free', 'DeepSeek tiene versión gratis oficial')
})

test('resolveModelChain respeta freeTierFallback: false', () => {
  const ai = aiConfig({ apiKey: 'sk-real', freeTierFallback: false })
  const chain = resolveModelChain({ ai, request: 'chatgpt' })
  assert.deepEqual(chain, ['gpt-5.6-terra', 'gpt-5-nano'], 'solo los configurados')
})

test('resolveModelChain de un request desconocido devuelve solo los gratis', () => {
  const chain = resolveModelChain({ ai: aiConfig({ apiKey: '' }), request: 'inexistente' })
  assert.ok(chain.every((model) => isFreeModel(model)))
})

test('isRetryableFailure clasifica los errores del gateway', () => {
  assert.equal(isRetryableFailure(429, {}), true)
  assert.equal(isRetryableFailure(503, {}), true)
  assert.equal(isRetryableFailure(410, {}), true, 'modelo retirado: sigue la cadena')
  assert.equal(isRetryableFailure(403, { error: { type: 'FreeTierError' } }), true)
  assert.equal(isRetryableFailure(400, { error: { type: 'MissingSessionID' } }), true)
  assert.equal(isRetryableFailure(400, { error: { message: 'Model is unavailable' } }), true)
  assert.equal(isRetryableFailure(401, { error: { type: 'invalid_api_key' } }), false, 'clave mala: no reintenta')
  assert.equal(isRetryableFailure(402, { error: { message: 'insufficient credits' } }), false)
  assert.equal(isRetryableFailure(400, { error: { message: 'context length exceeded' } }), false)
})

// ---------------------------------------------------------------------------
// askAi contra un gateway simulado
// ---------------------------------------------------------------------------

test('askAi devuelve el texto del modelo y dice quién respondió', async () => {
  const gateway = gatewaySock(() => ({ text: chatSse('El agua hierve a 100 °C.') }))
  try {
    const answer = await askAi({
      request: 'deepseek',
      prompt: '¿a qué temperatura hierve el agua?',
      config: aiConfig({ apiKey: '' })
    })
    assert.equal(answer.text, 'El agua hierve a 100 °C.')
    assert.equal(answer.model, 'deepseek-v4.1-flash-free')
    assert.equal(answer.protocol, 'chat')
    assert.equal(answer.fallback, false)
    assert.equal(answer.withKey, false)
    assert.ok(answer.elapsedMs >= 0)
    assert.equal(gateway.calls.length, 1)
  } finally {
    gateway.restore()
  }
})

test('askAi manda el pedido al endpoint del protocolo del modelo', async () => {
  const gateway = gatewaySock(() => ({ text: chatSse('ok') }))
  try {
    await askAi({ request: 'deepseek', prompt: 'hola', config: aiConfig({ apiKey: 'sk-real' }) })
    // Con clave empieza por el modelo oficial (chat/completions)
    assert.match(gateway.calls[0].url, /\/chat\/completions$/)
    assert.equal(gateway.calls[0].body.model, 'deepseek-v4.1-flash')
    assert.equal(gateway.calls[0].headers.authorization, 'Bearer sk-real')
    assert.ok(gateway.calls[0].headers['x-opencode-session'])
  } finally {
    gateway.restore()
  }
})

test('askAi prueba el segundo esquema de URL si el primero da 404', async () => {
  resetEndpointPreference()
  const gateway = gatewaySock((url) =>
    url.includes('/inference/openai/v1/')
      ? { status: 404, contentType: 'application/json', text: '{"error":{"message":"ruta inexistente"}}' }
      : { text: chatSse('respondió la base unificada') }
  )
  try {
    const answer = await askAi({ request: 'deepseek', prompt: 'hola', config: aiConfig({ apiKey: 'sk-real' }) })
    assert.equal(answer.text, 'respondió la base unificada')
    assert.equal(answer.model, 'deepseek-v4.1-flash', 'el modelo no se pierde por un 404 de ruta')
    assert.equal(gateway.calls.length, 2, 'probó las dos URLs')
    assert.match(gateway.calls[0].url, /\/inference\/openai\/v1\/chat\/completions$/)
    assert.match(gateway.calls[1].url, /\/inference\/v1\/chat\/completions$/)

    // El esquema que funcionó queda como preferido: el próximo pedido va directo.
    const second = await askAi({ request: 'deepseek', prompt: 'hola de nuevo', config: aiConfig({ apiKey: 'sk-real' }) })
    assert.equal(second.text, 'respondió la base unificada')
    assert.equal(gateway.calls.length, 3, 'un solo intento esta vez')
    assert.match(gateway.calls[2].url, /\/inference\/v1\/chat\/completions$/)
  } finally {
    gateway.restore()
    resetEndpointPreference()
  }
})

test('un 404 en todos los esquemas pasa al modelo siguiente', async () => {
  resetEndpointPreference()
  const gateway = gatewaySock((url, body) =>
    body.model === 'deepseek-v4.1-flash'
      ? { status: 404, contentType: 'application/json', text: '{"error":{"message":"no existe"}}' }
      : { text: chatSse('otro modelo al rescate') }
  )
  try {
    const answer = await askAi({ request: 'deepseek', prompt: 'hola', config: aiConfig({ apiKey: 'sk-real', retriesPerModel: 1 }) })
    assert.equal(answer.text, 'otro modelo al rescate')
    assert.notEqual(answer.model, 'deepseek-v4.1-flash')
  } finally {
    gateway.restore()
    resetEndpointPreference()
  }
})

test('askAi con Gemini usa el endpoint de Google y su formato', async () => {
  const geminiSse = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'respuesta de gemini' }] } }] })}`
  const gateway = gatewaySock(() => ({ text: geminiSse }))
  try {
    const answer = await askAi({ request: 'gemini', prompt: 'hola', config: aiConfig({ apiKey: 'sk-real' }) })
    assert.equal(answer.text, 'respuesta de gemini')
    assert.equal(answer.model, 'gemini-3-flash')
    assert.equal(answer.protocol, 'google')
    assert.match(gateway.calls[0].url, /google\/v1beta\/models\/gemini-3-flash:streamGenerateContent/)
    assert.ok(gateway.calls[0].body.contents, 'usa contents, no messages')
  } finally {
    gateway.restore()
  }
})

test('askAi con ChatGPT usa el endpoint de Responses', async () => {
  const responsesSse = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'respuesta de gpt' })}`
  const gateway = gatewaySock(() => ({ text: responsesSse }))
  try {
    const answer = await askAi({ request: 'chatgpt', prompt: 'hola', config: aiConfig({ apiKey: 'sk-real' }) })
    assert.equal(answer.text, 'respuesta de gpt')
    assert.equal(answer.model, 'gpt-5.6-terra')
    assert.equal(answer.protocol, 'responses')
    assert.match(gateway.calls[0].url, /\/responses$/)
    assert.ok(Array.isArray(gateway.calls[0].body.input))
  } finally {
    gateway.restore()
  }
})

test('askAi cae al modelo gratis si el oficial falla', async () => {
  const gateway = gatewaySock((url, body, attempt) =>
    body.model === 'gpt-5.6-terra' || body.model === 'gpt-5-nano'
      ? { status: 402, contentType: 'application/json', text: JSON.stringify({ error: { message: 'insufficient credits' } }) }
      : { text: chatSse(`respondió ${body.model}`) }
  )
  try {
    const answer = await askAi({ request: 'chatgpt', prompt: 'hola', config: aiConfig({ apiKey: 'sk-real' }) })
    assert.equal(answer.fallback, true, 'avisa que usó un respaldo')
    assert.ok(isFreeModel(answer.model))
    assert.match(answer.text, /^respondió /)
    assert.ok(gateway.calls.length >= 2)
  } finally {
    gateway.restore()
  }
})

test('askAi reintenta el mismo modelo ante un 429 y sigue la cadena', async () => {
  let attempts = 0
  const gateway = gatewaySock((url, body) => {
    attempts += 1
    if (body.model === 'deepseek-v4.1-flash') {
      return attempts <= 2
        ? { status: 429, contentType: 'application/json', text: '{"error":{"message":"rate limit"}}' }
        : { text: chatSse('a la tercera va la vencida') }
    }
    return { text: chatSse('otro modelo') }
  })
  try {
    const answer = await askAi({
      request: 'deepseek',
      prompt: 'hola',
      config: aiConfig({ apiKey: 'sk-real', retriesPerModel: 3 })
    })
    assert.equal(answer.text, 'a la tercera va la vencida')
    assert.equal(answer.model, 'deepseek-v4.1-flash')
    assert.equal(answer.fallback, false)
  } finally {
    gateway.restore()
  }
})

test('askAi descarta una respuesta que solo trae llamadas a herramienta', async () => {
  const gateway = gatewaySock((url, body) =>
    body.model === 'deepseek-v4.1-flash'
      ? {
          text: `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { name: 'read', arguments: '{}' } }] } }] })}`
        }
      : { text: chatSse('texto de verdad') }
  )
  try {
    const answer = await askAi({ request: 'deepseek', prompt: 'hola', config: aiConfig({ apiKey: 'sk-real', retriesPerModel: 1 }) })
    assert.equal(answer.text, 'texto de verdad')
    assert.notEqual(answer.model, 'deepseek-v4.1-flash')
  } finally {
    gateway.restore()
  }
})

test('askAi acepta JSON puro cuando el servidor ignora el streaming', async () => {
  const gateway = gatewaySock(() => ({
    contentType: 'application/json',
    text: JSON.stringify({ choices: [{ message: { content: 'respuesta sin stream' } }] })
  }))
  try {
    const answer = await askAi({ request: 'deepseek', prompt: 'hola', config: aiConfig({ apiKey: '' }) })
    assert.equal(answer.text, 'respuesta sin stream')
  } finally {
    gateway.restore()
  }
})

test('askAi recorta una respuesta larguísima al límite de WhatsApp', async () => {
  const gateway = gatewaySock(() => ({ text: chatSse('a'.repeat(20_000)) }))
  try {
    const answer = await askAi({ request: 'deepseek', prompt: 'hola', config: aiConfig({ apiKey: '', maxChars: 3500 }) })
    assert.ok(answer.text.length <= 3500)
    assert.match(answer.text, /…$/)
  } finally {
    gateway.restore()
  }
})

test('askAi recorta un prompt enorme antes de enviarlo', async () => {
  const gateway = gatewaySock((url, body) => ({ text: chatSse('ok') }))
  try {
    await askAi({
      request: 'deepseek',
      prompt: 'x'.repeat(50_000),
      config: aiConfig({ apiKey: '', maxInputChars: 6000 })
    })
    const sent = gateway.calls[0].body.messages.at(-1).content
    assert.ok(sent.length <= 6001)
  } finally {
    gateway.restore()
  }
})

test('askAi manda el system prompt y el historial', async () => {
  const gateway = gatewaySock(() => ({ text: chatSse('ok') }))
  try {
    await askAi({
      request: 'deepseek',
      prompt: '¿y la segunda?',
      system: 'Eres DeepSeek.',
      history: [{ role: 'user', content: 'primera' }, { role: 'assistant', content: 'respuesta' }],
      config: aiConfig({ apiKey: '' })
    })
    const messages = gateway.calls[0].body.messages
    assert.equal(messages[0].role, 'system')
    assert.equal(messages[0].content, 'Eres DeepSeek.')
    assert.deepEqual(messages.slice(1).map((message) => message.role), ['user', 'assistant', 'user'])
    assert.equal(messages.at(-1).content, '¿y la segunda?')
  } finally {
    gateway.restore()
  }
})

test('askAi lanza error claro si todos los modelos fallan', async () => {
  const gateway = gatewaySock(() => ({ status: 503, contentType: 'application/json', text: '{"error":{"message":"caído"}}' }))
  try {
    await assert.rejects(
      () => askAi({ request: 'gemini', prompt: 'hola', config: aiConfig({ apiKey: '', retriesPerModel: 1 }) }),
      (error) => {
        assert.ok(error instanceof AiError)
        assert.equal(error.status, 503)
        return true
      }
    )
  } finally {
    gateway.restore()
  }
})

test('askAi rechaza un prompt vacío y la IA desactivada', async () => {
  await assert.rejects(() => askAi({ request: 'gemini', prompt: '   ', config: aiConfig() }), /Escribe qué/)
  await assert.rejects(
    () => askAi({ request: 'gemini', prompt: 'hola', config: aiConfig({ enabled: false }) }),
    /desactivada/
  )
})

test('askAi avisa si no queda ningún modelo utilizable', async () => {
  await assert.rejects(
    () =>
      askAi({
        request: 'gemini',
        prompt: 'hola',
        config: aiConfig({ apiKey: '', models: { gemini: ['gemini-3-flash'] }, freeModels: [], freeTierFallback: true })
      }),
    /No hay modelos configurados|OPENCODE_API_KEY/
  )
})

test('friendlyAiError traduce los fallos típicos a lenguaje de chat', () => {
  assert.match(friendlyAiError(new AiError('x', { status: 401 }), 'Gemini'), /clave de OpenCode/)
  assert.match(friendlyAiError(new AiError('x', { status: 402 }), 'Gemini'), /créditos/)
  assert.match(friendlyAiError(new AiError('x', { status: 429 }), 'Gemini'), /saturada/)
  assert.match(friendlyAiError(new Error('fetch failed'), 'Gemini'), /conexión/)
  assert.match(friendlyAiError(new Error('The operation was aborted'), 'Gemini'), /tardó demasiado/)
  assert.match(friendlyAiError(new Error('boom'), 'Gemini'), /boom/)
})

// ---------------------------------------------------------------------------
// Los tres comandos
// ---------------------------------------------------------------------------

test('los tres comandos de IA están registrados en la categoría ai', () => {
  for (const name of ['gemini', 'chatgpt', 'deepseek']) {
    const command = findCommand(name)
    assert.ok(command, `falta ${name}`)
    assert.equal(command.category, 'ai')
    assert.equal(typeof command.run, 'function')
    assert.match(command.usage, new RegExp(`\\.${name} <tu pregunta>`))
    assert.ok(command.examples.length >= 1)
  }
  // Alias
  assert.equal(findCommand('gpt'), findCommand('chatgpt'))
  assert.equal(findCommand('openai'), findCommand('chatgpt'))
  assert.equal(findCommand('deep'), findCommand('deepseek'))
  assert.equal(findCommand('geminiai'), findCommand('gemini'))
})

test('.gemini responde editando el mensaje de "pensando…"', async () => {
  const config = testConfig({ ai: aiConfig({ apiKey: '' }) })
  const { ctx, sock } = makeContext('.gemini explica el agua', { config })
  const gateway = gatewaySock(() => ({ text: chatSse('El agua es H2O.') }))
  try {
    const summary = await findCommand('gemini').run(ctx)
    const texts = sentTexts(sock)
    // Dos llamadas a sendMessage: el progreso y su EDICIÓN con la respuesta.
    // En el chat se ve un solo mensaje, no dos.
    assert.equal(texts.length, 2)
    assert.match(texts[0], /está pensando/, 'primero avisa que está pensando')
    const edits = sock.sent.filter((item) => item.content?.edit)
    assert.equal(edits.length, 1, 'editó el mensaje en vez de mandar otro')
    const answer = edits[0].content.text
    assert.match(answer, /💧 \*Gemini\*/)
    assert.match(answer, /El agua es H2O\./)
    assert.match(answer, /respondió deepseek-v4\.1-flash-free/, 'dice qué modelo contestó')
    assert.match(answer, /modelo de respaldo/, 'y aclara que fue un respaldo')
    assert.match(summary, /^gemini → /)
  } finally {
    gateway.restore()
  }
})

test('.chatgpt y .deepseek responden con su marca', async () => {
  const config = testConfig({ ai: aiConfig({ apiKey: '' }) })
  const gateway = gatewaySock(() => ({ text: chatSse('respuesta corta') }))
  try {
    const gpt = makeContext('.chatgpt hola', { config })
    await findCommand('chatgpt').run(gpt.ctx)
    assert.match(sentTexts(gpt.sock).at(-1), /💙 \*ChatGPT\*/)
    assert.match(sentTexts(gpt.sock).at(-1), /respuesta corta/)

    const deep = makeContext('.deepseek 2+2', { config })
    await findCommand('deepseek').run(deep.ctx)
    assert.match(sentTexts(deep.sock).at(-1), /🐟 \*DeepSeek\*/)
    assert.match(sentTexts(deep.sock).at(-1), /respuesta corta/)
  } finally {
    gateway.restore()
  }
})

test('con clave configurada no se menciona el modelo de respaldo', async () => {
  const config = testConfig({ ai: aiConfig({ apiKey: 'sk-real' }) })
  const { ctx, sock } = makeContext('.deepseek hola', { config })
  const deepSse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'respuesta oficial' } }] })}`
  const gateway = gatewaySock(() => ({ text: deepSse }))
  try {
    await findCommand('deepseek').run(ctx)
    const text = sock.sent.filter((item) => item.content?.edit)[0].content.text
    assert.match(text, /respuesta oficial/)
    assert.match(text, /respondió deepseek-v4\.1-flash_/)
    assert.ok(!text.includes('modelo de respaldo'), 'el modelo oficial no es un respaldo')
    assert.ok(!text.includes('OPENCODE_API_KEY'), 'con clave no hace falta el aviso')
  } finally {
    gateway.restore()
  }
})

test('los comandos de IA piden la pregunta si viene vacía', async () => {
  const config = testConfig({ ai: aiConfig({ apiKey: '' }) })
  for (const name of ['gemini', 'chatgpt', 'deepseek']) {
    const { ctx, sock } = makeContext(`.${name}`, { config })
    await assert.rejects(() => findCommand(name).run(ctx), /Escribe tu pregunta/)
    assert.equal(sentTexts(sock).length, 0, 'no manda el "pensando…" si falta la pregunta')
  }
})

test('si la IA falla, el progreso no queda colgado y se explica el motivo', async () => {
  const config = testConfig({ ai: aiConfig({ apiKey: '', retriesPerModel: 1 }) })
  const { ctx, sock } = makeContext('.gemini hola', { config })
  const gateway = gatewaySock(() => ({ status: 503, contentType: 'application/json', text: '{"error":{"message":"caído"}}' }))
  try {
    await assert.rejects(() => findCommand('gemini').run(ctx), /No pude conectar con Gemini/)
    const texts = sentTexts(sock)
    assert.ok(texts.some((text) => text.includes('❌ Sin respuesta.')), 'retira el "pensando…"')
    // El sock de prueba registra el envío original y su edición por separado;
    // en el chat la edición reemplaza al progreso, así que vale el último.
    const last = texts.at(-1)
    assert.equal(last, '❌ Sin respuesta.')
    assert.ok(!last.includes('está pensando'), 'no queda el progreso en pie')
    assert.match(texts.at(-2), /está pensando/, 'el progreso existió y se editó')
    assert.ok(sock.sent.some((item) => item.content?.edit), 'se editó en vez de mandar otro mensaje')
  } finally {
    gateway.restore()
  }
})

test('buildPrompt usa el argumento y el mensaje citado', () => {
  assert.equal(buildPrompt(makeContext('.gemini hola').ctx), 'hola')

  const quoted = makeContext('.gemini', { quoted: { conversation: 'texto citado largo' } }).ctx
  assert.equal(buildPrompt(quoted), 'texto citado largo', 'sin argumento usa solo la cita')

  const both = makeContext('.gemini resumí esto', { quoted: { conversation: 'un texto largo' } }).ctx
  const prompt = buildPrompt(both)
  assert.match(prompt, /^resumí esto/)
  assert.match(prompt, /Mensaje citado:/)
  assert.match(prompt, /un texto largo/)
})

test('runAiCommand aplica el system prompt de cada marca', async () => {
  const config = testConfig({ ai: aiConfig({ apiKey: '' }) })
  const gateway = gatewaySock(() => ({ text: chatSse('ok') }))
  try {
    const { ctx } = makeContext('.deepseek hola', { config })
    await runAiCommand(ctx, { request: 'deepseek', label: 'DeepSeek', emoji: '🐟', system: 'Eres DeepSeek.' })
    assert.equal(gateway.calls[0].body.messages[0].content, 'Eres DeepSeek.')
  } finally {
    gateway.restore()
  }
})

test('la configuración de IA trae los tres proveedores y el free tier', () => {
  const config = testConfig()
  assert.equal(config.ai.enabled, true)
  assert.match(config.ai.baseUrl, /opencode\.ai\/inference\/v1$/)
  assert.match(config.ai.googleBaseUrl, /opencode\.ai\/inference\/google\/v1beta$/)
  assert.equal(typeof config.ai.apiKey, 'string')
  for (const request of ['gemini', 'chatgpt', 'deepseek']) {
    assert.ok(Array.isArray(config.ai.models[request]), `falta ai.models.${request}`)
    assert.ok(config.ai.models[request].length >= 1)
  }
  assert.equal(config.ai.models.gemini[0].startsWith('gemini-'), true)
  assert.equal(config.ai.models.chatgpt[0].startsWith('gpt-'), true)
  assert.equal(config.ai.models.deepseek[0].startsWith('deepseek-'), true)
  assert.ok(config.ai.freeModels.every((model) => isFreeModel(model)), 'todos los respaldos son gratis')
  assert.ok(config.ai.maxChars <= 4000, 'la respuesta entra en un mensaje de WhatsApp')
})
