import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ROOT } from '../config.js'
import { withWorkDir } from './tmp.js'

const execFileAsync = promisify(execFile)

/** WhatsApp y el propio proceso agradecen no trabajar con archivos enormes. */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

const PLATFORM_HOSTS = {
  tiktok: {
    label: 'TikTok',
    hosts: ['tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com']
  },
  instagram: {
    label: 'Instagram',
    hosts: ['instagram.com', 'instagr.am']
  },
  youtube: {
    label: 'YouTube',
    hosts: ['youtube.com', 'youtu.be', 'music.youtube.com']
  },
  pinterest: {
    label: 'Pinterest',
    // Pinterest usa dominios locales (pinterest.es, pinterest.com.mx, …) y el
    // acortador pin.it, por eso se acepta cualquier "pinterest.<tld>".
    hosts: ['pin.it', 'pinterestcdn.com'],
    hostPattern: /^([a-z0-9-]+\.)*pinterest\.[a-z]{2,3}(\.[a-z]{2,3})?$/
  }
}

/** Mimetypes de salida según la extensión que devolvió yt-dlp. */
const MIME_BY_EXTENSION = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif'
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

export function mimetypeForExtension(extension) {
  return MIME_BY_EXTENSION[String(extension || '').toLowerCase()] || 'application/octet-stream'
}

export function isImageExtension(extension) {
  return IMAGE_EXTENSIONS.has(String(extension || '').toLowerCase())
}

let cachedBinary
let binaryChecked = false

/** Extrae la primera URL del texto que escribió el usuario. */
export function extractFirstUrl(text = '') {
  const match = String(text).match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return ''
  return match[0].replace(/[),.;!?]+$/g, '')
}

function hostMatches(hostname, platformInfo) {
  const host = String(hostname || '').toLowerCase()
  const allowedHosts = platformInfo?.hosts || []
  if (platformInfo?.hostPattern && platformInfo.hostPattern.test(host)) return true
  return allowedHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export function platformLabel(platform) {
  return PLATFORM_HOSTS[platform]?.label || 'esa plataforma'
}

/**
 * Valida que el enlace pertenezca a la plataforma del comando.
 * Así `.tiktok` no termina descargando cualquier URL arbitraria.
 */
export function validateDownloadUrl(platform, text, usage = '') {
  const platformInfo = PLATFORM_HOSTS[platform]
  if (!platformInfo) throw new Error(`Plataforma de descarga no soportada: ${platform}`)

  const rawUrl = extractFirstUrl(text)
  if (!rawUrl) {
    throw new Error(usage || `Pega un enlace de ${platformInfo.label} después del comando.`)
  }

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`El enlace de ${platformInfo.label} no es válido.`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Por seguridad solo acepto enlaces HTTPS de ${platformInfo.label}.`)
  }
  if (!hostMatches(url.hostname, platformInfo)) {
    throw new Error(`Ese enlace no parece ser de ${platformInfo.label}.`)
  }
  return url.toString()
}

/**
 * Argumentos de yt-dlp. Se usa execFile (sin shell), por lo que la URL viaja
 * como un argumento separado y no puede inyectar comandos.
 */
export function buildYtDlpArgs({ platform, mediaType = 'video', url, outputTemplate }) {
  if (!platform || !url || !outputTemplate) {
    throw new Error('buildYtDlpArgs requiere platform, url y outputTemplate')
  }

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--socket-timeout', '20',
    '--retries', '2',
    '--fragment-retries', '2',
    '--max-filesize', '100M',
    '-o', outputTemplate
  ]

  if (mediaType === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5')
  } else if (platform === 'youtube') {
    args.push(
      '-f', 'bv*[ext=mp4]+ba[ext=m4a]/mp4/best',
      '--merge-output-format', 'mp4'
    )
  } else {
    args.push('-f', 'bv*+ba/best[ext=mp4]/best', '--merge-output-format', 'mp4')
  }

  args.push(url)
  return args
}

function binaryCandidates() {
  const candidates = []
  if (process.env.YTDLP_PATH) candidates.push(process.env.YTDLP_PATH)
  candidates.push(
    path.join(ROOT, 'bin', 'yt-dlp'),
    path.join(ROOT, 'vendor', 'yt-dlp', 'yt-dlp'),
    path.join(ROOT, 'bin', 'yt-dlp.exe'),
    'yt-dlp'
  )
  return candidates
}

/** Busca yt-dlp en rutas locales del proyecto o en el PATH. */
export async function resolveYtDlp({ force = false } = {}) {
  if (binaryChecked && !force) return cachedBinary
  binaryChecked = true
  cachedBinary = null

  for (const candidate of binaryCandidates()) {
    const isLocalPath = candidate.includes(path.sep)
    if (isLocalPath && !existsSync(candidate)) continue
    try {
      const { stdout } = await execFileAsync(candidate, ['--version'], {
        timeout: 15000,
        windowsHide: true
      })
      cachedBinary = { path: candidate, version: String(stdout).trim().split('\n')[0] }
      return cachedBinary
    } catch {
      /* prueba el siguiente candidato */
    }
  }
  return null
}

export function friendlyDownloaderError(error, platform = '') {
  const label = platformLabel(platform)
  const raw = String(error?.stderr || error?.message || error || '')
  const tail = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' | ')
    .slice(0, 260)

  if (/sign in|login required|cookies|private|age-restricted|confirm your age/i.test(raw)) {
    return `No pude descargar ese contenido de ${label}: parece privado o requiere iniciar sesión. Prueba con un enlace público.`
  }
  if (/timed out|timeout/i.test(raw) || error?.killed) {
    return `La descarga de ${label} tardó demasiado. Prueba con un video más corto.`
  }
  if (/unsupported url|no video formats|format is not available/i.test(raw)) {
    return `No encontré un formato descargable para ese enlace de ${label}.`
  }
  return `No pude descargar el contenido de ${label}${tail ? `: ${tail}` : '.'}`
}

/**
 * Descarga el medio con yt-dlp y lo devuelve en memoria.
 * Requiere yt-dlp (y FFmpeg para unir audio/video o extraer MP3).
 */
export async function downloadWithYtDlp({ platform, mediaType = 'video', url, logger } = {}) {
  const binary = await resolveYtDlp()
  if (!binary) {
    throw new Error(
      'Falta yt-dlp, necesario para los descargadores. En Termux: pkg install yt-dlp. ' +
        'En Linux: sudo apt install yt-dlp o pip install -U yt-dlp. También puedes definir YTDLP_PATH.'
    )
  }

  return withWorkDir(async (dir) => {
    const outputTemplate = path.join(dir, 'download.%(ext)s')
    const args = buildYtDlpArgs({ platform, mediaType, url, outputTemplate })

    try {
      await execFileAsync(binary.path, args, {
        timeout: 240000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true
      })
    } catch (error) {
      logger?.debug?.(`yt-dlp falló para ${platform}: ${error.message}`)
      throw new Error(friendlyDownloaderError(error, platform))
    }

    const files = []
    for (const name of await readdir(dir)) {
      if (!name.startsWith('download.')) continue
      const filePath = path.join(dir, name)
      const info = await stat(filePath)
      if (info.isFile()) files.push({ name, filePath, size: info.size })
    }
    files.sort((a, b) => b.size - a.size)

    const file = files[0]
    if (!file) throw new Error(`yt-dlp terminó sin generar un archivo de ${platformLabel(platform)}.`)
    if (file.size > MAX_DOWNLOAD_BYTES) {
      throw new Error('El archivo supera los 100 MB permitidos para enviarlo por WhatsApp.')
    }

    const extension = path.extname(file.name).replace('.', '').toLowerCase() || 'mp4'
    const kind = mediaType === 'audio' ? 'audio' : isImageExtension(extension) ? 'image' : 'video'
    return {
      buffer: await readFile(file.filePath),
      bytes: file.size,
      extension,
      kind,
      fileName: `tomioka-${platform}.${extension}`,
      mimetype: mediaType === 'audio' ? 'audio/mpeg' : mimetypeForExtension(extension)
    }
  })
}
