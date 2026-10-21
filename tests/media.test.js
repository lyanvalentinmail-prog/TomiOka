import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  convertToSticker,
  qualityPlan,
  stickerToImage,
  stickerToTray,
  stickerToVideo
} from '../src/lib/media.js'
import { readSticker, writeStickerMetadata } from '../src/lib/sticker.js'
import { auditSticker, parseWebp, webpInfo } from '../src/lib/webp.js'
import { buildStickerArgs, buildToImageArgs, buildToVideoArgs, buildTrayArgs } from '../src/lib/ffmpeg.js'
import { ffmpegAvailable } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const png = await readFile(path.join(here, 'fixtures/sample.png'))
const gif = await readFile(path.join(here, 'fixtures/sample.gif'))
const mp4 = await readFile(path.join(here, 'fixtures/sample.mp4'))
const staticSticker = await readFile(path.join(here, 'fixtures/sticker-static.webp'))
const animatedSticker = await readFile(path.join(here, 'fixtures/sticker-anim.webp'))

test('buildStickerArgs arma argumentos válidos para imagen', () => {
  const args = buildStickerArgs({ input: 'in.png', output: 'out.webp', animated: false, quality: 80 })
  assert.deepEqual(args.slice(0, 2), ['-i', 'in.png'])
  assert.ok(args.includes('-frames:v'))
  assert.ok(args.includes('libwebp'))
  assert.ok(args.includes('-lossless'))
  const filter = args[args.indexOf('-vf') + 1]
  assert.match(filter, /scale=512:512:force_original_aspect_ratio=decrease/)
  assert.match(filter, /pad=512:512/)
  assert.equal(args[args.length - 1], 'out.webp')
})

test('buildStickerArgs para animados usa libwebp_anim y limita segundos', () => {
  const args = buildStickerArgs({
    input: 'in.mp4',
    output: 'out.webp',
    animated: true,
    maxSeconds: 6.5,
    fps: 15
  })
  assert.deepEqual(args.slice(0, 2), ['-t', '6.5'])
  assert.ok(args.includes('libwebp_anim'))
  assert.ok(!args.includes('-frames:v'))
  assert.match(args[args.indexOf('-vf') + 1], /fps=15/)
})

test('buildStickerArgs valida parámetros', () => {
  assert.throws(() => buildStickerArgs({ input: '', output: 'x.webp' }), /input y output/)
  assert.throws(() => buildToImageArgs({ input: 'a', output: '' }), /input y output/)
  assert.throws(() => buildToVideoArgs({}), /input y output/)
  assert.throws(() => buildTrayArgs({ input: 'a' }), /input y output/)
})

test('qualityPlan baja la calidad para cumplir el límite', () => {
  const plans = qualityPlan({ animated: true, quality: 82, fps: 15 })
  assert.equal(plans[0].quality, 82)
  assert.ok(plans.at(-1).quality < plans[0].quality)
  const staticPlans = qualityPlan({ animated: false, quality: 90, fps: 15 })
  assert.equal(staticPlans[0].quality, 90)
})

test('convertToSticker crea stickers estáticos y animados', async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('FFmpeg no disponible en este entorno')
    return
  }
  const image = await convertToSticker(png, { extension: 'png', animated: false, settings: {} })
  assert.ok(image.buffer.length > 100)
  const info = await readSticker(image.buffer)
  assert.equal(info.animated, false)
  assert.equal(info.width, 512)
  assert.equal(info.height, 512)

  const animation = await convertToSticker(gif, { extension: 'gif', animated: true, settings: {} })
  const animInfo = await readSticker(animation.buffer)
  assert.equal(animInfo.animated, true)
  assert.ok(animation.bytes < 500 * 1024, 'respeta el límite de 500 KB')

  const video = await convertToSticker(mp4, { extension: 'mp4', animated: true, settings: {} })
  assert.ok(video.buffer.length > 100)
})

test('el sticker final conserva transparencia y cuadros (bug del fondo negro)', async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('FFmpeg no disponible en este entorno')
    return
  }

  // Imagen con relleno: el sticker debe quedar 512×512 con alfa.
  const still = await convertToSticker(png, { extension: 'png', animated: false, settings: {} })
  const stillOut = await writeStickerMetadata(still.buffer, { packName: 'Bug', packAuthor: 'Tomi' })
  const stillInfo = webpInfo(stillOut)
  assert.equal(stillInfo.width, 512)
  assert.equal(stillInfo.height, 512)
  assert.equal(stillInfo.hasAlpha, true, 'el PNG con relleno debe quedar con transparencia')
  assert.equal(auditSticker(stillOut).valid, true)

  // WhatsApp lee el pack desde el TIFF del chunk EXIF: el largo tiene que estar puesto.
  const exif = parseWebp(stillOut).chunks.find((chunk) => chunk.id === 'EXIF').data
  assert.equal(exif.readUInt32LE(14), exif.length - 22)
  assert.ok(exif.subarray(22).toString('utf8').includes('sticker-pack-name'))

  // GIF animado: mismo número de cuadros y flag ALPHA intacto.
  const anim = await convertToSticker(gif, { extension: 'gif', animated: true, settings: {} })
  const before = webpInfo(anim.buffer)
  const animOut = await writeStickerMetadata(anim.buffer, { packName: 'Bug', packAuthor: 'Tomi' })
  const after = webpInfo(animOut)
  assert.equal(after.frameCount, before.frameCount)
  assert.equal(after.totalDelay, before.totalDelay)
  assert.equal(after.hasAlpha, true, 'el sticker animado no puede perder el alfa')
  assert.ok(after.flags & 0x10, 'VP8X debe conservar el flag ALPHA')
  assert.equal(auditSticker(animOut).valid, true)
})

test('conversiones de sticker a imagen, video y tray', async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip('FFmpeg no disponible en este entorno')
    return
  }
  const image = await stickerToImage(staticSticker)
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'firma PNG')

  const animatedImage = await stickerToImage(animatedSticker)
  assert.equal(animatedImage.subarray(1, 4).toString('ascii'), 'PNG')

  const video = await stickerToVideo(animatedSticker)
  assert.equal(video.animated, true)
  assert.equal(video.buffer.subarray(4, 8).toString('ascii'), 'ftyp', 'firma MP4')

  const stillVideo = await stickerToVideo(staticSticker)
  assert.equal(stillVideo.animated, false)
  assert.equal(stillVideo.buffer.subarray(4, 8).toString('ascii'), 'ftyp')

  const tray = await stickerToTray(staticSticker, { size: 96 })
  assert.equal(tray.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
})
