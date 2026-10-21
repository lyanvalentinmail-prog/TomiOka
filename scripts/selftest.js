#!/usr/bin/env node
/**
 * Autodiagnóstico del pipeline de stickers.
 * Ejecuta conversiones reales con FFmpeg y explica cómo arreglar lo que falle.
 *
 * Uso: npm run selftest
 */
import { loadConfig } from '../src/config.js'
import { getFfmpegInfo, resolveFfmpeg, selfTestFfmpeg } from '../src/lib/ffmpeg.js'
import { tempInfo } from '../src/lib/tmp.js'
import { c, sym } from '../src/lib/colors.js'

const config = loadConfig()

console.log('')
console.log(c.bold(`${sym.wave} TomiOka Bot · autodiagnóstico`))
console.log(c.gray(`   Node ${process.version} · ${process.platform}/${process.arch}`))
console.log('')

const temp = tempInfo()
console.log(c.bold('Carpetas temporales'))
console.log(`   os.tmpdir(): ${temp.tmpdir}`)
console.log(`   TMPDIR: ${temp.env.TMPDIR ?? '(no definido)'}`)
console.log(`   candidatas: ${temp.candidates.join(' · ')}`)
console.log('')

const info = await resolveFfmpeg()
if (!info) {
  console.log(c.red(`${sym.err} FFmpeg no encontrado`))
  console.log('   Termux:  pkg install ffmpeg libwebp')
  console.log('   Debian:  sudo apt install ffmpeg')
  console.log('   O define FFMPEG_PATH=/ruta/al/ffmpeg')
  process.exitCode = 1
} else {
  console.log(c.bold('FFmpeg'))
  console.log(`   ruta:     ${info.path} (${info.source})`)
  console.log(`   versión:  ${info.version}`)
  console.log(`   libwebp:  ${info.webp ? c.green('sí') : c.red('no')}`)
  console.log(`   animado:  ${info.webpAnim ? c.green('sí') : c.yellow('no')}`)
  console.log('')
}

console.log(c.bold('Pruebas reales de conversión'))
const test = await selfTestFfmpeg({ logger: { warn() {}, debug() {}, info() {}, error() {} } })

for (const step of test.steps) {
  const icon = step.ok ? c.green('✔') : c.red('✖')
  const time = step.ms !== undefined ? c.gray(` (${step.ms} ms)`) : ''
  console.log(`   ${icon} ${step.name}${time}`)
  if (!step.ok && step.error) console.log(`      ${c.red(step.error)}`)
}

console.log('')
if (test.ok) {
  console.log(c.green(`${sym.ok} Todo funciona: los stickers y conversiones deberían andar bien.`))
} else {
  console.log(c.red(`${sym.err} Hay fallas en el pipeline de stickers`))
  if (test.hint) console.log(`   ${sym.arrow} ${test.hint}`)
  const failed = test.steps.find((step) => !step.ok)
  if (failed?.error?.includes('temporal')) {
    console.log(`   ${sym.arrow} Define TOMIOKA_TMPDIR, por ejemplo:`)
    console.log('     export TOMIOKA_TMPDIR="$HOME/tomioka-tmp"')
  }
  process.exitCode = 1
}

if (test.ffmpeg) {
  console.log('')
  console.log(c.gray(`   ffmpeg detectado: ${test.ffmpeg.path}`))
  console.log(c.gray(`   versión ${test.ffmpeg.version} (${test.ffmpeg.versionNumber})`))
}

console.log('')
if (info) {
  console.log(c.gray(`   (info: ${getFfmpegInfo()?.version ?? 'sin datos'})`))
}
console.log(c.gray(`   Config: ${config.paths.data}`))
console.log('')
