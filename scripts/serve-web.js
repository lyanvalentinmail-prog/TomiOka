#!/usr/bin/env node
/**
 * Servidor estático del panel web (carpeta web/), sin dependencias.
 * Uso: npm run web   →   http://localhost:3000
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_DIR = path.join(ROOT, 'web')
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/index.html'

    // Sin salirse de web/ (anti path-traversal)
    const file = path.resolve(WEB_DIR, `.${pathname}`)
    if (!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) {
      // Fallback SPA: cualquier ruta desconocida devuelve el panel
      const index = path.join(WEB_DIR, 'index.html')
      res.writeHead(200, { 'content-type': MIME['.html'] })
      res.end(readFileSync(index))
      return
    }

    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    })
    res.end(readFileSync(file))
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`Error del servidor: ${error.message}`)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`🌊 TomiOka · Panel web en http://${HOST}:${PORT}`)
})
