import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from '../config.js'

const PREFIX = 'tomioka-'

/** Última carpeta base usada (para el diagnóstico) */
const state = { base: null, errors: [], verified: false, envKey: '' }
let counter = 0

/**
 * Carpetas candidatas para archivos temporales.
 * En Termux `os.tmpdir()` puede apuntar a /tmp (inexistente) si TMPDIR no está
 * definido; por eso el proyecto usa siempre data/tmp como respaldo.
 */
export function tempCandidates() {
  const list = [
    process.env.TOMIOKA_TMPDIR,
    process.env.TMPDIR,
    path.join(ROOT, 'data', 'tmp'),
    os.tmpdir(),
    '/tmp'
  ]
  return [...new Set(list.filter((dir) => typeof dir === 'string' && dir.trim()))]
}

/** Firma de las variables que cambian la carpeta base elegida */
function envKey() {
  return `${process.env.TOMIOKA_TMPDIR || ''}|${process.env.TMPDIR || ''}`
}

/** Olvida la carpeta base verificada (tests o cambios en caliente) */
export function resetWorkDirCache() {
  state.verified = false
  state.base = null
}

/**
 * Crea una carpeta temporal escribible, probando varias ubicaciones.
 * @returns {Promise<{dir:string, base:string}>}
 */
export async function createWorkDir() {
  // La carpeta base se comprueba una sola vez por proceso: después se crea
  // el subdirectorio de trabajo con un solo mkdir (antes eran tres llamadas
  // al sistema en cada conversión: mkdir + access + mkdtemp).
  if (state.verified && state.base && state.envKey === envKey()) {
    const dir = path.join(state.base, `${PREFIX}${process.pid}-${++counter}`)
    try {
      await mkdir(dir, { recursive: true })
      return { dir, base: state.base }
    } catch (error) {
      // La base dejó de servir (por ejemplo, se borró data/tmp): se vuelve a probar.
      state.verified = false
      state.errors.push(`${state.base} (${error.code || error.message})`)
    }
  }

  const errors = []
  for (const base of tempCandidates()) {
    try {
      await mkdir(base, { recursive: true })
      await access(base, constants.W_OK)
      const dir = path.join(base, `${PREFIX}${process.pid}-${++counter}`)
      await mkdir(dir, { recursive: true })
      state.base = base
      state.verified = true
      state.envKey = envKey()
      state.errors = errors
      return { dir, base }
    } catch (error) {
      errors.push(`${base} (${error.code || error.message})`)
    }
  }
  state.errors = errors
  throw new Error(
    `No hay ninguna carpeta temporal escribible: ${errors.join(' · ')}. ` +
      'Define TOMIOKA_TMPDIR con una ruta válida (por ejemplo el almacenamiento interno de Termux).'
  )
}

/**
 * Deja lista la carpeta temporal antes de que haga falta (arranque del bot):
 * la primera conversión no paga la búsqueda de una carpeta escribible.
 * @returns {Promise<boolean>}
 */
export async function prewarmWorkDir() {
  try {
    const { dir } = await createWorkDir()
    await rm(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Ejecuta una función con una carpeta temporal y la borra al terminar.
 */
export async function withWorkDir(callback) {
  const { dir, base } = await createWorkDir()
  try {
    return await callback(dir, base)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Información para el diagnóstico: qué carpeta se usa y cuáles fallaron */
export function tempInfo() {
  return {
    base: state.base,
    errors: [...state.errors],
    candidates: tempCandidates(),
    tmpdir: os.tmpdir(),
    env: { TMPDIR: process.env.TMPDIR || null, TOMIOKA_TMPDIR: process.env.TOMIOKA_TMPDIR || null }
  }
}

/** Comprueba si una carpeta base se puede escribir (con tiempo límite) */
export async function canWrite(dir, { timeoutMs = 3000 } = {}) {
  const check = (async () => {
    await mkdir(dir, { recursive: true })
    await access(dir, constants.W_OK)
    return true
  })()
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs, false))
  try {
    return await Promise.race([check.catch(() => false), timeout])
  } catch {
    return false
  }
}
