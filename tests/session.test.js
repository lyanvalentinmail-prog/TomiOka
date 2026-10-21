import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backupSession, describeSession, inspectSession } from '../src/lib/session.js'

const makeDir = () => mkdtemp(path.join(os.tmpdir(), 'tomioka-session-'))

const validCreds = {
  me: { id: '59891234567:1@s.whatsapp.net', name: 'Tomi' },
  registered: true,
  noiseKey: { private: 'abc' },
  signedIdentityKey: { private: 'def' }
}

async function withSession(creds, fn) {
  const dir = await makeDir()
  try {
    if (creds !== undefined) {
      await writeFile(path.join(dir, 'creds.json'), typeof creds === 'string' ? creds : JSON.stringify(creds))
    }
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('inspectSession: sin carpeta no hay sesión', async () => {
  const base = await makeDir()
  const dir = path.join(base, 'no-existe')
  try {
    const session = inspectSession(dir)
    assert.equal(session.exists, false)
    assert.equal(session.hasCreds, false)
    assert.equal(session.valid, false)
    assert.match(session.reason, /carpeta/)
    assert.equal(describeSession(session), 'sin sesión (hay que vincular)')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('inspectSession: sesión vinculada es válida', async () => {
  await withSession(validCreds, async (dir) => {
    const session = inspectSession(dir)
    assert.equal(session.exists, true)
    assert.equal(session.hasCreds, true)
    assert.equal(session.valid, true)
    assert.equal(session.registered, true)
    assert.equal(session.me, '59891234567:1@s.whatsapp.net')
    assert.equal(session.files, 1)
    assert.ok(session.bytes > 10)
    assert.equal(describeSession(session), 'sesión activa (59891234567:1)')
  })
})

test('inspectSession: acepta sesiones viejas sin "registered" pero con número', async () => {
  const { registered, ...sinFlag } = validCreds
  await withSession(sinFlag, async (dir) => {
    const session = inspectSession(dir)
    assert.equal(session.valid, true)
    assert.equal(session.registered, true)
  })
})

test('inspectSession: rechaza credenciales vacías o dañadas', async () => {
  await withSession('', async (dir) => {
    const session = inspectSession(dir)
    assert.equal(session.valid, false)
    assert.match(session.reason, /vacío|dañado/)
  })

  await withSession('{ esto no es json', async (dir) => {
    const session = inspectSession(dir)
    assert.equal(session.valid, false)
    assert.match(session.reason, /dañado/)
    assert.match(describeSession(session), /^sesión inválida: creds\.json dañado/)
  })
})

test('inspectSession: detecta claves o número faltantes', async () => {
  await withSession({ me: validCreds.me, registered: true }, async (dir) => {
    const session = inspectSession(dir)
    assert.equal(session.valid, false)
    assert.match(session.reason, /claves/)
  })

  const sinNumero = { ...validCreds, me: undefined }
  await withSession(sinNumero, async (dir) => {
    const session = inspectSession(dir)
    assert.equal(session.valid, false)
    assert.equal(session.me, null)
    assert.match(session.reason, /número vinculado/)
  })
})

test('inspectSession: carpeta sin creds.json no sirve para conectar', async () => {
  const dir = await makeDir()
  try {
    await mkdir(path.join(dir, 'sub'), { recursive: true })
    const session = inspectSession(dir)
    assert.equal(session.exists, true)
    assert.equal(session.hasCreds, false)
    assert.equal(session.valid, false)
    assert.equal(session.reason, 'falta creds.json')
    assert.equal(describeSession(session), 'sin sesión (hay que vincular)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('backupSession mueve la sesión inválida sin perderla', async () => {
  await withSession('creds roto', async (dir) => {
    const target = backupSession(dir)
    assert.ok(target, 'devuelve la ruta del respaldo')
    assert.equal(existsSync(dir), false)
    assert.equal(existsSync(path.join(target, 'creds.json')), true)

    const siblings = await readdir(path.dirname(dir))
    assert.ok(siblings.some((name) => name.startsWith(`${path.basename(dir)}.invalid-`)))

    // Se puede volver a empezar de cero en la carpeta original
    assert.equal(inspectSession(dir).valid, false)
    await rm(target, { recursive: true, force: true })
  })
})

test('backupSession sin carpeta devuelve null', async () => {
  const base = await makeDir()
  try {
    assert.equal(backupSession(path.join(base, 'nada')), null)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
