/**
 * Generador de archivos ZIP mínimo (método "store", sin compresión).
 * Los stickers ya están comprimidos en WebP, así que no hace falta deflate.
 * Sin dependencias externas: ideal para Termux.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

export function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f)
  const day =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f)
  return { time, day }
}

/**
 * Crea un ZIP a partir de entradas [{ name, data, date? }]
 * @returns {Buffer}
 */
export function createZip(entries, { date = new Date() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('createZip necesita al menos un archivo')
  }
  if (entries.length > 0xffff) throw new Error('Demasiados archivos para un ZIP')

  const { time, day } = dosDateTime(date)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '')
    const checksum = crc32(data)
    const flags = /[^\x20-\x7e]/.test(entry.name) ? 0x0800 : 0 // UTF-8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versión necesaria
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // versión creadora
    central.writeUInt16LE(20, 6) // versión necesaria
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comentario
    central.writeUInt16LE(0, 34) // disco
    central.writeUInt16LE(0, 36) // atributos internos
    central.writeUInt32LE(0, 38) // atributos externos
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += local.length + name.length + data.length
  }

  const centralBuffer = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralBuffer, end])
}

export default createZip
