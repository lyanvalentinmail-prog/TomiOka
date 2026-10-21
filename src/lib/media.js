import { writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildToImageArgs,
  buildToVideoArgs,
  buildStillVideoArgs,
  buildTrayArgs,
  ffmpeg,
  resolveFfmpeg,
  stickerArgVariants
} from './ffmpeg.js'
import { demuxWebpFrames, isAnimatedWebp } from './sticker.js'
import { withWorkDir } from './tmp.js'

const DEFAULT_SETTINGS = {
  size: 512,
  fps: 15,
  maxAnimatedSeconds: 6.5,
  quality: 82,
  lossless: false,
  maxStaticKB: 100,
  maxAnimatedKB: 500
}

function fileNameFor(extension) {
  const safe = String(extension || 'bin')
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/[^a-z0-9]/g, '')
  return safe || 'bin'
}

export async function assertFfmpeg() {
  const info = await resolveFfmpeg()
  if (!info) {
    throw new Error(
      'FFmpeg no está disponible. En Termux: pkg install ffmpeg (y luego reinicia el bot).'
    )
  }
  if (!info.webp) {
    throw new Error(
      'Tu FFmpeg no incluye el codificador WebP. Instala el paquete oficial: pkg install ffmpeg'
    )
  }
  return info
}

/** Planes de calidad: si el sticker queda demasiado pesado se reintenta más liviano */
export function qualityPlan({ animated, quality, fps }) {
  if (animated) {
    return [
      { quality, fps },
      { quality: Math.max(45, quality - 20), fps },
      { quality: 45, fps: Math.max(10, fps - 3) },
      { quality: 30, fps: 10 }
    ]
  }
  return [
    { quality, fps },
    { quality: Math.max(55, quality - 25), fps },
    { quality: 50, fps },
    { quality: 30, fps }
  ]
}

/**
 * Convierte una imagen / GIF / video en sticker WebP.
 * @param {Buffer} input
 * @param {{extension?:string, animated?:boolean, settings?:object, logger?:object}} options
 * @returns {Promise<{buffer:Buffer, bytes:number, animated:boolean, quality:number, fps:number, warning?:string}>}
 */
export async function convertToSticker(input, options = {}) {
  const {
    extension = 'png',
    animated = false,
    settings: custom = {},
    logger
  } = options
  const settings = { ...DEFAULT_SETTINGS, ...custom }
  await assertFfmpeg()

  return withWorkDir(async (dir) => {
    const inputFile = path.join(dir, `input.${fileNameFor(extension)}`)
    await writeFile(inputFile, input)

    const limitKB = animated ? settings.maxAnimatedKB : settings.maxStaticKB
    const plans = qualityPlan({
      animated,
      quality: Number(settings.quality) || 82,
      fps: Number(settings.fps) || 15
    })

    let best = null
    let lastError = null
    let fallbackEstatico = false
    let usedVariant = null
    let attempt = 0

    /** Prueba una lista de variantes y devuelve true si consiguió un sticker válido */
    const tryVariants = async (onlyFallback) => {
      for (const plan of plans) {
        const variants = stickerArgVariants({
          input: inputFile,
          output: path.join(dir, 'sticker.webp'),
          animated,
          size: settings.size,
          fps: plan.fps,
          quality: plan.quality,
          lossless: settings.lossless,
          maxSeconds: settings.maxAnimatedSeconds
        }).filter((variant) => Boolean(variant.staticFallback) === onlyFallback)

        for (const variant of variants) {
          attempt += 1
          const outputFile = path.join(dir, `sticker-${attempt}.webp`)
          const plannedOutput = path.join(dir, 'sticker.webp')
          const args = variant.args.map((arg) => (arg === plannedOutput ? outputFile : arg))
          try {
            await ffmpeg(args, { timeout: 120000 })
            const buffer = await readFile(outputFile)

            if (!best || buffer.length < best.bytes) {
              best = { buffer, ...plan, bytes: buffer.length }
              usedVariant = variant.label
              fallbackEstatico = Boolean(variant.staticFallback)
            }
            if (buffer.length <= limitKB * 1024) return true
            logger?.debug?.(`sticker ${buffer.length} B > ${limitKB} KB, bajando calidad`)
          } catch (error) {
            lastError = error
            logger?.debug?.(`Variante "${variant.label}" falló: ${error.message}`)
          }
        }

        if (best && best.bytes <= limitKB * 1024) return true
      }
      return false
    }

    // 1) Intentos normales (animado si corresponde). 2) Respaldo estático solo
    // si ningún intento normal funcionó en este FFmpeg.
    await tryVariants(false)
    if (!best) await tryVariants(true)

    if (!best) {
      throw lastError || new Error('No se pudo crear el sticker')
    }

    const warnings = []
    if (best.bytes > limitKB * 1024) {
      warnings.push(
        `El sticker pesa ${Math.round(best.bytes / 1024)} KB (WhatsApp recomienda ≤ ${limitKB} KB).`
      )
    }
    if (fallbackEstatico) {
      warnings.push('Tu FFmpeg no soporta WebP animado: se creó un sticker estático.')
    }

    logger?.debug?.(`sticker ok con variante "${usedVariant}" (${best.bytes} B)`)

    return {
      buffer: best.buffer,
      bytes: best.bytes,
      animated: fallbackEstatico ? false : animated,
      quality: best.quality,
      fps: best.fps,
      variant: usedVariant,
      warning: warnings.length ? warnings.join(' ') : undefined
    }
  })
}

/**
 * Sticker WebP -> PNG (primer cuadro si es animado).
 * Si FFmpeg no soporta WebP animado se extraen los cuadros con webpmux.
 */
export async function stickerToImage(buffer) {
  await assertFfmpeg()
  return withWorkDir(async (dir) => {
    const inputFile = path.join(dir, 'input.webp')
    const outputFile = path.join(dir, 'output.png')
    await writeFile(inputFile, buffer)
    try {
      await ffmpeg(buildToImageArgs({ input: inputFile, output: outputFile }), { timeout: 60000 })
      return await readFile(outputFile)
    } catch (error) {
      // Respaldo: demux del primer cuadro (FFmpeg antiguo / WebP animado)
      const { frames } = await demuxWebpFrames(buffer)
      if (!frames.length) throw error
      const frameFile = path.join(dir, 'frame0.webp')
      await writeFile(frameFile, frames[0])
      await ffmpeg(buildToImageArgs({ input: frameFile, output: outputFile }), { timeout: 60000 })
      return readFile(outputFile)
    }
  })
}

/** Sticker WebP -> MP4 */
export async function stickerToVideo(buffer) {
  await assertFfmpeg()
  const animated = await isAnimatedWebp(buffer)
  return withWorkDir(async (dir) => {
    const inputFile = path.join(dir, 'input.webp')
    const outputFile = path.join(dir, 'output.mp4')
    await writeFile(inputFile, buffer)

    if (animated) {
      try {
        await ffmpeg(buildToVideoArgs({ input: inputFile, output: outputFile }), {
          timeout: 90000
        })
        return { buffer: await readFile(outputFile), animated: true }
      } catch (error) {
        // Respaldo para FFmpeg sin soporte de WebP animado: secuencia de cuadros
        const { frames, delays } = await demuxWebpFrames(buffer)
        if (frames.length < 2) throw error
        const avgDelay = delays.reduce((sum, delay) => sum + delay, 0) / delays.length || 100
        const fps = Math.max(5, Math.min(30, Math.round(1000 / avgDelay)))
        await Promise.all(
          frames.map((frame, index) =>
            writeFile(path.join(dir, `frame_${String(index + 1).padStart(4, '0')}.webp`), frame)
          )
        )
        await ffmpeg(
          [
            '-framerate',
            String(fps),
            '-i',
            path.join(dir, 'frame_%04d.webp'),
            ...buildToVideoArgs({ input: inputFile, output: outputFile }).slice(2)
          ],
          { timeout: 120000 }
        )
        return { buffer: await readFile(outputFile), animated: true }
      }
    }

    // Sticker estático: primero PNG y luego un video corto en bucle
    const png = path.join(dir, 'frame.png')
    try {
      await ffmpeg(buildToImageArgs({ input: inputFile, output: png }), { timeout: 60000 })
    } catch (error) {
      const { frames } = await demuxWebpFrames(buffer)
      await writeFile(path.join(dir, 'frame0.webp'), frames[0] || buffer)
      await ffmpeg(
        buildToImageArgs({ input: path.join(dir, 'frame0.webp'), output: png }),
        { timeout: 60000 }
      )
    }
    await ffmpeg(buildStillVideoArgs({ input: png, output: outputFile }), { timeout: 90000 })
    return { buffer: await readFile(outputFile), animated: false }
  })
}

/** Genera la imagen "tray" (vista previa del pack) */
export async function stickerToTray(buffer, { size = 96 } = {}) {
  await assertFfmpeg()
  return withWorkDir(async (dir) => {
    const inputFile = path.join(dir, 'input.webp')
    const outputFile = path.join(dir, 'tray.png')
    await writeFile(inputFile, buffer)
    try {
      await ffmpeg(buildTrayArgs({ input: inputFile, output: outputFile, size }), { timeout: 60000 })
      return await readFile(outputFile)
    } catch (error) {
      const { frames } = await demuxWebpFrames(buffer)
      if (!frames.length) throw error
      const frameFile = path.join(dir, 'frame0.webp')
      await writeFile(frameFile, frames[0])
      await ffmpeg(buildTrayArgs({ input: frameFile, output: outputFile, size }), { timeout: 60000 })
      return readFile(outputFile)
    }
  })
}
