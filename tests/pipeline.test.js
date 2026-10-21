import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createWorkDir, tempCandidates, tempInfo, withWorkDir, canWrite } from '../src/lib/tmp.js'
import {
  friendlyFfmpegError,
  resolveFfmpeg,
  selfTestFfmpeg,
  stickerArgVariants
} from '../src/lib/ffmpeg.js'
import { ROOT } from '../src/config.js'

test('las carpetas candidatas incluyen data/tmp del proyecto', () => {
  const candidates = tempCandidates()
  assert.ok(candidates.some((dir) => dir.includes(path.join('data', 'tmp'))))
  assert.ok(candidates.includes(os.tmpdir()) || candidates.includes('/tmp'))
})

test('createWorkDir crea y devuelve una carpeta escribible', async () => {
  const { dir, base } = await createWorkDir()
  try {
    assert.ok(existsSync(dir))
    assert.ok(base)
    writeFileSync(path.join(dir, 'prueba.txt'), 'ok')
    assert.equal(readFileSync(path.join(dir, 'prueba.txt'), 'utf8'), 'ok')
    assert.ok(tempInfo().base)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('withWorkDir borra la carpeta al terminar (incluso si falla)', async () => {
  let dir
  await withWorkDir(async (workDir) => {
    dir = workDir
    writeFileSync(path.join(workDir, 'x'), 'y')
  })
  assert.equal(existsSync(dir), false)

  let dir2
  await assert.rejects(
    withWorkDir(async (workDir) => {
      dir2 = workDir
      throw new Error('boom')
    }),
    /boom/
  )
  assert.equal(existsSync(dir2), false)
})

test('usa TOMIOKA_TMPDIR si está definido y es válido', async () => {
  const custom = mkdtempSync(path.join(os.tmpdir(), 'tomioka-env-'))
  const previous = process.env.TOMIOKA_TMPDIR
  process.env.TOMIOKA_TMPDIR = custom
  try {
    const { dir, base } = await createWorkDir()
    assert.equal(path.dirname(dir), custom)
    assert.equal(base, custom)
    rmSync(dir, { recursive: true, force: true })
  } finally {
    if (previous === undefined) delete process.env.TOMIOKA_TMPDIR
    else process.env.TOMIOKA_TMPDIR = previous
    rmSync(custom, { recursive: true, force: true })
  }
})

test('si las carpetas del sistema fallan usa data/tmp (caso Termux sin TMPDIR)', async () => {
  const previous = {
    tmpdir: process.env.TMPDIR,
    tomio: process.env.TOMIOKA_TMPDIR
  }
  process.env.TOMIOKA_TMPDIR = '/ruta/que/no/existe/para/nada'
  process.env.TMPDIR = '/otra/ruta/inexistente'
  try {
    const { dir, base } = await createWorkDir()
    assert.ok(dir.startsWith(path.join(ROOT, 'data', 'tmp')), `usó ${dir}`)
    assert.equal(base, path.join(ROOT, 'data', 'tmp'))
    rmSync(dir, { recursive: true, force: true })
  } finally {
    if (previous.tmpdir === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous.tmpdir
    if (previous.tomio === undefined) delete process.env.TOMIOKA_TMPDIR
    else process.env.TOMIOKA_TMPDIR = previous.tomio
  }
})

test('canWrite detecta carpetas válidas e inválidas', async () => {
  assert.equal(await canWrite(path.join(ROOT, 'data', 'tmp')), true)
  // ruta imposible: un archivo no puede ser carpeta
  assert.equal(await canWrite(path.join(ROOT, 'package.json', 'subcarpeta')), false)
})

test('stickerArgVariants prioriza preset y ofrece alternativas compatibles', () => {
  const staticVariants = stickerArgVariants({ input: 'in.png', output: 'out.webp' })
  assert.ok(staticVariants.length >= 3)
  assert.ok(staticVariants[0].args.includes('-preset'))
  assert.ok(staticVariants[0].args.includes('libwebp'))
  assert.ok(staticVariants.some((variant) => !variant.args.includes('-preset')), 'hay variante sin preset')
  assert.ok(staticVariants.some((variant) => variant.args.includes('-quality')))

  const animVariants = stickerArgVariants({ input: 'in.mp4', output: 'out.webp', animated: true })
  assert.ok(animVariants[0].args.includes('libwebp_anim'))
  assert.ok(animVariants[0].args.includes('-loop'))
  assert.ok(
    animVariants.some((variant) => variant.args.includes('libwebp_anim') && !variant.args.includes('-loop')),
    'hay variante animada sin -loop'
  )
  assert.ok(animVariants.some((variant) => variant.staticFallback), 'hay respaldo estático')
})

test('stickerArgVariants valida parámetros', () => {
  assert.throws(() => stickerArgVariants({ input: '', output: 'x.webp' }), /input y output/)
})

test('friendlyFfmpegError traduce los errores habituales', () => {
  assert.match(
    friendlyFfmpegError({ stderr: "Unknown encoder 'libwebp'" }),
    /no incluye el codificador WebP/
  )
  assert.match(
    friendlyFfmpegError({ stderr: "Unknown encoder 'libwebp_anim'" }),
    /no soporta stickers animados/
  )
  assert.match(
    friendlyFfmpegError({ stderr: 'Invalid data found when processing input' }),
    /dañado|compatible/
  )
  assert.match(friendlyFfmpegError({ stderr: 'No space left on device' }), /espacio libre/)
  assert.match(friendlyFfmpegError({ stderr: 'algo raro' }), /FFmpeg falló: algo raro/)
})

test('selfTestFfmpeg informa un resultado claro', async (t) => {
  const info = await resolveFfmpeg()
  if (!info) return t.skip('FFmpeg no disponible')
  const result = await selfTestFfmpeg()
  assert.equal(typeof result.ok, 'boolean')
  assert.ok(result.ffmpeg)
  assert.ok(result.steps.length > 0)
  assert.ok(result.steps.some((step) => step.name.includes('estático')))
  if (!result.ok) assert.ok(result.hint)
})

test('el pipeline tolera un ffmpeg sin -preset ni -loop (wrapper estricto)', async (t) => {
  const info = await resolveFfmpeg()
  if (!info) return t.skip('FFmpeg no disponible')

  const dir = mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-strict-'))
  const wrapper = path.join(dir, 'ffmpeg-strict')
  writeFileSync(
    wrapper,
    `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "-preset" ] || [ "$arg" = "-loop" ]; then
    echo "Option $arg not found." >&2
    exit 1
  fi
done
exec "${info.path}" "$@"
`
  )
  chmodSync(wrapper, 0o755)

  const previous = process.env.FFMPEG_PATH
  process.env.FFMPEG_PATH = wrapper
  try {
    const { resolveFfmpeg: resolve } = await import('../src/lib/ffmpeg.js')
    await resolve({ force: true })
    const { convertToSticker } = await import('../src/lib/media.js')
    const fs = await import('node:fs/promises')
    const png = await fs.readFile(path.join(ROOT, 'tests', 'fixtures', 'sample.png'))
    const gif = await fs.readFile(path.join(ROOT, 'tests', 'fixtures', 'sample.gif'))

    const image = await convertToSticker(png, { extension: 'png' })
    assert.ok(image.bytes > 100)
    assert.ok(!image.variant.includes('preset'), `usó ${image.variant}`)

    const animation = await convertToSticker(gif, { extension: 'gif', animated: true })
    assert.ok(animation.bytes > 100)
    assert.equal(animation.animated, true, 'sigue siendo animado aunque no exista -loop')
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = previous
    const { resolveFfmpeg: resolve } = await import('../src/lib/ffmpeg.js')
    await resolve({ force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
