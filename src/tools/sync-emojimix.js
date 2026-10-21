#!/usr/bin/env node
/**
 * Pre-descarga el catálogo de Emoji Kitchen para que `.emojimix` responda rápido.
 * Uso: npm run emojimix:sync
 */
import { statSync } from 'node:fs'
import { ensureDirs, loadConfig } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { ensureIndex, resetIndexCache } from '../lib/emojimix.js'
import { info, ok, warn } from '../lib/ui.js'

const config = loadConfig()
const { logger } = createLogger(config.logging.level, config.logging.baileys)
ensureDirs(config)

info('Sincronizando catálogo de Emoji Kitchen...')
const started = Date.now()

try {
  resetIndexCache()
  const index = await ensureIndex({
    cacheFile: config.emojimix.cacheFile,
    metadataUrl: config.emojimix.metadataUrl,
    mirrors: [
      'https://cdn.jsdelivr.net/gh/xsalazar/emoji-kitchen-backend@main/app/metadata.json',
      'https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/master/app/metadata.json'
    ],
    timeoutMs: config.emojimix.timeoutMs,
    logger
  })
  const size = statSync(config.emojimix.cacheFile).size / 1048576
  ok(`Catálogo listo: ${index.total} combinaciones (${size.toFixed(1)} MB)`)
  info(`Archivo: ${config.emojimix.cacheFile}`)
  info(`Tiempo: ${((Date.now() - started) / 1000).toFixed(1)} s`)
} catch (error) {
  warn(`No se pudo sincronizar el catálogo: ${error.message}`)
  process.exitCode = 1
}
