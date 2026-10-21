import { convertToSticker, stickerToTray } from '../lib/media.js'
import { extensionFor } from '../lib/message.js'
import { isAnimatedExtension } from '../lib/ffmpeg.js'
import { isWebp, readSticker, writeStickerMetadata } from '../lib/sticker.js'
import { splitNameAuthor } from '../lib/text.js'
import { createZip } from '../lib/zip.js'

const DONE = new Set(['done', 'listo', 'fin', 'finish', 'terminar', 'zip'])
const CANCEL = new Set(['cancel', 'cancelar', 'salir', 'stop'])
const ADD = new Set(['add', 'agregar', 'añadir', 'anadir', '+'])
const STATUS = new Set(['status', 'estado', 'info', 'lista', 'list'])

const COUNT_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

const KIND_LABEL = {
  sticker: 'Sticker',
  image: 'Foto',
  video: 'Video',
  document: 'Archivo'
}

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

/** Tipos de media que se pueden agregar al pack según la configuración */
export function acceptedKinds(config) {
  const kinds = ['sticker']
  if (config.pack?.acceptPhotos !== false) kinds.push('image')
  if (config.pack?.acceptVideos !== false) kinds.push('video')
  if (config.pack?.acceptPhotos !== false || config.pack?.acceptVideos !== false) {
    kinds.push('document')
  }
  return kinds
}

export function acceptedKindsMessage(config) {
  const parts = ['*stickers*']
  if (config.pack?.acceptPhotos !== false) parts.push('*fotos*')
  if (config.pack?.acceptVideos !== false) parts.push('*videos* o *GIFs*')
  return `Envía ${parts.join(', ')} (o responde con *.pack add*).`
}

function statusMessage(session, config) {
  const max = config.pack.maxStickers
  return [
    '📦 *Pack en curso*',
    `▸ Nombre: *${session.name}*`,
    `▸ Autor: *${session.author}*`,
    `▸ Stickers: *${session.stickers.length}/${max}*`,
    acceptedKindsMessage(config),
    `✅ *.pack done* para descargar el ZIP`,
    `🚫 *.pack cancel* para cancelar`
  ].join('\n')
}

/** Convierte el media recibido en un sticker listo para el pack */
async function toStickerBuffer(ctx, target) {
  const buffer = await ctx.download(target)

  if (target.kind === 'sticker' || isWebp(buffer)) {
    const info = await readSticker(buffer).catch(() => ({ metadata: null, animated: false }))
    return {
      buffer,
      emojis: info.metadata?.emojis || [],
      converted: false,
      animated: Boolean(info.animated)
    }
  }

  if (target.kind === 'document' && !/^(image|video)\//.test(target.media?.mimetype || '')) {
    throw new Error('El documento no es una imagen ni un video compatible.')
  }

  const extension = extensionFor(target.media)
  const animated =
    target.kind === 'video' ||
    isAnimatedExtension(extension) ||
    String(target.media?.mimetype || '').includes('gif')

  const result = await convertToSticker(buffer, {
    extension,
    animated,
    settings: ctx.config.stickers,
    logger: ctx.logger
  })

  return { buffer: result.buffer, emojis: [], converted: true, animated }
}

async function finishPack(ctx, session) {
  const config = ctx.config
  if (!session) {
    throw new Error(
      `No hay ningún pack en curso. Inicia uno con *.pack Nombre | Autor* (máximo ${config.pack.maxStickers} stickers).`
    )
  }
  if (!session.stickers.length) {
    throw new Error('El pack está vacío. Envía al menos una foto o un sticker antes de usar *.pack done*.')
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

/**
 * Agrega al pack el media del mensaje (o del citado).
 * Acepta stickers tal cual y convierte fotos / videos / GIFs a sticker.
 */
async function addMediaToSession(ctx, session, { silent = false } = {}) {
  if (!session) throw new Error('No hay una sesión de pack activa.')

  const kinds = acceptedKinds(ctx.config)
  const target = ctx.requireMedia(
    kinds,
    'Envía una *foto*, *video*, *GIF* o *sticker* para agregarlo al pack (o responde a uno con *.pack add*).'
  )

  const max = ctx.config.pack.maxStickers
  if (session.stickers.length >= max) {
    throw new Error(`El pack llegó al máximo de *${max}* stickers. Usa *.pack done* para descargarlo.`)
  }

  const isSticker = target.kind === 'sticker'
  if (!isSticker && !silent) await ctx.typing('composing')
  if (!isSticker && silent) await ctx.react('⏳')

  const converted = await toStickerBuffer(ctx, target)
  const result = ctx.store.packs.add(session, {
    buffer: converted.buffer,
    emojis: converted.emojis,
    animated: converted.animated,
    kind: target.kind,
    addedAt: Date.now()
  })

  if (!result.ok) {
    if (result.reason === 'lleno') {
      throw new Error(`El pack llegó al máximo de *${max}* stickers. Usa *.pack done* para descargarlo.`)
    }
    throw new Error('No hay una sesión de pack activa.')
  }

  const count = result.count
  const label = KIND_LABEL[target.kind] || 'Sticker'
  const extra = count === max ? `\n🎉 ¡Completaste los *${max}* stickers! Envía *.pack done* para descargar el pack.` : ''

  if (!silent || count === 1) {
    await ctx.reply(
      `📥 ${label} *${count}/${max}* agregada a *${session.name}*` +
        `${converted.converted ? ' (convertida a sticker)' : ''}.\n` +
        `Cuando termines: *.pack done* · cancelar: *.pack cancel*${extra}`
    )
  } else {
    await ctx.react(COUNT_EMOJIS[Math.min(count, 10) - 1] || '📥')
    if (count === max) {
      await ctx.reply(
        `🎉 *${max}/${max}* stickers en *${session.name}*. Envía *.pack done* para descargar el pack.`
      )
    }
  }

  // Descarga automática opcional: pack.autoDoneAfter = N (> 0)
  const autoDoneAfter = Number(ctx.config.pack.autoDoneAfter) || 0
  if (autoDoneAfter > 0 && count >= autoDoneAfter) {
    await finishPack(ctx, session)
  }

  return count
}

const command = {
  name: 'pack',
  aliases: ['packsticker', 'stickerpack', 'packdone'],
  category: 'extras',
  description: 'Crear un paquete de stickers.',
  usage: '.pack Nombre | Autor · envía fotos o stickers · .pack done · .pack cancel',
  examples: ['.pack Olas del mar | Tomi', '(envía 3 fotos)', '.pack done'],
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
      await addMediaToSession(ctx, session)
      return 'pack add'
    }

    if (STATUS.has(first)) {
      if (!session) throw new Error('No hay ningún pack en curso.')
      await ctx.reply(statusMessage(session, config))
      return 'pack status'
    }

    const hasMedia = Boolean(ctx.mediaTarget) && acceptedKinds(config).includes(ctx.mediaTarget.kind)

    // ".pack" como pie de foto/video: inicia (o usa) el pack y agrega esa foto
    if (session) {
      if (hasMedia) {
        return addMediaToSession(ctx, session).then((count) => `pack + media (${count})`)
      }
      await ctx.reply(
        `⚠️ Ya tienes el pack *${session.name}* en curso (${session.stickers.length}/${config.pack.maxStickers}).\n` +
          `✅ *.pack done* para descargarlo · 🚫 *.pack cancel* para descartarlo\n` +
          acceptedKindsMessage(config)
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
        acceptedKindsMessage(config),
        `Máximo *${config.pack.maxStickers}* stickers.`,
        'Termina con *.pack done* y recibirás el archivo *.wasticker*.',
        `_La sesión expira en ${config.pack.sessionMinutes} minutos de inactividad._`
      ].join('\n')
    )

    // Si el comando vino como pie de foto/video, esa imagen ya entra al pack
    if (hasMedia) {
      const count = await addMediaToSession(ctx, created)
      return `pack iniciado "${created.name}" con ${count} medio(s)`
    }

    return `pack iniciado "${created.name}"`
  },

  /**
   * Se llama desde el handler cuando llega una foto, video, GIF o sticker
   * y el usuario tiene un pack en curso.
   * @returns {Promise<boolean>} true si el mensaje fue consumido
   */
  async onMedia(ctx) {
    const session = ctx.store.packs.findByChat(ctx.chatJid, ctx.senderJid)
    if (!session) return false

    const target = ctx.mediaTarget
    if (!target) return false
    if (!acceptedKinds(ctx.config).includes(target.kind)) return false

    try {
      await addMediaToSession(ctx, session, { silent: true })
    } catch (error) {
      ctx.logger?.warn?.(`Auto-add al pack falló: ${error.message}`)
      await ctx.reply(`❌ No se pudo agregar al pack: ${error.message}`).catch(() => {})
    }
    return true
  },

  /** Compatibilidad con la versión anterior */
  async onSticker(ctx) {
    return command.onMedia(ctx)
  }
}

export default command
export { finishPack, statusMessage, addMediaToSession, toStickerBuffer }
