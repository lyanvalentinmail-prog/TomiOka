import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { ROOT } from '../config.js'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

let cached = null

/** Rutas candidatas (sin tocar el PATH) */
function binaryCandidates() {
  const list = []
  if (process.env.FFMPEG_PATH) list.push(process.env.FFMPEG_PATH)
  list.push(path.join(ROOT, 'bin', 'ffmpeg'), path.join(ROOT, 'vendor', 'ffmpeg', 'ffmpeg'))

  for (const pkg of ['ffmpeg-static', '@ffmpeg-installer/ffmpeg']) {
    try {
      const resolved = require(pkg)
      const bin = typeof resolved === 'string' ? resolved : resolved?.path
      if (bin) list.push(bin)
    } catch {
      /* dependencia opcional no instalada */
    }
  }
  return list.filter((bin) => bin && typeof bin === 'string')
}

function isExecutable(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Busca un binario de ffmpeg utilizable.
 * @returns {Promise<{path:string, source:string, version:string, webp:boolean}|null>}
 */
export async function resolveFfmpeg({ force = false } = {}) {
  if (cached && !force) return cached

  const attempts = [
    ...binaryCandidates().map((bin) => ({ bin, source: 'local' })),
    { bin: 'ffmpeg', source: 'path' }
  ]

  for (const attempt of attempts) {
    if (attempt.source === 'local' && !isExecutable(attempt.bin)) continue
    try {
      const { stdout } = await execFileAsync(attempt.bin, ['-version'], { timeout: 15000 })
      const version = String(stdout).split('\n')[0]?.trim() || 'ffmpeg'
      const encoders = await listEncoders(attempt.bin)
      cached = {
        path: attempt.bin,
        source: attempt.source,
        version,
        webp: encoders.includes('libwebp') || encoders.includes('libwebp_anim')
      }
      return cached
    } catch {
      /* sigue con el próximo candidato */
    }
  }

  cached = null
  return null
}

async function listEncoders(bin) {
  try {
    const { stdout } = await execFileAsync(bin, ['-hide_banner', '-encoders'], {
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024
    })
    return String(stdout)
  } catch {
    return ''
  }
}

export function getFfmpegInfo() {
  return cached
}

/**
 * Ejecuta ffmpeg con argumentos ya construidos.
 * @throws Error con mensaje en español si falla
 */
export async function ffmpeg(args, { timeout = 180000 } = {}) {
  const info = await resolveFfmpeg()
  if (!info) {
    throw new Error(
      'FFmpeg no está instalado. En Termux ejecuta: pkg install ffmpeg (o define FFMPEG_PATH).'
    )
  }
  try {
    const result = await execFileAsync(info.path, args, {
      timeout,
      maxBuffer: 96 * 1024 * 1024,
      windowsHide: true
    })
    return result
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || '')
    const tail = stderr.split('\n').filter(Boolean).slice(-3).join(' | ')
    throw new Error(`FFmpeg falló: ${tail || 'error desconocido'}`)
  }
}

/** Filtro común de escala + relleno transparente */
export function scaleFilter(size) {
  return [
    `scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=lanczos`,
    'format=rgba',
    `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=#00000000`
  ].join(',')
}

/** Argumentos para convertir imagen/video/GIF en sticker webp */
export function buildStickerArgs({
  input,
  output,
  animated = false,
  size = 512,
  fps = 15,
  quality = 82,
  lossless = false,
  maxSeconds = 6.5
}) {
  if (!input || !output) throw new Error('buildStickerArgs requiere input y output')
  const filters = animated
    ? [`fps=${fps}`, scaleFilter(size)].join(',')
    : scaleFilter(size)

  const args = []
  if (animated && maxSeconds > 0) args.push('-t', String(maxSeconds))
  args.push('-i', input)
  if (!animated) args.push('-frames:v', '1')
  args.push('-vf', filters)
  args.push('-c:v', animated ? 'libwebp_anim' : 'libwebp')
  args.push('-loop', '0', '-preset', 'default')
  args.push('-q:v', String(Math.max(0, Math.min(100, Math.round(quality)))))
  args.push('-lossless', lossless ? '1' : '0')
  args.push('-an', '-vsync', '0', '-y', output)
  return args
}

/** Argumentos para sticker webp -> png */
export function buildToImageArgs({ input, output }) {
  if (!input || !output) throw new Error('buildToImageArgs requiere input y output')
  return ['-i', input, '-frames:v', '1', '-y', output]
}

/** Argumentos para sticker webp animado -> mp4 */
export function buildToVideoArgs({ input, output }) {
  if (!input || !output) throw new Error('buildToVideoArgs requiere input y output')
  return [
    '-i',
    input,
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-an',
    '-y',
    output
  ]
}

/** Argumentos para imagen estática -> mp4 (loop corto) */
export function buildStillVideoArgs({ input, output, seconds = 2, fps = 15 }) {
  if (!input || !output) throw new Error('buildStillVideoArgs requiere input y output')
  return [
    '-loop',
    '1',
    '-framerate',
    String(fps),
    '-t',
    String(seconds),
    '-i',
    input,
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-r',
    String(fps),
    '-an',
    '-y',
    output
  ]
}

/** Argumentos para generar la imagen "tray" del pack */
export function buildTrayArgs({ input, output, size = 96 }) {
  if (!input || !output) throw new Error('buildTrayArgs requiere input y output')
  return ['-i', input, '-frames:v', '1', '-vf', scaleFilter(size), '-y', output]
}

/** Tipos de archivo que ffmpeg puede convertir a sticker animado */
export const ANIMATED_EXTENSIONS = new Set(['mp4', 'gif', 'mkv', 'webm', 'mov', 'avi', '3gp', 'm4v'])

export function isAnimatedExtension(ext = '') {
  return ANIMATED_EXTENSIONS.has(String(ext).toLowerCase().replace('.', ''))
}
