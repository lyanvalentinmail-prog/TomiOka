#!/usr/bin/env node
/**
 * Arranque del bot (npm start / npm run qr / npm run pair).
 *
 * Si faltan dependencias (el clásico "Cannot find package
 * '@whiskeysockets/baileys'" al clonar sin instalar), las instala
 * automáticamente y recién entonces entra a src/index.js.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED = ['@whiskeysockets/baileys', 'node-webpmux', 'pino', 'qrcode-terminal']
const missing = REQUIRED.filter((pkg) => !existsSync(path.join(ROOT, 'node_modules', ...pkg.split('/'))))

if (missing.length) {
  console.log(`➜ Faltan dependencias (${missing.join(', ')}). Instalando por única vez...`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['install', '--omit=dev'], { cwd: ROOT, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    console.error('❌ No se pudieron instalar las dependencias. Ejecuta manualmente: npm install')
    process.exit(1)
  }
  console.log('✅ Dependencias listas. Arrancando el bot...')
}

await import(pathToFileURL(path.join(ROOT, 'src', 'index.js')).href)
