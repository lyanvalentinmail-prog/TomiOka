import readline from 'node:readline/promises'
import { c } from './colors.js'

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/** Pregunta y devuelve el texto (o el valor por defecto si está vacío) */
export async function ask(question, { defaultValue = '' } = {}) {
  if (!isInteractive()) return defaultValue
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = defaultValue ? c.gray(` (${defaultValue})`) : ''
    const answer = (await rl.question(`${c.cyan('?')} ${question}${suffix}: `)).trim()
    return answer || defaultValue
  } finally {
    rl.close()
  }
}

/**
 * Menú numérico simple.
 * @returns {Promise<string>} id de la opción elegida
 */
export async function choose(question, options, { defaultIndex = 0 } = {}) {
  if (!isInteractive()) return options[defaultIndex].value

  const lines = [c.cyan(`? ${question}`)]
  options.forEach((option, index) => {
    const marker = index === defaultIndex ? c.green('❯') : ' '
    lines.push(`  ${marker} ${c.bold(String(index + 1))}) ${option.label}${option.hint ? c.gray(`  ${option.hint}`) : ''}`)
  })
  process.stdout.write(`${lines.join('\n')}\n`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(c.gray('Número: '))).trim()
    const index = Number(answer) - 1
    if (Number.isInteger(index) && index >= 0 && index < options.length) {
      return options[index].value
    }
    return options[defaultIndex].value
  } finally {
    rl.close()
  }
}
