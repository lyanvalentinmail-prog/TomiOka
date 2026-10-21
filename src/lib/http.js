import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Descarga buffers con timeout, reintentos y límite de tamaño */

const DEFAULT_TIMEOUT = 30000

export class HttpError extends Error {
  constructor(message, { status, url } = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

/**
 * Descarga una URL y devuelve un Buffer.
 * @param {string} url
 * @param {{timeoutMs?:number, maxBytes?:number, retries?:number, headers?:object}} options
 */
export async function fetchBuffer(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    maxBytes = 40 * 1024 * 1024,
    retries = 2,
    headers = {}
  } = options

  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
          accept: '*/*',
          ...headers
        }
      })
      if (!response.ok) {
        throw new HttpError(`HTTP ${response.status} al descargar ${url}`, {
          status: response.status,
          url
        })
      }
      const declared = Number(response.headers.get('content-length') || 0)
      if (declared && declared > maxBytes) {
        throw new HttpError(`El archivo supera el límite de ${Math.round(maxBytes / 1048576)} MB`, {
          url
        })
      }
      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > maxBytes) {
        throw new HttpError(
          `El archivo supera el límite de ${Math.round(maxBytes / 1048576)} MB`,
          { url }
        )
      }
      return Buffer.from(arrayBuffer)
    } catch (error) {
      lastError = error
      const retryable = !(error instanceof HttpError && error.status && error.status < 500)
      if (attempt === retries || !retryable) break
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * Descarga una URL directamente a un archivo (streaming, sin cargar todo en memoria).
 * @returns {Promise<{bytes:number, total:number}>}
 */
export async function downloadToFile(url, destination, options = {}) {
  const { timeoutMs = 300000, onProgress, headers = {} } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
        accept: '*/*',
        ...headers
      }
    })
    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} al descargar ${url}`, {
        status: response.status,
        url
      })
    }
    const total = Number(response.headers.get('content-length') || 0)
    let received = 0
    const source = Readable.fromWeb(response.body)
    source.on('data', (chunk) => {
      received += chunk.length
      onProgress?.(received, total)
    })
    await pipeline(source, createWriteStream(destination))
    return { bytes: received, total: total || received }
  } finally {
    clearTimeout(timer)
  }
}

/** Descarga JSON */
export async function fetchJson(url, options = {}) {
  const buffer = await fetchBuffer(url, options)
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw new Error(`Respuesta JSON inválida de ${url}: ${error.message}`)
  }
}
