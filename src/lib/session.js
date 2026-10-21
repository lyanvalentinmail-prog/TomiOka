import { existsSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Inspecciona la carpeta de sesión de Baileys sin abrirla.
 * Sirve para arrancar directo (sin preguntar ni pedir QR) cuando ya hay
 * credenciales válidas, que es el caso normal en Termux.
 *
 * @returns {{dir:string, exists:boolean, valid:boolean, registered:boolean, me:string|null, files:number, bytes:number, reason:string|null}}
 */
export function inspectSession(dir) {
  const result = {
    dir,
    exists: existsSync(dir),
    hasCreds: false,
    valid: false,
    registered: false,
    me: null,
    files: 0,
    bytes: 0,
    reason: null
  }

  if (!result.exists) {
    result.reason = 'no hay carpeta de sesión'
    return result
  }

  try {
    result.files = readdirSync(dir).length
  } catch (error) {
    result.reason = `no se puede leer la carpeta: ${error.message}`
    return result
  }

  const credsFile = path.join(dir, 'creds.json')
  if (!existsSync(credsFile)) {
    result.reason = 'falta creds.json'
    return result
  }

  result.hasCreds = true

  let creds
  try {
    result.bytes = statSync(credsFile).size
    if (result.bytes < 10) {
      result.reason = 'creds.json está vacío'
      return result
    }
    creds = JSON.parse(readFileSync(credsFile, 'utf8'))
  } catch (error) {
    result.reason = `creds.json dañado (${error.message})`
    return result
  }

  result.me = creds?.me?.id || creds?.me?.name || null

  // Baileys marca registered=true al terminar el pairing/QR. Algunas sesiones
  // viejas no tienen el campo pero sí tienen el JID del usuario.
  result.registered = creds?.registered === true || Boolean(creds?.me?.id)

  const hasKeys = Boolean(creds?.noiseKey?.private && creds?.signedIdentityKey?.private)
  if (!hasKeys) {
    result.reason = 'faltan las claves de la sesión'
    return result
  }
  if (!creds?.me?.id) {
    result.reason = 'la sesión no tiene número vinculado'
    return result
  }

  result.valid = true
  return result
}

/**
 * Mueve una sesión inválida a un respaldo con fecha (no se pierde nada).
 * @returns {string|null} ruta del respaldo
 */
export function backupSession(dir) {
  if (!existsSync(dir)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${dir}.invalid-${stamp}`
  try {
    renameSync(dir, target)
    return target
  } catch {
    return null
  }
}

/** Texto corto para mostrar en consola/chat */
export function describeSession(session) {
  if (!session.exists || !session.hasCreds) return 'sin sesión (hay que vincular)'
  if (!session.valid) return `sesión inválida: ${session.reason}`
  return `sesión activa${session.me ? ` (${String(session.me).split('@')[0]})` : ''}`
}
