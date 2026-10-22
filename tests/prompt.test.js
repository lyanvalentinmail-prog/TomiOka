import test from 'node:test'
import assert from 'node:assert/strict'
import { isInteractive } from '../src/lib/prompt.js'

// La consola embebida de la terminal no es una TTY real (usa pipes), pero
// el usuario SÍ puede escribir ahí: TOMIOKA_CONSOLE=1 la marca interactiva
// para que el bot pregunte el número de pairing por la consola misma.
test('TOMIOKA_CONSOLE=1 marca la consola como interactiva', () => {
  const prev = process.env.TOMIOKA_CONSOLE
  process.env.TOMIOKA_CONSOLE = '1'
  try {
    assert.equal(isInteractive(), true)
  } finally {
    if (prev === undefined) delete process.env.TOMIOKA_CONSOLE
    else process.env.TOMIOKA_CONSOLE = prev
  }
})

test('sin TTY ni TOMIOKA_CONSOLE no es interactivo', () => {
  if (process.stdin.isTTY && process.stdout.isTTY) return // en una terminal real sí lo es
  const prev = process.env.TOMIOKA_CONSOLE
  delete process.env.TOMIOKA_CONSOLE
  try {
    assert.equal(isInteractive(), false)
  } finally {
    if (prev !== undefined) process.env.TOMIOKA_CONSOLE = prev
  }
})
