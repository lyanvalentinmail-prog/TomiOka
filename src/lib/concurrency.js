/**
 * Utilidades chicas de concurrencia.
 *
 * La idea del proyecto: lo que el usuario ve (el sticker, el menú, el pack)
 * sale primero; lo decorativo (reacciones, "escribiendo…", avisos de progreso)
 * viaja en paralelo y nunca retrasa el trabajo real.
 */

/**
 * Ejecuta `worker` sobre los items con como máximo `limit` en paralelo,
 * conservando el orden del resultado.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T, index:number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : []
  const results = new Array(list.length)
  if (!list.length) return results
  const runners = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    let index = 0
    while (index < list.length) {
      const current = index
      index += 1
      results[current] = await worker(list[current], current)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Lanza una promesa en segundo plano sin romper nada si falla.
 * Devuelve la promesa "envuelta" para poder esperarla cuando haga falta.
 * @param {Promise<unknown>|null|undefined} promise
 * @param {object} [logger]
 * @param {string} [label]
 */
export function fireAndForget(promise, logger = null, label = '') {
  if (!promise) return Promise.resolve(null)
  return Promise.resolve(promise).catch((error) => {
    logger?.debug?.(`Aviso en segundo plano${label ? ` (${label})` : ''} falló: ${error?.message || error}`)
    return null
  })
}
