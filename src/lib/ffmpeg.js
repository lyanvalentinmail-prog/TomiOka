import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { ROOT } from '../config.js'
import { withWorkDir } from './tmp.js'

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

function parseVersion(text) {
  const match = String(text).match(/ffmpeg version (\S+)/i)
  return match ? match[1] : ''
}

function versionNumber(version) {
  const match = String(version).match(/(\d+)\.(\d+)/)
  if (!match) return 0
  return Number(match[1]) * 100 + Number(match[2])
}

/**
 * Busca un binario de ffmpeg utilizable y guarda sus capacidades.
 * @returns {Promise<{path:string, source:string, version:string, versionNumber:number, webp:boolean, webpAnim:boolean, encoders:string}|null>}
 */
export async function resolveFfmpeg({ force = false } = {}) {
  if (cached && !force) return cached

  const attempts = [
    ...binaryCandidates().map((bin) => ({ bin, source: 'local' })),
    { bin: process.env.FFMPEG_BIN || 'ffmpeg', source: 'path' }
  ]

  for (const attempt of attempts) {
    if (attempt.source === 'local' && !isExecutable(attempt.bin)) continue
    try {
      const { stdout } = await execFileAsync(attempt.bin, ['-version'], { timeout: 20000 })
      const version = parseVersion(stdout) || String(stdout).split('\n')[0]?.trim() || 'ffmpeg'
      const encoders = await listEncoders(attempt.bin)
      cached = {
        path: attempt.bin,
        source: attempt.source,
        version,
        versionNumber: versionNumber(version),
        webp: /libwebp/.test(encoders),
        webpAnim: /libwebp_anim/.test(encoders),
        encoders
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
      timeout: 30000,
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

/** Traduce el error de FFmpeg a un mensaje claro y accionable */
export function friendlyFfmpegError(rawError) {
  const raw = String(rawError?.stderr || rawError?.message || rawError || '')
  const tail = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' | ')

  // libwebp_anim primero: el mensaje de libwebp también coincide con el otro patrón
  if (/Unknown encoder 'libwebp_anim'/i.test(raw)) {
    return 'Tu FFmpeg no soporta stickers animados (falta libwebp_anim). Actualiza: pkg install ffmpeg'
  }
  if (/Unknown encoder 'libwebp/i.test(raw) || /Encoder \(codec libwebp\) not found/i.test(raw)) {
    return (
      'Tu FFmpeg no incluye el codificador WebP. ' +
      'En Termux: pkg install ffmpeg libwebp (y reinicia el bot).'
    )
  }
  if (/No such file or directory/i.test(raw)) {
    return `FFmpeg no encontró un archivo (${tail}).`
  }
  if (/Invalid data found when processing input|moov atom not found|End of file/i.test(raw)) {
    return 'El archivo está dañado o no es un formato compatible.'
  }
  if (/No space left on device/i.test(raw)) {
    return 'No hay espacio libre en el dispositivo para procesar el archivo.'
  }
  if (rawError?.killed || /timed out/i.test(raw)) {
    return 'La conversión tardó demasiado. Prueba con un archivo más corto o más liviano.'
  }
  return `FFmpeg falló: ${tail || 'error desconocido'}`
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
    const friendly = friendlyFfmpegError(error)
    const wrapped = new Error(friendly)
    wrapped.stderr = String(error?.stderr || '')
    wrapped.cause = error
    throw wrapped
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

/**
 * Variantes de argumentos para crear un sticker, de la más completa a la más
 * compatible. Se prueban en orden: si FFmpeg rechaza una opción se usa la
 * siguiente (así funciona igual en Termux, VPS o Windows con FFmpeg viejo).
 */
export function stickerArgVariants({
  input,
  output,
  animated = false,
  size = 512,
  fps = 15,
  quality = 82,
  lossless = false,
  maxSeconds = 6.5
} = {}) {
  if (!input || !output) throw new Error('stickerArgVariants requiere input y output')

  const q = String(Math.max(0, Math.min(100, Math.round(quality))))
  const filters = animated ? `fps=${fps},${scaleFilter(size)}` : scaleFilter(size)

  const base = []
  if (animated && maxSeconds > 0) base.push('-t', String(maxSeconds))
  base.push('-i', input)
  if (!animated) base.push('-frames:v', '1')
  base.push('-vf', filters)

  const make = ({ codec, preset = false, quality100 = false, loop = false }) => {
    const args = [...base, '-c:v', codec]
    if (loop) args.push('-loop', '0')
    if (preset) args.push('-preset', 'default')
    if (quality100) args.push('-q:v', q, '-lossless', lossless ? '1' : '0')
    else args.push('-quality', q)
    args.push('-an', '-y', output)
    return args
  }

  if (animated) {
    return [
      {
        label: 'anim (preset + loop)',
        args: make({ codec: 'libwebp_anim', preset: true, quality100: true, loop: true })
      },
      { label: 'anim (sin preset)', args: make({ codec: 'libwebp_anim', quality100: true, loop: true }) },
      { label: 'anim (compatible)', args: make({ codec: 'libwebp_anim', quality100: false, loop: true }) },
      { label: 'anim (sin loop)', args: make({ codec: 'libwebp_anim', quality100: true }) },
      { label: 'anim (mínimo)', args: make({ codec: 'libwebp_anim', quality100: false }) },
      {
        label: 'anim → estático',
        args: make({ codec: 'libwebp', quality100: false }),
        staticFallback: true
      }
    ]
  }

  return [
    { label: 'estático (preset)', args: make({ codec: 'libwebp', preset: true, quality100: true }) },
    { label: 'estático (compatible)', args: make({ codec: 'libwebp', quality100: true }) },
    { label: 'estático (mínimo)', args: make({ codec: 'libwebp', quality100: false }) }
  ]
}

/** Argumentos principales (compatibilidad con versiones anteriores) */
export function buildStickerArgs(options) {
  return stickerArgVariants(options)[0].args
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
export const ANIMATED_EXTENSIONS = new Set([
  'mp4',
  'gif',
  'mkv',
  'webm',
  'mov',
  'avi',
  '3gp',
  'm4v',
  'ts'
])

export function isAnimatedExtension(ext = '') {
  return ANIMATED_EXTENSIONS.has(String(ext).toLowerCase().replace('.', ''))
}

/**
 * Autodiagnóstico real de FFmpeg: genera un video de prueba con lavfi y hace
 * todo el recorrido (png → webp → webp animado → png → mp4 → webp 96px).
 * @returns {Promise<{ok:boolean, ffmpeg:object|null, steps:Array, hint?:string}>}
 */
export async function selfTestFfmpeg({ logger } = {}) {
  const steps = []
  const info = await resolveFfmpeg({ force: true })

  if (!info) {
    return {
      ok: false,
      ffmpeg: null,
      steps: [{ name: 'ffmpeg disponible', ok: false, error: 'no se encontró el binario' }],
      hint: 'Instala FFmpeg: en Termux "pkg install ffmpeg" · Debian/Ubuntu "sudo apt install ffmpeg".'
    }
  }

  const run = async (name, args, timeout = 60000) => {
    const started = Date.now()
    try {
      await ffmpeg(args, { timeout })
      steps.push({ name, ok: true, ms: Date.now() - started })
      return true
    } catch (error) {
      steps.push({ name, ok: false, error: error.message, ms: Date.now() - started })
      logger?.warn?.(`Autodiagnóstico FFmpeg "${name}": ${error.message}`)
      return false
    }
  }

  try {
    await withWorkDir(async (dir) => {
      const source = path.join(dir, 'source.png')
      const staticWebp = path.join(dir, 'static.webp')
      const animWebp = path.join(dir, 'anim.webp')
      const backPng = path.join(dir, 'back.png')
      const video = path.join(dir, 'video.mp4')
      const tray = path.join(dir, 'tray.png')

      const generated = await run('generar imagen de prueba', [
        '-f',
        'lavfi',
        '-i',
        'color=c=#0ea5e9:s=96x96',
        '-frames:v',
        '1',
        '-y',
        source
      ])
      if (!generated) return

      const variants = stickerArgVariants({
        input: source,
        output: staticWebp,
        animated: false,
        size: 512,
        quality: 80
      })
      for (const variant of variants) {
        if (await run(`estático: ${variant.label}`, variant.args)) break
      }
      if (existsSync(staticWebp)) {
        steps.push({ name: 'tamaño del sticker estático', ok: statSync(staticWebp).size > 100 })
      }

      const animSource = path.join(dir, 'source.mp4')
      if (
        await run('generar video de prueba', [
          '-f',
          'lavfi',
          '-i',
          'testsrc=s=96x96:r=8:d=1',
          '-pix_fmt',
          'yuv420p',
          '-y',
          animSource
        ])
      ) {
        const animVariants = stickerArgVariants({
          input: animSource,
          output: animWebp,
          animated: true,
          size: 512,
          fps: 8,
          quality: 70,
          maxSeconds: 1
        })
        for (const variant of animVariants) {
          if (await run(`animado: ${variant.label}`, variant.args)) break
        }
      }

      if (existsSync(staticWebp)) {
        await run('sticker → png', buildToImageArgs({ input: staticWebp, output: backPng }))
        await run(
          'sticker → mp4',
          buildStillVideoArgs({ input: backPng, output: video, seconds: 1, fps: 10 })
        )
        await run('sticker → tray 96px', buildTrayArgs({ input: staticWebp, output: tray, size: 96 }))
      }
    })
  } catch (error) {
    steps.push({ name: 'carpeta temporal', ok: false, error: error.message })
  }

  const ok = steps.length > 0 && steps.every((step) => step.ok)
  const firstFailure = steps.find((step) => !step.ok)
  return {
    ok,
    ffmpeg: {
      path: info.path,
      source: info.source,
      version: info.version,
      versionNumber: info.versionNumber,
      webp: info.webp,
      webpAnim: info.webpAnim
    },
    steps,
    hint: ok
      ? undefined
      : firstFailure?.error?.includes('codificador WebP')
        ? 'Instala el FFmpeg oficial: en Termux "pkg install ffmpeg libwebp".'
        : firstFailure?.name === 'carpeta temporal'
          ? 'No se puede escribir en ninguna carpeta temporal. Define TOMIOKA_TMPDIR.'
          : 'Revisa el detalle de los pasos que fallaron (npm run selftest).'
  }
}
