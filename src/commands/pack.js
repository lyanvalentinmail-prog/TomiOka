import { stickerToTray } from '../lib/media.js'
import { readSticker, writeStickerMetadata } from '../lib/sticker.js'
import { splitNameAuthor } from '../lib/text.js'
import { createZip } from '../lib/zip.js'

const DONE = new Set(['done', 'listo', 'fin', 'finish', 'terminar', 'zip'])
const CANCEL = new Set(['cancel', 'cancelar', 'salir', 'stop'])
const ADD = new Set(['add', 'agregar', 'añadir', 'anadir', '+'])
const STATUS = new Set(['status', 'estado', 'info', 'lista', 'list'])

const COUNT_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

function safeFileName(name) {
  return (
    String(name || 'pack')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'pack'
  )
}

function statusMessage(session, config) {
  const max = config.pack.maxStickers
  const lines = [
    '📦 *Pack en curso*',
    `▸ Nombre: *${session.name}*`,
    `▸ Autor: *${session.author}*`,
    `▸ Stickers: *${session.stickers.length}/${max}*`,
    '',
    '📥 Envía stickers (o responde con *.pack add*)',
    `✅ *.pack done* para descargar el ZIP`,
    `🚫 *.pack cancel* para cancelar`
  ]
  return lines.join('\n')
}

async function finishPack(ctx, session) {
  const config = ctx.config
  if (!session) {
    throw new Error(
      `No hay ningún pack en curso. Inicia uno con *.pack Nombre | Autor* (máximo ${config.pack.maxStickers} stickers).`
    )
  }
  if (!session.stickers.length) {
    throw new Error('El pack está vacío. Envía al menos un sticker antes de usar *.pack done*.')
  }

  await ctx.typing()

  const identifier = `tomioka_${Date.now().toString(36)}`
  const files = []
  const stickers = []
  let anyAnimated = false

  for (const [index, sticker] of session.stickers.entries()) {
    let buffer = sticker.buffer
    try {
      buffer = await writeStickerMetadata(buffer, {
        packName: session.name,
        packAuthor: session.author,
        emojis: sticker.emojis || [],
        packId: identifier
      })
    } catch (error) {
      ctx.logger?.warn?.(`No se pudo escribir metadatos en el sticker ${index + 1}: ${error.message}`)
    }
    const info = await readSticker(buffer).catch(() => ({ animated: false }))
    anyAnimated = anyAnimated || info.animated

    const fileName = `${identifier}_${index + 1}.webp`
    files.push({ name: fileName, data: buffer })
    stickers.push({
      image_file: fileName,
      emojis: sticker.emojis?.length ? sticker.emojis.slice(0, 3) : ['🌊']
    })
  }

  let trayFile = ''
  try {
    const tray = await stickerToTray(session.stickers[0].buffer, { size: config.pack.traySize })
    trayFile = `${identifier}_tray.png`
    files.push({ name: trayFile, data: tray })
  } catch (error) {
    ctx.logger?.warn?.(`No se pudo generar la vista previa del pack: ${error.message}`)
  }

  const contents = {
    android_play_store_link: 'https://play.google.com/store/apps/details?id=com.whatsapp.stickers',
    ios_app_download_link: 'https://apps.apple.com/app/whatsapp-messenger/id310633997',
    image_data_version: '1',
    avoid_cache: false,
    sticker_packs: [
      {
        identifier,
        name: session.name,
        publisher: session.author,
        publisher_email: '',
        publisher_website: '',
        privacy_policy_website: '',
        license_agreement_website: '',
        image_data_version: '1',
        ...(trayFile ? { tray_image_file: trayFile } : {}),
        animated_sticker_pack: anyAnimated,
        stickers
      }
    ]
  }

  files.unshift({
    name: 'contents.json',
    data: Buffer.from(JSON.stringify(contents, null, 2), 'utf8')
  })

  const zip = createZip(files)
  const fileName = `${safeFileName(session.name)}.wasticker`

  await ctx.sendDocument(
    zip,
    fileName,
    'application/zip',
    [
      '📦 *Pack listo*',
      `▸ ${session.name}`,
      `▸ ${stickers.length} sticker(s) · ${(zip.length / 1024).toFixed(0)} KB`,
      '',
      'Impórtalo con una app de packs (Sticker Maker / .wasticker)'
    ].join('\n')
  )

  // La sesión se descarta recién cuando el archivo se envió bien
  ctx.store.packs.finish(session)

  return `pack "${session.name}" ${stickers.length} stickers ${Math.round(zip.length / 1024)}KB`
}

async function addStickerToSession(ctx, session, { silent = false } = {}) {
  const target = ctx.requireMedia(
    ['sticker'],
    'Responde a un *sticker* (o envíalo) para agregarlo al pack.'
  )
  const buffer = await ctx.download(target)
  const info = await readSticker(buffer).catch(() => ({ metadata: null }))
  const result = ctx.store.packs.add(session, {
    buffer,
    emojis: info.metadata?.emojis || [],
    addedAt: Date.now()
  })

  if (!result.ok) {
    if (result.reason === 'lleno') {
      throw new Error(
        `El pack llegó al máximo de *${ctx.config.pack.maxStickers}* stickers. Usa *.pack done* para descargarlo.`
      )
    }
    throw new Error('No hay una sesión de pack activa.')
  }

  const count = result.count
  if (!silent || count === 1) {
    await ctx.reply(
      `📥 Sticker *${count}/${ctx.config.pack.maxStickers}* agregado a *${session.name}*.\n` +
        `Cuando termines: *.pack done* · cancelar: *.pack cancel*`
    )
  } else {
    await ctx.react(COUNT_EMOJIS[Math.min(count, 10) - 1] || '📥')
  }
  return count
}

const command = {
  name: 'pack',
  aliases: ['packsticker', 'stickerpack', 'packdone'],
  category: 'extras',
  description: 'Crear un paquete de stickers.',
  usage: '.pack Nombre | Autor · .pack add · .pack done · .pack cancel',
  examples: ['.pack Olas del mar | Tomi', '.pack done'],
  async run(ctx) {
    const config = ctx.config
    const first = (ctx.args[0] || '').toLowerCase()
    const session = ctx.store.packs.get(ctx.chatJid, ctx.senderJid)

    if (CANCEL.has(first)) {
      if (!session) throw new Error('No hay ningún pack en curso.')
      ctx.store.packs.cancel(session)
      await ctx.reply('🚫 Pack cancelado. Los stickers en memoria fueron descartados.')
      return 'pack cancelado'
    }

    if (DONE.has(first)) {
      return finishPack(ctx, session)
    }

    if (ADD.has(first)) {
      if (!session) throw new Error('Primero inicia un pack con *.pack Nombre | Autor*.')
      await addStickerToSession(ctx, session)
      return 'pack add'
    }

    if (STATUS.has(first)) {
      if (!session) throw new Error('No hay ningún pack en curso.')
      await ctx.reply(statusMessage(session, config))
      return 'pack status'
    }

    if (session) {
      await ctx.reply(
        `⚠️ Ya tienes el pack *${session.name}* en curso (${session.stickers.length}/${config.pack.maxStickers}).\n\n` +
          `✅ *.pack done* para descargarlo\n🚫 *.pack cancel* para descartarlo\n📥 envía stickers para agregarlos`
      )
      return 'pack en curso'
    }

    const { name, author } = splitNameAuthor(ctx.argsText, {
      name: config.pack.defaultName,
      author: config.pack.defaultAuthor
    })
    if (name.length > 45) throw new Error('El nombre del pack es demasiado largo (máx. 45 caracteres).')

    const created = ctx.store.packs.start({
      chatJid: ctx.chatJid,
      senderJid: ctx.senderJid,
      name,
      author
    })

    await ctx.reply(
      [
        '📦 *Nuevo pack iniciado*',
        `▸ Nombre: *${name}*`,
        `▸ Autor: *${author}*`,
        '',
        '1. Envía los stickers que quieras incluir (o responde con *.pack add*)',
        `2. Máximo *${config.pack.maxStickers}* stickers`,
        '3. Termina con *.pack done* y recibirás el archivo *.wasticker*',
        '',
        `_La sesión expira en ${config.pack.sessionMinutes} minutos de inactividad._`
      ].join('\n')
    )
    return `pack iniciado "${created.name}"`
  },

  /** Se llama desde el handler cuando llega un sticker con una sesión activa */
  async onSticker(ctx) {
    const session = ctx.store.packs.findByChat(ctx.chatJid, ctx.senderJid)
    if (!session) return false
    try {
      await addStickerToSession(ctx, session, { silent: true })
    } catch (error) {
      ctx.logger?.warn?.(`Auto-add al pack falló: ${error.message}`)
    }
    return true
  }
}

export default command
export { finishPack, statusMessage }
