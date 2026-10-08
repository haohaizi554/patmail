function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

export function sharedStringsFromXml(xml: string): string[] {
  const items: string[] = []
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const texts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1]))
    items.push(texts.join(''))
  }
  return items
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase()
  let index = 0
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64
  return index - 1
}

/** 第一张表的单元格。共享字符串用下标，普通单元格用文本。 */
export function rowsFromSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  for (const match of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const cell of match[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]
      const body = cell[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? ''
      const index = ref ? columnIndex(ref) : cells.length
      if (index < 0 || index > 80) continue
      const kind = attrs.match(/\bt="([^"]+)"/)?.[1] ?? ''
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
      const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1])).join('')
      let text = ''
      if (kind === 's') text = shared[Number(value)] ?? ''
      else if (kind === 'inlineStr') text = inline
      else text = decodeXml(value)
      while (cells.length < index) cells.push('')
      cells[index] = text.trim()
    }
    if (cells.some(item => item)) rows.push(cells)
    if (rows.length >= 5000) break
  }
  return rows
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    }
  })
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readZip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let end = -1
  const min = Math.max(0, bytes.length - 22 - 65536)
  for (let index = bytes.length - 22; index >= min; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index
      break
    }
  }
  if (end < 0) throw new Error('这不是 xlsx 文件。')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const files = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (localOffset + 30 <= bytes.length && view.getUint32(localOffset, true) === 0x04034b50) {
      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const compressed = bytes.subarray(start, start + compressedSize)
      if (method === 0) files.set(name, compressed)
      else if (method === 8) files.set(name, await inflateRaw(compressed))
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  const text = new Map<string, string>()
  const decoder = new TextDecoder()
  for (const [name, data] of files) text.set(name, decoder.decode(data))
  return text
}

function firstSheetPath(files: Map<string, string>): string | null {
  const workbook = files.get('xl/workbook.xml') ?? ''
  const rels = files.get('xl/_rels/workbook.xml.rels') ?? ''
  const relationId = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  if (relationId) {
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      const id = match[1].match(/\bId="([^"]+)"/)?.[1]
      const target = match[1].match(/\bTarget="([^"]+)"/)?.[1]
      if (id !== relationId || !target) continue
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      if (files.has(path)) return path
    }
  }
  return files.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : null
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function columnRef(index: number): string {
  let value = index + 1
  let letters = ''
  while (value > 0) {
    value -= 1
    letters = String.fromCharCode(65 + (value % 26)) + letters
    value = Math.floor(value / 26)
  }
  return letters
}

function sheetXml(rows: string[][]): string {
  const body = rows.map((line, index) => {
    const cells = line.map((value, column) => `<c r="${columnRef(column)}${index + 1}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`).join('')
    return `<row r="${index + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

function storedZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    const crc = crc32(file.data)
    const local = new Uint8Array(30 + name.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, file.data.length, true)
    view.setUint32(22, file.data.length, true)
    view.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const directory = new DataView(central.buffer)
    directory.setUint32(0, 0x02014b50, true)
    directory.setUint16(4, 20, true)
    directory.setUint16(6, 20, true)
    directory.setUint16(10, 0, true)
    directory.setUint16(12, 0, true)
    directory.setUint32(16, crc, true)
    directory.setUint32(20, file.data.length, true)
    directory.setUint32(24, file.data.length, true)
    directory.setUint16(28, name.length, true)
    directory.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, file.data)
    centrals.push(central)
    offset += local.length + file.data.length
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const end = new Uint8Array(22)
  const tail = new DataView(end.buffer)
  tail.setUint32(0, 0x06054b50, true)
  tail.setUint16(8, files.length, true)
  tail.setUint16(10, files.length, true)
  tail.setUint32(12, centralSize, true)
  tail.setUint32(16, offset, true)
  const output = new Uint8Array(offset + centralSize + end.length)
  let cursor = 0
  for (const part of [...locals, ...centrals, end]) {
    output.set(part, cursor)
    cursor += part.length
  }
  return output
}

function zipFile(name: string, text: string): { name: string; data: Uint8Array } {
  return { name, data: new TextEncoder().encode(text) }
}

/** 一张表。单元格都是文本，表头就是第一行。 */
export function xlsxBytes(rows: string[][], sheetName = 'Sheet1'): ArrayBuffer {
  const name = xmlText(sheetName.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet1')
  const bytes = storedZip([
    zipFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`),
    zipFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`),
    zipFile('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    zipFile('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`),
    zipFile('xl/worksheets/sheet1.xml', sheetXml(rows))
  ])
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

export function downloadXlsxRows(rows: string[][], filename: string, sheetName = 'Sheet1'): void {
  const blob = new Blob([xlsxBytes(rows, sheetName)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function readXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const files = await readZip(buffer)
  const sheetPath = firstSheetPath(files)
  const sheet = sheetPath ? files.get(sheetPath) : undefined
  if (!sheet) throw new Error('表格里没有工作表。')
  return rowsFromSheetXml(sheet, sharedStringsFromXml(files.get('xl/sharedStrings.xml') ?? ''))
}
