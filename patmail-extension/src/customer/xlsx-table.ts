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
    for (const cell of match[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = cell[1].match(/\br="([A-Z]+\d+)"/i)?.[1] ?? ''
      const index = ref ? columnIndex(ref) : cells.length
      if (index < 0 || index > 80) continue
      const kind = cell[1].match(/\bt="([^"]+)"/)?.[1] ?? ''
      const value = cell[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
      const inline = [...cell[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(item => decodeXml(item[1])).join('')
      let text = ''
      if (kind === 's') text = shared[Number(value)] ?? ''
      else if (kind === 'inlineStr') text = inline
      else text = decodeXml(value)
      while (cells.length < index) cells.push('')
      cells[index] = text.trim()
    }
    if (cells.some(item => item)) rows.push(cells)
    if (rows.length >= 301) break
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

export async function readXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const files = await readZip(buffer)
  const sheetPath = firstSheetPath(files)
  const sheet = sheetPath ? files.get(sheetPath) : undefined
  if (!sheet) throw new Error('表格里没有工作表。')
  return rowsFromSheetXml(sheet, sharedStringsFromXml(files.get('xl/sharedStrings.xml') ?? ''))
}
