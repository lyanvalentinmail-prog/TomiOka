import { runAiCommand } from '../lib/ai.js'

export default {
  name: 'gemini',
  aliases: ['google-ai', 'geminiai'],
  category: 'ai',
  description: 'Preguntarle a la IA Gemini de Google.',
  usage: '.gemini <tu pregunta>',
  examples: [
    '.gemini explica la fotosíntesis en tres líneas',
    '.gemini dame 5 ideas de nombres para un gato'
  ],
  async run(ctx) {
    return runAiCommand(ctx, {
      request: 'gemini',
      label: 'Gemini',
      emoji: '💧',
      system:
        'Eres Gemini, un asistente útil. Respondes en el idioma del usuario (por defecto español). ' +
        'Tus respuestas viajan por WhatsApp: sé claro y breve, usa listas cortas y evita tablas anchas.'
    })
  }
}
