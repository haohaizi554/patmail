import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { captureIndex, corpusFingerprint, rememberIndex, warmIndex, type RagSection } from '../src/agent/rag-graph'
import { decodeRagIndex, encodeRagIndex, useWasmBinary } from '../src/agent/rag-sqlite'
import { restoreRagIndex, type RagByteStore } from '../src/agent/rag-store'

const require = createRequire(import.meta.url)
const wasmFile = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
useWasmBinary(wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength))

const sections: RagSection[] = [
  { file: '04-文件查询.md', heading: '文件查询 / GetSearchFiles', body: 'Call=GetSearchFiles' },
  { file: '04-文件查询.md', heading: '文件查询 / 其它', body: '这里没有那个调用名。' }
]

function memoryStore(): RagByteStore & { bytes: Uint8Array | null } {
  const box: { bytes: Uint8Array | null } = { bytes: null }
  return {
    get bytes() { return box.bytes },
    set bytes(value: Uint8Array | null) { box.bytes = value },
    async read() { return box.bytes },
    async write(bytes) { box.bytes = bytes }
  }
}

describe('rag sqlite store', () => {
  it('reloads the same vectors from the sqlite file without rebuilding them', async () => {
    const first = sections.map(section => ({ ...section }))
    warmIndex(first)
    const saved = captureIndex(first)
    expect(saved?.fingerprint).toBe(corpusFingerprint(first))
    const bytes = await encodeRagIndex(saved!)
    const loaded = await decodeRagIndex(bytes)
    expect(loaded?.passages).toHaveLength(saved!.passages.length)
    const second = sections.map(section => ({ ...section }))
    expect(rememberIndex(second, loaded!)).toBe(true)
    const again = captureIndex(second)
    expect(again?.passages[0]?.vector).toEqual(saved?.passages[0]?.vector)
    expect(rememberIndex(second, { ...loaded!, fingerprint: 'stale' })).toBe(false)
  })

  it('writes the database once and reads it back for a new document list', async () => {
    const store = memoryStore()
    const built = sections.map(section => ({ ...section }))
    expect(await restoreRagIndex(built, store)).toBe('rebuilt')
    expect(store.bytes?.byteLength).toBeGreaterThan(16)
    const reopened = sections.map(section => ({ ...section }))
    expect(await restoreRagIndex(reopened, store)).toBe('ready')
    expect(captureIndex(reopened)?.fingerprint).toBe(corpusFingerprint(reopened))
  })
})
