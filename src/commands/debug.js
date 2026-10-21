import path from 'node:path'
import { resolveFfmpeg, selfTestFfmpeg } from '../lib/ffmpeg.js'
import { tempInfo, canWrite } from '../lib/tmp.js'
import { indexInfo } from '../lib/emojimix.js'
import { describeSession, inspectSession } from '../lib/session.js'
import { auditSticker } from '../lib/sticker.js'
import { loadMenuImage } from '../lib/banner.js'
import { truncate } from '../lib/text.js'
import { commandList, visibleCommands } from './index.js'

const yes = (value) => (value ? '✅' : '❌')

/**
 * Diagnóstico rápido desde el chat. No aparece en el menú (hidden: true).
 * Ejecuta una conversión real con FFmpeg para detectar el problema exacto.
 */
export default {
  name: 'debug',
  aliases: ['diag', 'diagnostico', 'test'],
  category: 'extras',
  hidden: true,
  description: 'Diagnóstico del bot (FFmpeg, carpetas, sesión).',
  usage: '.debug',
  examples: ['.debug'],
  async run(ctx) {
    await ctx.reply('🩺 Ejecutando diagnóstico... puede tardar unos segundos.')

    const config = ctx.config
    const info = await resolveFfmpeg()
    const temp = tempInfo()
    const session = inspectSession(config.sessionDir)
    const tempOk = await canWrite(path.join(config.paths.data, 'tmp'))

    const lines = [
      '🩺 *Diagnóstico de TomiOka*',
      `▸ Node: ${process.version} · ${process.platform}/${process.arch}`,
      `▸ FFmpeg: ${info ? `${info.version}` : 'NO ENCONTRADO'} ${info ? yes(info.webp) : '❌'}`,
      info ? `▸ Ruta: ${truncate(info.path, 60)}` : '▸ Instala con: pkg install ffmpeg',
      `▸ WebP animado: ${info ? yes(info.webpAnim) : '❌'}`,
      `▸ Carpeta temporal: ${temp.base ? truncate(temp.base, 40) : 'no disponible'} ${yes(Boolean(temp.base))}`,
      `▸ data/tmp escribible: ${yes(tempOk)}`,
      `▸ Sesión: ${yes(session.valid)} ${describeSession(session)}`,
      `▸ Prefijo: ${config.prefixes.join(' ')} · Comandos: ${visibleCommands.length}`,
      `▸ Packs activos: ${ctx.store?.packs?.size ?? 0}`
    ]

    const emoji = indexInfo(config.emojimix)
    lines.push(
      `▸ Emojimix: ${emoji.loaded ? `cargado (${emoji.total})` : emoji.cached ? 'en caché' : 'se descargará al usarlo'}`
    )

    if (config.menu.image) {
      const banner = await loadMenuImage(config, { logger: ctx.logger })
      lines.push(`▸ Banner: ${banner ? yes(true) + ` ${banner.type}` : '❌ no se pudo cargar'}`)
    }

    // Prueba real de conversión
    const test = await selfTestFfmpeg({ logger: ctx.logger })
    lines.push('', `🧪 *Prueba de conversión*: ${test.ok ? '✅ todo OK' : '❌ falló'}`)
    for (const step of test.steps) {
      lines.push(`${step.ok ? '✅' : '❌'} ${step.name}${step.ok ? ` (${step.ms} ms)` : ''}`)
      if (!step.ok && step.error) lines.push(`   ⚠️ ${truncate(step.error, 120)}`)
    }
    if (test.hint) lines.push(`💡 ${test.hint}`)

    // Auditoría del WebP generado (transparencia + animación)
    const audit = test.sticker ? auditSticker(test.sticker) : null
    if (audit) {
      lines.push(
        '',
        `🧩 *Sticker de prueba*: ${audit.valid ? '✅ válido' : '❌ inválido'} · ` +
          `${audit.info.width}×${audit.info.height} · ${audit.info.frameCount} cuadros · ` +
          `${audit.info.hasAlpha ? 'con alfa' : 'SIN alfa'}`
      )
      for (const issue of audit.issues) lines.push(`   ❌ ${issue}`)
    }

    await ctx.reply(lines.join('\n'))
    return `debug ${test.ok ? 'ok' : 'con fallas'}`
  }
}
