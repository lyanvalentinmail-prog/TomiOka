import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ffmpeg } from './ffmpeg.js'
import { assertFfmpeg, convertToSticker } from './media.js'
import { withWorkDir } from './tmp.js'

export const TEXT_STICKER_MODES = ['brat', 'attp', 'ttp']

const ATTP_COLORS = ['#ff2d78', '#ff8a00', '#ffe600', '#00c853', '#00b0ff', '#aa00ff']

/** Normaliza el texto y limita su tamaño para que entre en un sticker. */
export function normalizeStickerText(text, mode = 'ttp') {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
  return mode === 'brat' ? clean.toLowerCase() : clean
}

/** Parte el texto en líneas cortas para dibujarlo centrado. */
export function wrapStickerText(text, maxChars = 12) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''

  for (const originalWord of words) {
    const chunks =
      originalWord.length > maxChars
        ? originalWord.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [originalWord]
        : [originalWord]

    for (const word of chunks) {
      const candidate = line ? `${line} ${word}` : word
      if (candidate.length <= maxChars) {
        line = candidate
      } else {
        if (line) lines.push(line)
        line = word
      }
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** Tamaño de fuente aproximado según la línea más larga y la cantidad de líneas. */
export function textStickerFontSize(lines) {
  const safeLines = Array.isArray(lines) && lines.length ? lines : ['']
  const longest = Math.max(...safeLines.map((line) => line.length), 1)
  const byWidth = Math.floor(500 / Math.max(4, longest))
  const byHeight = Math.floor(430 / safeLines.length)
  return Math.max(30, Math.min(72, byWidth, byHeight))
}

function filterPath(filePath) {
  // En Linux/Termux la ruta temporal no contiene ':'; se escapa por seguridad.
  return String(filePath).replace(/\\/g, '/').replace(/:/g, '\\:')
}

/**
 * Argumentos para dibujar un cuadro PNG 512×512 con drawtext.
 * El texto va en un archivo aparte (textfile), así no hay que escapar comillas,
 * dos puntos ni signos especiales escritos por el usuario.
 */
export function buildTextFrameArgs({ mode, textFile, output, color = '#ffffff' }) {
  if (!TEXT_STICKER_MODES.includes(mode)) throw new Error(`Modo de texto no soportado: ${mode}`)
  if (!textFile || !output) throw new Error('buildTextFrameArgs requiere textFile y output')

  const isBrat = mode === 'brat'
  const background = isBrat ? 'color=c=0x8ace00:s=512x512' : 'color=c=black@0.0:s=512x512,format=rgba'
  const fontColor = isBrat ? 'black' : color
  const borderWidth = isBrat ? 0 : 5

  return [
    '-f', 'lavfi',
    '-i', background,
    '-vf',
    [
      `drawtext=textfile=${filterPath(textFile)}:expansion=none`,
      `fontcolor=${fontColor}`,
      'fontsize=56',
      `borderw=${borderWidth}`,
      'bordercolor=black@0.95',
      'x=(w-text_w)/2',
      'y=(h-text_h)/2',
      'line_spacing=10'
    ].join(':'),
    '-frames:v', '1',
    '-y', output
  ]
}

/** Sustituye el fontsize fijo del constructor por el calculado para las líneas. */
function withFontSize(args, fontSize) {
  return args.map((arg) =>
    typeof arg === 'string' && arg.includes('drawtext=')
      ? arg.replace('fontsize=56', `fontsize=${fontSize}`)
      : arg
  )
}

/**
 * Crea un sticker de texto.
 * - brat: fondo verde lima y texto negro en minúsculas.
 * - ttp: texto blanco con borde negro sobre transparencia.
 * - attp: el mismo texto animado cambiando de color.
 */
export async function createTextSticker(text, { mode = 'ttp', settings = {}, logger } = {}) {
  if (!TEXT_STICKER_MODES.includes(mode)) throw new Error(`Modo de texto no soportado: ${mode}`)
  const clean = normalizeStickerText(text, mode)
  if (!clean) throw new Error('Escribe un texto para crear el sticker.')

  await assertFfmpeg()
  const lines = wrapStickerText(clean)
  const fontSize = textStickerFontSize(lines)

  return withWorkDir(async (dir) => {
    const textFile = path.join(dir, 'text.txt')
    await writeFile(textFile, lines.join('\n'), 'utf8')

    const makeFrame = async (output, color) => {
      try {
        await ffmpeg(withFontSize(buildTextFrameArgs({ mode, textFile, output, color }), fontSize), {
          timeout: 60000
        })
      } catch (error) {
        if (/drawtext|libfreetype|No such filter/i.test(`${error.message} ${error.stderr || ''}`)) {
          throw new Error(
            'Tu FFmpeg no incluye el filtro drawtext/libfreetype necesario para Brat, ATTP y TTP. ' +
              'Actualiza FFmpeg: pkg install ffmpeg'
          )
        }
        throw error
      }
    }

    if (mode !== 'attp') {
      const frame = path.join(dir, 'frame.png')
      await makeFrame(frame, '#ffffff')
      const png = await readFile(frame)
      return convertToSticker(png, {
        extension: 'png',
        animated: false,
        settings,
        logger
      })
    }

    for (let index = 0; index < ATTP_COLORS.length; index += 1) {
      await makeFrame(path.join(dir, `frame-${index + 1}.png`), ATTP_COLORS[index])
    }
    const gif = path.join(dir, 'attp.gif')
    await ffmpeg(
      [
        '-framerate', '6',
        '-i', path.join(dir, 'frame-%d.png'),
        '-vf', 'scale=512:512',
        '-y', gif
      ],
      { timeout: 60000 }
    )
    const animated = await readFile(gif)
    return convertToSticker(animated, {
      extension: 'gif',
      animated: true,
      settings,
      logger
    })
  })
}
