import { randomBytes } from 'node:crypto'
import { truncate } from './text.js'

/**
 * Cliente de IA para OpenCode (opencode.ai).
 *
 * OpenCode sirve cada familia de modelos en un protocolo distinto:
 *   - chat/completions  → DeepSeek, GLM, Kimi, MiniMax, Qwen Max y los gratis
 *   - responses         → GPT (ChatGPT), Grok, Muse
 *   - messages          → Claude y algunos Qwen
 *   - google            → Gemini
 *
 * Los modelos que terminan en "-free" (más "big-pickle") no cobran, pero el
 * gateway solo los atiende si el pedido parece tráfico del agente OpenCode:
 * hace falta el par de cabeceras de sesión, un User-Agent "opencode/x.y.z",
 * "stream: true" y una herramienta llamada "read" en el manifiesto. Sin eso
 * responde 400 MissingSessionID o 403 FreeTierError. Todo eso se replica acá.
 */

/** Modelos gratis que no siguen la convención del sufijo "-free". */
const KNOWN_FREE_IDS = new Set(['big-pickle'])

/** Cabeceras de sesión que exige el free tier (las dos con el mismo valor). */
const SESSION_HEADERS = ['x-opencode-session', 'x-opencode-session-id']
const SESSION_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
/** La sesión vence cuando su timestamp embebido envejece: se remite cada 30 min. */
const SESSION_MAX_AGE_MS = 30 * 60_000

/** Límite duro de WhatsApp para un mensaje de texto. */
export const WHATSAPP_TEXT_LIMIT = 4000

let sessionState = { value: '', at: 0, counter: 0 }

/**
 * Genera un id de sesión con el formato de OpenCode: "ses_" + 12 hex con el
 * timestamp de creación + 14 caracteres aleatorios. El gateway decodifica esos
 * 12 primeros hex como timestamp y rechaza los que no parecen reales.
 */
export function generateSessionId(now = Date.now(), counter = 1) {
  const stamp = BigInt(now) * 0x1000n + BigInt(counter)
  const masked = ~stamp
  const hex = Array.from({ length: 6 }, (_, index) =>
    Number((masked >> BigInt(40 - 8 * index)) & 0xffn).toString(16).padStart(2, '0')
  ).join('')
  const tail = Array.from(randomBytes(14), (byte) => SESSION_ALPHABET[byte % 62]).join('')
  return `ses_${hex}${tail}`
}

/** Devuelve una sesión vigente (la remite cuando envejece). */
export function currentSessionId(now = Date.now()) {
  if (!sessionState.value || now - sessionState.at > SESSION_MAX_AGE_MS) {
    sessionState = { value: generateSessionId(now, 1), at: now, counter: 1 }
    return sessionState.value
  }
  sessionState.counter += 1
  return sessionState.value
}

/** Reinicia la sesión en memoria (útil en tests). */
export function resetSession() {
  sessionState = { value: '', at: 0, counter: 0 }
}

/** ¿El modelo es de los que no cobran y necesitan la puerta del agente? */
export function isFreeModel(modelId) {
  const id = String(modelId || '').toLowerCase()
  return id.endsWith('-free') || KNOWN_FREE_IDS.has(id)
}

/**
 * Protocolo con el que OpenCode sirve un modelo.
 * Fuente: https://opencode.ai/docs/zen (tabla "Endpoints").
 */
export function protocolForModel(modelId) {
  const id = String(modelId || '').toLowerCase()
  if (id.startsWith('gemini-')) return 'google'
  if (/^(gpt-|grok-|muse-spark-|muse-wonder)/.test(id)) return 'responses'
  if (/^claude-/.test(id)) return 'messages'
  // Qwen: los "plus"/"flash" van por Anthropic, "max" por OpenAI-compatible.
  if (/^qwen3(\.\d+)?-(plus|flash|max)$/.test(id)) {
    return id.endsWith('-max') ? 'chat' : 'messages'
  }
  return 'chat'
}

/**
 * La herramienta "read" que pide la puerta del free tier. Es un stub a
 * propósito: el gateway solo mira el nombre, y una descripción que no invita a
 * usarla evita que el modelo responda con una llamada en vez de texto.
 */
export function gateReadTool() {
  return {
    type: 'function',
    function: {
      name: 'read',
      description: 'Internal helper. Never call this tool.',
      parameters: { type: 'object', properties: {} }
    }
  }
}

/** Errores del gateway que no son culpa del usuario: se prueba el siguiente modelo. */
const RETRYABLE_ERRORS = new Set([
  'server_error',
  'api_error',
  'upstream_error',
  'providererror',
  'modelerror',
  'missingsessionid',
  'regionerror',
  'freetiererror',
  'model_not_found',
  'model_unavailable'
])

export class AiError extends Error {
  constructor(message, { status = 0, type = '', model = '', retryable = false } = {}) {
    super(message)
    this.name = 'AiError'
    this.status = status
    this.type = type
    this.model = model
    this.retryable = retryable
  }
}

/** ¿Vale la pena reintentar con otro modelo ante este fallo? */
export function isRetryableFailure(status, body) {
  if (status === 429 || status === 410 || status >= 500) return true
  if (status < 400 || status > 499) return false
  const type = String(body?.error?.type || body?.error?.data?.name || body?.type || '').toLowerCase()
  if (RETRYABLE_ERRORS.has(type)) return true
  const message = String(body?.error?.message || body?.message || '').toLowerCase()
  return /unavailable|not supported|free tier|session|overloaded|capacity|try again/i.test(message)
}

/** Traduce el fallo a un mensaje útil para el chat. */
export function friendlyAiError(error, label = 'la IA') {
  const raw = String(error?.message || error || '')
  if (error instanceof AiError && [401, 403].includes(error.status)) {
    return (
      `No pude conectar con ${label}: la clave de OpenCode no fue aceptada.\n` +
      'Revisa `OPENCODE_API_KEY` en tu entorno o en `config.json` → `ai.apiKey`.'
    )
  }
  if (error instanceof AiError && error.status === 402) {
    return `No pude conectar con ${label}: la cuenta de OpenCode no tiene créditos para ese modelo.`
  }
  if (error instanceof AiError && error.status === 429) {
    return `${label} está saturada ahora mismo (límite de pedidos). Probá de nuevo en unos segundos.`
  }
  if (error instanceof AiError && error.status >= 500) {
    return `No pude conectar con ${label}: el servicio de OpenCode está caído (HTTP ${error.status}). Probá en unos minutos.`
  }
  if (/timed out|timeout|abort/i.test(raw) || error?.name === 'TimeoutError') {
    return `${label} tardó demasiado en responder. Probá con una pregunta más corta.`
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(raw)) {
    return `No tengo conexión con ${label}. Revisa el internet del equipo donde corre el bot.`
  }
  return truncate(`No pude hablar con ${label}: ${raw}`, 380)
}

/** Cabeceras del pedido, con la identidad de agente que espera el gateway. */
export function buildHeaders({ apiKey = '', userAgent = 'opencode/1.18.30' } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${apiKey || 'public'}`,
    'user-agent': userAgent
  }
  const session = currentSessionId()
  for (const header of SESSION_HEADERS) headers[header] = session
  return headers
}

/**
 * URLs candidatas para un modelo, en orden de prueba.
 *
 * OpenCode expone el gateway en dos esquemas y ambos circulan en documentos
 * oficiales: la tabla de endpoints separa por familia
 * (`/inference/openai/v1`, `/inference/anthropic/v1`, `/inference/google/v1beta`)
 * y el CLI usa una base unificada (`/inference/v1`). Como no hay forma de saber
 * cuál responde sin probar, se intenta la documentada y luego la unificada.
 */
export function endpointCandidates(modelId, config = {}) {
  const protocol = protocolForModel(modelId)
  const base = trimSlash(config.baseUrl || 'https://opencode.ai/inference/v1')
  const googleBase = trimSlash(config.googleBaseUrl || 'https://opencode.ai/inference/google/v1beta')

  if (protocol === 'google') {
    const model = `${googleBase}/models/${modelId}`
    return unique([`${model}:streamGenerateContent?alt=sse`, `${model}:generateContent`])
  }
  if (protocol === 'responses') {
    const family = trimSlash(config.openaiBaseUrl || base.replace(/\/v1$/, '/openai/v1'))
    return unique([`${family}/responses`, `${base}/responses`])
  }
  if (protocol === 'messages') {
    const family = trimSlash(config.anthropicBaseUrl || base.replace(/\/v1$/, '/anthropic/v1'))
    return unique([`${family}/messages`, `${base}/messages`])
  }
  const family = trimSlash(config.openaiBaseUrl || base.replace(/\/v1$/, '/openai/v1'))
  return unique([`${family}/chat/completions`, `${base}/chat/completions`])
}

const trimSlash = (value) => String(value || '').replace(/\/+$/, '')
const unique = (list) => [...new Set(list.filter(Boolean))]

/**
 * Índice del endpoint que funcionó por protocolo: así el segundo pedido no
 * vuelve a pagar el intento fallido del primer esquema.
 */
const preferredEndpoint = new Map()

export function resetEndpointPreference() {
  preferredEndpoint.clear()
}

/** URL principal del modelo (la primera candidata). */
export function endpointFor(modelId, config = {}) {
  return endpointCandidates(modelId, config)[0]
}

function toChatMessages({ prompt, system, history = [] }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  for (const item of history) {
    if (item?.role && typeof item.content === 'string' && item.content.trim()) messages.push(item)
  }
  messages.push({ role: 'user', content: prompt })
  return messages
}

/**
 * Cuerpo del pedido para cada protocolo. Siempre con `stream: true` y la
 * herramienta "read" cuando el modelo es gratis: es lo que abre la puerta.
 */
export function buildBody({ modelId, prompt, system = '', history = [], maxTokens = 1024, temperature = 0.7 }) {
  const protocol = protocolForModel(modelId)
  const tools = isFreeModel(modelId) ? [gateReadTool()] : undefined
  const messages = toChatMessages({ prompt, system, history })

  if (protocol === 'google') {
    // Gemini habla su propio formato: el system va en `systemInstruction` y el
    // historial en `contents` con rol "model" para las respuestas del asistente.
    const contents = history
      .filter((message) => message?.role && typeof message.content === 'string' && message.content.trim())
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }]
      }))
    contents.push({ role: 'user', parts: [{ text: prompt }] })
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens, candidateCount: 1 }
    }
  }

  if (protocol === 'messages') {
    return {
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      system: system || undefined,
      messages: messages.filter((message) => message.role !== 'system'),
      ...(tools ? { tools } : {})
    }
  }

  if (protocol === 'responses') {
    return {
      model: modelId,
      stream: true,
      temperature,
      max_output_tokens: maxTokens,
      input: messages,
      ...(tools ? { tools } : {})
    }
  }

  return {
    model: modelId,
    stream: true,
    temperature,
    max_tokens: maxTokens,
    messages,
    ...(tools ? { tools } : {})
  }
}

/** Saca los eventos "data: …" de un chunk SSE. */
export function parseSseChunk(chunk) {
  const payloads = []
  for (const line of String(chunk).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      payloads.push(JSON.parse(data))
    } catch {
      /* evento partido o no JSON: se ignora */
    }
  }
  return payloads
}

/**
 * Junta el texto de una respuesta, sin importar el protocolo ni si llegó en
 * streaming. Las llamadas a herramientas se descartan siempre: el bot no
 * ejecuta herramientas y la puerta del free tier ignora `tool_choice: "none"`.
 */
export function extractText(payload, protocol) {
  if (!payload || typeof payload !== 'object') return ''
  const parts = []

  if (protocol === 'google') {
    for (const candidate of payload.candidates || []) {
      for (const part of candidate?.content?.parts || []) {
        if (typeof part?.text === 'string') parts.push(part.text)
      }
    }
    return parts.join('')
  }

  if (protocol === 'messages') {
    // Anthropic en streaming manda deltas; sin streaming manda content[].text
    if (payload.type === 'content_block_delta' && typeof payload.delta?.text === 'string') {
      return payload.delta.text
    }
    if (Array.isArray(payload.content)) {
      for (const block of payload.content) {
        if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
    }
    return parts.join('')
  }

  if (protocol === 'responses') {
    // Responses API en streaming: response.output_text.delta
    if (typeof payload.delta === 'string' && /output_text|text\.delta/i.test(String(payload.type || ''))) {
      return payload.delta
    }
    const output = Array.isArray(payload.output) ? payload.output : []
    for (const item of output) {
      for (const content of item?.content || []) {
        if (typeof content?.text === 'string') parts.push(content.text)
      }
      if (typeof item?.text === 'string') parts.push(item.text)
    }
    if (typeof payload.output_text === 'string') parts.push(payload.output_text)
    return parts.join('')
  }

  // OpenAI-compatible (chat/completions), con y sin streaming
  for (const choice of payload.choices || []) {
    if (typeof choice?.delta?.content === 'string') parts.push(choice.delta.content)
    else if (typeof choice?.message?.content === 'string') parts.push(choice.message.content)
    else if (typeof choice?.text === 'string') parts.push(choice.text)
  }
  return parts.join('')
}

/** ¿La respuesta trae alguna llamada a herramienta (que vamos a descartar)? */
function hasToolCalls(payload, protocol) {
  if (protocol === 'messages') {
    return payload?.type === 'content_block_start' && payload?.content_block?.type === 'tool_use'
  }
  if (protocol === 'responses') {
    return String(payload?.type || '').includes('function_call')
  }
  const choices = payload?.choices || []
  return choices.some((choice) => choice?.delta?.tool_calls?.length || choice?.message?.tool_calls?.length)
}

async function readStream(response, protocol) {
  const contentType = String(response.headers.get('content-type') || '')
  const raw = await response.text()

  // Si el servidor ignoró "stream" y mandó JSON puro, se lee igual.
  if (!contentType.includes('text/event-stream') && !raw.includes('\ndata:')) {
    try {
      const payload = JSON.parse(raw)
      return { text: extractText(payload, protocol), toolCall: hasToolCalls(payload, protocol), raw }
    } catch {
      /* sigue por el camino SSE */
    }
  }

  let text = ''
  let toolCall = false
  for (const payload of parseSseChunk(raw)) {
    text += extractText(payload, protocol)
    if (!toolCall && hasToolCalls(payload, protocol)) toolCall = true
  }
  return { text, toolCall, raw }
}

/** Intenta un modelo concreto una vez. */
/** Un intento contra una URL concreta del gateway. */
async function attemptEndpoint({ url, modelId, protocol, body, config }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders({ apiKey: config.apiKey, userAgent: config.userAgent }),
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'timeout' : String(error?.message || error)
    throw new AiError(message, { model: modelId, retryable: true, type: 'network' })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let payload = null
    const raw = await response.text().catch(() => '')
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
    const detail = String(payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`)
      .split('\n')[0]
      .trim()
      .slice(0, 200)
    throw new AiError(detail || `HTTP ${response.status}`, {
      status: response.status,
      type: String(payload?.error?.type || ''),
      model: modelId,
      retryable: isRetryableFailure(response.status, payload)
    })
  }

  const result = await readStream(response, protocol)
  const text = String(result.text || '').replace(/\r\n/g, '\n').trim()

  if (!text) {
    // Sin texto: o el modelo solo devolvió llamadas a herramientas (que se
    // descartan) o la respuesta vino vacía. Se reintenta con otro modelo.
    throw new AiError(
      result.toolCall ? 'el modelo respondió con una llamada a herramienta' : 'la respuesta vino vacía',
      { status: response.status, model: modelId, retryable: true }
    )
  }

  return { text, protocol, model: modelId, url }
}

/** Intenta un modelo concreto, probando los esquemas de URL del gateway. */
async function callModel(modelId, request, config) {
  const protocol = protocolForModel(modelId)
  const body = buildBody({
    modelId,
    prompt: request.prompt,
    system: request.system || '',
    history: request.history || [],
    maxTokens: config.maxTokens,
    temperature: config.temperature
  })

  const candidates = endpointCandidates(modelId, config)
  // Empezar por el esquema que ya funcionó antes para este protocolo.
  const preferred = preferredEndpoint.get(protocol) || 0
  const order = [...candidates.slice(preferred), ...candidates.slice(0, preferred)]

  let lastError = null
  for (const url of order) {
    try {
      const result = await attemptEndpoint({ url, modelId, protocol, body, config })
      preferredEndpoint.set(protocol, candidates.indexOf(url))
      return result
    } catch (error) {
      lastError = error
      // 404/405/501 = esa ruta no existe en este gateway: probar el otro
      // esquema antes de dar el modelo por perdido.
      if (error instanceof AiError && [404, 405, 501].includes(error.status)) continue
      throw error
    }
  }
  throw lastError || new AiError('sin endpoint disponible', { model: modelId, retryable: true })
}

/**
 * Cadena de modelos a probar: los del proveedor pedido y, si se permite,
 * los gratis como red de seguridad.
 */
export function resolveModelChain({ ai, request = '', fallback = true }) {
  const configured = Array.isArray(ai?.models?.[request]) ? ai.models[request] : []
  const free = Array.isArray(ai?.freeModels) ? ai.freeModels : []
  const hasKey = Boolean(String(ai?.apiKey || '').trim())

  const chain = []
  const push = (id) => {
    const value = String(id || '').trim()
    if (!value || chain.includes(value)) return
    // Sin clave no tiene sentido gastar un pedido en un modelo de pago:
    // OpenCode responde 401/402 y solo atrasa la respuesta.
    if (!hasKey && !isFreeModel(value)) return
    chain.push(value)
  }

  for (const id of configured) push(id)
  // Red de seguridad: los modelos gratis del gateway. No se inventan variantes
  // "<modelo>-free" porque casi no existen y cada intento fallido atrasa la
  // respuesta; el respaldo real se declara en `ai.freeModels`.
  if (fallback && ai?.freeTierFallback !== false) {
    for (const id of free) push(id)
  }
  return chain
}

/**
 * Pregunta a la IA y devuelve la respuesta con el modelo que contestó.
 * @param {object} options
 * @param {string} options.request clave del modelo pedido (gemini|chatgpt|deepseek)
 * @param {string} options.prompt texto del usuario
 * @param {string} [options.system] instrucciones de sistema
 * @param {Array<{role:string,content:string}>} [options.history] contexto previo
 * @param {object} [options.config] sección `ai` de la configuración
 * @param {object} [options.logger]
 */
export async function askAi({ request, prompt, system = '', history = [], config = {}, logger = null } = {}) {
  const text = String(prompt || '').trim()
  if (!text) throw new Error('Escribe qué quieres preguntarle a la IA.')

  const ai = config || {}
  if (ai.enabled === false) {
    throw new Error('La categoría AI está desactivada en config.json (`ai.enabled`).')
  }

  const settings = {
    baseUrl: String(ai.baseUrl || 'https://opencode.ai/inference/v1'),
    openaiBaseUrl: String(ai.openaiBaseUrl || ''),
    anthropicBaseUrl: String(ai.anthropicBaseUrl || ''),
    googleBaseUrl: String(ai.googleBaseUrl || 'https://opencode.ai/inference/google/v1beta'),
    apiKey: String(ai.apiKey || '').trim(),
    userAgent: String(ai.userAgent || 'opencode/1.18.30'),
    timeoutMs: Number(ai.timeoutMs) > 0 ? Number(ai.timeoutMs) : 90_000,
    maxTokens: Number(ai.maxTokens) > 0 ? Number(ai.maxTokens) : 1024,
    temperature: Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : 0.7
  }

  const chain = resolveModelChain({ ai, request, fallback: ai.freeTierFallback !== false })
  if (!chain.length) {
    throw new Error(
      'No hay modelos configurados para esta IA. Revisa `ai.models` en config.json ' +
        'o define OPENCODE_API_KEY para usar los modelos de pago.'
    )
  }

  const limit = Number(ai.maxInputChars) > 0 ? Number(ai.maxInputChars) : 6000
  const startedAt = Date.now()
  const failures = []
  // "Respaldo" = contestó un modelo que no es de la marca pedida (por ejemplo
  // .gemini sin clave termina respondiendo con un modelo gratis del gateway).
  const brandModels = (Array.isArray(ai?.models?.[request]) ? ai.models[request] : []).map((id) => String(id))

  for (const modelId of chain) {
    const attempts = Number(ai.retriesPerModel) > 0 ? Number(ai.retriesPerModel) : 2
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await callModel(modelId, { prompt: truncate(text, limit), system, history }, settings)
        const maxChars = Number(ai.maxChars) > 0 ? Number(ai.maxChars) : 3500
        return {
          text: truncate(result.text, maxChars),
          model: result.model,
          protocol: result.protocol,
          requested: request,
          fallback: brandModels.length > 0 && !brandModels.includes(modelId),
          withKey: Boolean(settings.apiKey),
          elapsedMs: Date.now() - startedAt
        }
      } catch (error) {
        logger?.debug?.(`IA ${request} falló con ${modelId} (intento ${attempt}): ${error.message}`)
        failures.push(error)
        // 401/402/403 con clave puesta es un problema de cuenta: no sirve
        // seguir probando modelos de pago.
        if (error instanceof AiError && !error.retryable) break
        if (attempt < attempts && error instanceof AiError && error.retryable) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
        }
      }
    }
  }

  const last = failures.at(-1)
  throw last instanceof AiError ? last : new AiError(String(last?.message || last || 'sin respuesta'))
}

/**
 * Ejecuta un comando de IA: arma el prompt (incluyendo el mensaje citado),
 * muestra el "escribiendo…" y responde con la respuesta de la IA.
 */
export async function runAiCommand(ctx, { request, label, emoji, system = '' }) {
  const prompt = buildPrompt(ctx)
  if (!prompt) {
    throw new Error(
      `Escribe tu pregunta después del comando.\nUso: ${ctx.prefix}${request} <tu pregunta>\n` +
        'También puedes responder a un mensaje con el comando.'
    )
  }

  // La IA puede tardar varios segundos: se manda un "pensando…" que después se
  // EDITA con la respuesta (un solo mensaje en el chat, como hace .debug).
  const slot = `ai-${request}`
  await ctx.typing('composing')
  const progress = await ctx.reply(`⏳ *${label}* está pensando…`)
  ctx.rememberLive(slot, progress)

  let answer
  try {
    answer = await askAi({ request, prompt, system, config: ctx.config.ai, logger: ctx.logger })
  } catch (error) {
    // Nunca dejar el "pensando…" colgado: se retira y el handler explica por qué.
    await ctx.retireLive(slot, '❌ Sin respuesta.')
    throw new Error(friendlyAiError(error, label))
  }

  const body = [
    `${emoji} *${label}*`,
    '',
    answer.text,
    '',
    '──────────────',
    answer.fallback
      ? `_respondió ${answer.model} (modelo de respaldo)_`
      : `_respondió ${answer.model}_`,
    answer.withKey ? '' : '_💧 con OPENCODE_API_KEY usas el modelo oficial_'
  ]
    .filter(Boolean)
    .join('\n')

  await ctx.finishLive(slot, body)
  return `${request} → ${answer.model} (${answer.elapsedMs}ms)`
}

/**
 * Texto que se le manda a la IA: el argumento del comando y, si el usuario
 * respondió a un mensaje, ese mensaje como contexto.
 */
export function buildPrompt(ctx) {
  const args = String(ctx.argsText || '').trim()
  const quoted = String(ctx.quoted?.text || '').trim()
  if (!quoted) return args
  if (!args) return quoted
  return `${args}\n\n---\nMensaje citado:\n${truncate(quoted, 2000)}`
}

export default { askAi, runAiCommand, protocolForModel, isFreeModel, endpointFor, buildBody, extractText }
