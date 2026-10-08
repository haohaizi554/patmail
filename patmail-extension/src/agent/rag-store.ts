import { apiDocSections } from './api-docs'
import { captureIndex, corpusFingerprint, rememberIndex, warmIndex, type RagSection } from './rag-graph'
import { decodeRagIndex, encodeRagIndex } from './rag-sqlite'

const DB_NAME = 'patmail-rag'
const STORE = 'sqlite'
const KEY = 'index'

export interface RagByteStore {
  read(): Promise<Uint8Array | null>
  write(bytes: Uint8Array): Promise<void>
}

/** 扩展本机 IndexedDB。Service Worker 休眠后文件还在这台电脑上。 */
export function indexedRagStore(factory: IDBFactory | undefined = globalThis.indexedDB): RagByteStore | null {
  if (!factory) return null
  let opened: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('向量库没有打开。'))
    })
    return opened
  }
  return {
    async read() {
      const database = await open()
      return await new Promise((resolve, reject) => {
        const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
        request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null)
        request.onerror = () => reject(request.error ?? new Error('向量库没有读到。'))
      })
    },
    async write(bytes) {
      const database = await open()
      await new Promise<void>((resolve, reject) => {
        const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(bytes, KEY)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error('向量库没有写入。'))
      })
    }
  }
}

/** 指纹一致就装回内存。没有库或库过期时现算，再写回本地。 */
export async function restoreRagIndex(sections: RagSection[], store: RagByteStore): Promise<'ready' | 'rebuilt'> {
  const fingerprint = corpusFingerprint(sections)
  try {
    const bytes = await store.read()
    if (bytes) {
      const snapshot = await decodeRagIndex(bytes)
      if (snapshot && snapshot.fingerprint === fingerprint && rememberIndex(sections, snapshot)) return 'ready'
    }
  } catch {
    /* 读坏了就重算。 */
  }
  warmIndex(sections)
  const snapshot = captureIndex(sections)
  if (snapshot) {
    try { await store.write(await encodeRagIndex(snapshot)) } catch { /* 这次先用内存里的索引。 */ }
  }
  return 'rebuilt'
}

let preparing: Promise<void> | null = null

/** 后台启动时调用。同一轮里重复调用共用这一次读取。 */
export function prepareApiDocs(): Promise<void> {
  preparing ??= (async () => {
    const sections = apiDocSections()
    const store = indexedRagStore()
    if (!store) {
      warmIndex(sections)
      return
    }
    await restoreRagIndex(sections, store)
  })().catch(() => {
    preparing = null
    warmIndex(apiDocSections())
  })
  return preparing
}
