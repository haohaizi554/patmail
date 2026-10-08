import initSqlJs, { type SqlStatic } from 'sql.js'
import wasmAsset from 'sql.js/dist/sql-wasm.wasm?url'
import type { RagIndexSnapshot, RagPassageRecord } from './rag-graph'

let engine: Promise<SqlStatic> | null = null
let binaryOverride: ArrayBuffer | null = null

/** 测试里直接交给已读出的 wasm，避免再去拉文件。 */
export function useWasmBinary(bytes: ArrayBuffer): void {
  binaryOverride = bytes
  engine = null
}

async function wasmBinary(): Promise<ArrayBuffer> {
  if (binaryOverride) return binaryOverride
  const response = await fetch(wasmAsset)
  if (!response.ok) throw new Error('向量库组件没有载入。')
  return response.arrayBuffer()
}

function sqlEngine(): Promise<SqlStatic> {
  engine ??= wasmBinary().then(binary => initSqlJs({ wasmBinary: binary }))
  return engine
}

function vectorBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength))
}

function vectorFrom(value: unknown): Float32Array | null {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength % 4 !== 0) return null
  const copy = value.slice()
  return new Float32Array(copy.buffer)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function pairs(value: unknown): Array<[string, number]> | null {
  if (!Array.isArray(value)) return null
  const rows: Array<[string, number]> = []
  for (const item of value) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'number') return null
    rows.push([item[0], item[1]])
  }
  return rows
}

function words(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null
  return value
}

function cell(row: unknown[], columns: string[], name: string): unknown {
  return row[columns.indexOf(name)]
}

/** 把算好的索引写成 SQLite 文件字节。 */
export async function encodeRagIndex(snapshot: RagIndexSnapshot): Promise<Uint8Array> {
  const SQL = await sqlEngine()
  const db = new SQL.Database()
  try {
    db.run(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE term_df (term TEXT PRIMARY KEY, df INTEGER NOT NULL);
      CREATE TABLE gram_df (gram TEXT PRIMARY KEY, df INTEGER NOT NULL);
      CREATE TABLE passage (
        id INTEGER PRIMARY KEY,
        file TEXT NOT NULL,
        heading TEXT NOT NULL,
        body TEXT NOT NULL,
        length INTEGER NOT NULL,
        tf TEXT NOT NULL,
        heading_terms TEXT NOT NULL,
        file_terms TEXT NOT NULL,
        vector BLOB NOT NULL
      )`)
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
    meta.run(['version', String(snapshot.version)])
    meta.run(['fingerprint', snapshot.fingerprint])
    meta.run(['avg', String(snapshot.avg)])
    meta.free()
    const terms = db.prepare('INSERT INTO term_df (term, df) VALUES (?, ?)')
    for (const [term, df] of snapshot.df) terms.run([term, df])
    terms.free()
    const grams = db.prepare('INSERT INTO gram_df (gram, df) VALUES (?, ?)')
    for (const [gram, df] of snapshot.gramDf) grams.run([gram, df])
    grams.free()
    const passages = db.prepare(`INSERT INTO passage
      (file, heading, body, length, tf, heading_terms, file_terms, vector)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const passage of snapshot.passages) {
      passages.run([
        passage.file,
        passage.heading,
        passage.body,
        passage.length,
        JSON.stringify(passage.tf),
        JSON.stringify(passage.headingTerms),
        JSON.stringify(passage.fileTerms),
        vectorBytes(passage.vector)
      ])
    }
    passages.free()
    return db.export()
  } finally {
    db.close()
  }
}

function metaValue(rows: Array<{ columns: string[]; values: unknown[][] }>, key: string): string {
  const table = rows[0]
  if (!table) return ''
  const keyIndex = table.columns.indexOf('key')
  const valueIndex = table.columns.indexOf('value')
  const found = table.values.find(row => row[keyIndex] === key)
  return found ? text(found[valueIndex]) : ''
}

function countRows(rows: Array<{ columns: string[]; values: unknown[][] }>): Array<[string, number]> {
  const table = rows[0]
  if (!table) return []
  const name = table.columns[0]
  const count = table.columns.indexOf('df')
  if (!name || count < 0) return []
  return table.values.flatMap(row => {
    const term = text(row[0])
    const df = row[count]
    return term && typeof df === 'number' ? [[term, df] as [string, number]] : []
  })
}

/** 从 SQLite 文件字节读回索引。文件坏了就返回空，调用方再重算。 */
export async function decodeRagIndex(bytes: Uint8Array): Promise<RagIndexSnapshot | null> {
  if (bytes.byteLength < 16) return null
  const SQL = await sqlEngine()
  const db = new SQL.Database(bytes)
  try {
    const meta = db.exec('SELECT key, value FROM meta')
    const version = Number(metaValue(meta, 'version'))
    const fingerprint = metaValue(meta, 'fingerprint')
    const avg = Number(metaValue(meta, 'avg'))
    if (!fingerprint || !Number.isFinite(version) || !Number.isFinite(avg)) return null
    const passages = db.exec('SELECT file, heading, body, length, tf, heading_terms, file_terms, vector FROM passage ORDER BY id')
    const table = passages[0]
    if (!table) return null
    const records: RagPassageRecord[] = []
    for (const row of table.values) {
      const vector = vectorFrom(cell(row, table.columns, 'vector'))
      const tf = pairs(JSON.parse(text(cell(row, table.columns, 'tf'))))
      const headingTerms = words(JSON.parse(text(cell(row, table.columns, 'heading_terms'))))
      const fileTerms = words(JSON.parse(text(cell(row, table.columns, 'file_terms'))))
      const length = cell(row, table.columns, 'length')
      if (!vector || !tf || !headingTerms || !fileTerms || typeof length !== 'number') return null
      records.push({
        file: text(cell(row, table.columns, 'file')),
        heading: text(cell(row, table.columns, 'heading')),
        body: text(cell(row, table.columns, 'body')),
        length,
        tf,
        headingTerms,
        fileTerms,
        vector
      })
    }
    if (records.length === 0) return null
    return {
      version,
      fingerprint,
      avg,
      df: countRows(db.exec('SELECT term, df FROM term_df')),
      gramDf: countRows(db.exec('SELECT gram, df FROM gram_df')),
      passages: records
    }
  } catch {
    return null
  } finally {
    db.close()
  }
}
