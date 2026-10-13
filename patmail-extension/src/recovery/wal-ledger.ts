import initSqlJs, { type SqlStatic } from 'sql.js'

type SqlDatabase = InstanceType<SqlStatic['Database']>
import wasmAsset from 'sql.js/dist/sql-wasm.wasm?url'

/** 工作面、查询结果、发文账本、流程执行记录。登录掉了也按这个槽位装回去。 */
export type RecoverySlot = 'workflow-desk' | 'limit-query' | 'limit-mail' | 'file-mail' | 'file-desk' | 'workflow-exec' | 'mail-exec'

export interface StoredFrame {
  seq: number
  slot: RecoverySlot
  scope: string
  payload: string
  at: string
}

export interface RecoveryStore {
  readCheckpoint(): Promise<Uint8Array | null>
  writeCheckpoint(bytes: Uint8Array): Promise<void>
  appendFrame(frame: StoredFrame): Promise<void>
  readFrames(): Promise<StoredFrame[]>
  dropFramesThrough(seq: number): Promise<void>
}

export interface RecoveryHead {
  scope: string
  payload: unknown
  at: string
}

const SLOTS = new Set<RecoverySlot>(['workflow-desk', 'limit-query', 'limit-mail', 'file-mail', 'file-desk', 'workflow-exec', 'mail-exec'])
const SECRET = /^(cookie|authorization|password|set-cookie)$/i

let wasmOverride: ArrayBuffer | null = null
let engine: Promise<SqlStatic> | null = null

/** 测试直接交给 wasm 字节，避免再去拉文件。 */
export function useRecoveryWasm(bytes: ArrayBuffer): void {
  wasmOverride = bytes
  engine = null
}

async function wasmBinary(): Promise<ArrayBuffer> {
  if (wasmOverride) return wasmOverride
  const response = await fetch(wasmAsset)
  if (!response.ok) throw new Error('恢复账本组件没有载入。')
  return response.arrayBuffer()
}

function sqlEngine(): Promise<SqlStatic> {
  engine ??= wasmBinary().then(binary => initSqlJs({ wasmBinary: binary }))
  return engine
}

function isSlot(value: string): value is RecoverySlot {
  return SLOTS.has(value as RecoverySlot)
}

function hasSecret(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => hasSecret(item))
  return Object.entries(value).some(([key, item]) => SECRET.test(key) || hasSecret(item))
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function cell(row: unknown[], columns: string[], name: string): unknown {
  return row[columns.indexOf(name)]
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function memoryRecoveryStore(): RecoveryStore {
  let checkpoint: Uint8Array | null = null
  const frames: StoredFrame[] = []
  return {
    async readCheckpoint() {
      return checkpoint ? checkpoint.slice() : null
    },
    async writeCheckpoint(bytes) {
      checkpoint = bytes.slice()
    },
    async appendFrame(frame) {
      frames.push({ ...frame })
    },
    async readFrames() {
      return frames.map(item => ({ ...item }))
    },
    async dropFramesThrough(seq) {
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        if (frames[index].seq <= seq) frames.splice(index, 1)
      }
    }
  }
}

const DB_NAME = 'patmail-recovery'
const CHECKPOINT = 'checkpoint'
const WAL = 'wal'
const CHECKPOINT_KEY = 'db'

/** 扩展自己的 IndexedDB。页面和后台共用这一份，不放在原站页面里。 */
export function indexedRecoveryStore(factory: IDBFactory | undefined = globalThis.indexedDB): RecoveryStore | null {
  if (!factory) return null
  let opened: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(CHECKPOINT)) database.createObjectStore(CHECKPOINT)
        if (!database.objectStoreNames.contains(WAL)) database.createObjectStore(WAL)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('恢复账本没有打开。'))
    })
    return opened
  }
  return {
    async readCheckpoint() {
      const database = await open()
      return await new Promise((resolve, reject) => {
        const request = database.transaction(CHECKPOINT, 'readonly').objectStore(CHECKPOINT).get(CHECKPOINT_KEY)
        request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null)
        request.onerror = () => reject(request.error ?? new Error('恢复账本没有读到。'))
      })
    },
    async writeCheckpoint(bytes) {
      const database = await open()
      await new Promise<void>((resolve, reject) => {
        const request = database.transaction(CHECKPOINT, 'readwrite').objectStore(CHECKPOINT).put(bytes, CHECKPOINT_KEY)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error('恢复账本没有写入。'))
      })
    },
    async appendFrame(frame) {
      const database = await open()
      await new Promise<void>((resolve, reject) => {
        const request = database.transaction(WAL, 'readwrite').objectStore(WAL).put(frame, frame.seq)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error('恢复账本没有记下这一笔。'))
      })
    },
    async readFrames() {
      const database = await open()
      return await new Promise((resolve, reject) => {
        const request = database.transaction(WAL, 'readonly').objectStore(WAL).getAll()
        request.onsuccess = () => {
          const rows = Array.isArray(request.result) ? request.result : []
          resolve(rows.flatMap(item => {
            if (!item || typeof item !== 'object') return []
            const frame = item as StoredFrame
            return Number.isInteger(frame.seq) && isSlot(frame.slot) && typeof frame.scope === 'string' && typeof frame.payload === 'string'
              ? [{ ...frame }]
              : []
          }))
        }
        request.onerror = () => reject(request.error ?? new Error('恢复账本没有读到未完成的笔。'))
      })
    },
    async dropFramesThrough(seq) {
      const database = await open()
      await new Promise<void>((resolve, reject) => {
        const store = database.transaction(WAL, 'readwrite').objectStore(WAL)
        const request = store.openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve()
            return
          }
          if (typeof cursor.key === 'number' && cursor.key <= seq) cursor.delete()
          cursor.continue()
        }
        request.onerror = () => reject(request.error ?? new Error('恢复账本没有收起已完成的笔。'))
      })
    }
  }
}

function schema(db: SqlDatabase): string {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wal (
      seq INTEGER PRIMARY KEY,
      slot TEXT NOT NULL,
      scope TEXT NOT NULL,
      payload TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS head (
      slot TEXT NOT NULL,
      scope TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (slot, scope)
    )`)
  const mode = db.exec('PRAGMA journal_mode=WAL')
  db.run('PRAGMA synchronous=NORMAL')
  const journal = text(mode[0]?.values[0]?.[0]) || 'memory'
  db.run(`INSERT INTO meta (key, value) VALUES ('journal', ${quote(journal)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
  return journal
}

function maxSeq(db: SqlDatabase): number {
  const rows = db.exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM wal')
  const value = rows[0]?.values[0]?.[0]
  return typeof value === 'number' ? value : 0
}

function applyFrame(db: SqlDatabase, frame: StoredFrame): void {
  db.run('BEGIN IMMEDIATE')
  try {
    db.run(`INSERT OR IGNORE INTO wal (seq, slot, scope, payload, at) VALUES (${frame.seq}, ${quote(frame.slot)}, ${quote(frame.scope)}, ${quote(frame.payload)}, ${quote(frame.at)})`)
    db.run(`INSERT INTO head (slot, scope, seq, payload, at) VALUES (${quote(frame.slot)}, ${quote(frame.scope)}, ${frame.seq}, ${quote(frame.payload)}, ${quote(frame.at)})
      ON CONFLICT(slot, scope) DO UPDATE SET seq=excluded.seq, payload=excluded.payload, at=excluded.at
      WHERE excluded.seq >= head.seq`)
    db.run('COMMIT')
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* 事务已经结束 */ }
    throw error
  }
  try { db.run('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* 这一下没折进去，导出时仍是提交后的库 */ }
}

function readPayload(raw: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { forgotten?: unknown }).forgotten === true) return null
    return parsed
  } catch {
    return null
  }
}

/** SQLite 开着 WAL。真正掉电前先把这一笔写进 IndexedDB，再折进库文件。库文件没写完时，下次打开会把那一笔补上。 */
export class RecoveryLedger {
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly store: RecoveryStore, private readonly db: SqlDatabase, readonly journalMode: string) {}

  put(slot: RecoverySlot, scope: string, payload: unknown): Promise<void> {
    return this.enqueue(() => this.write(slot, scope, payload))
  }

  forget(slot: RecoverySlot, scope: string): Promise<void> {
    return this.put(slot, scope, { forgotten: true })
  }

  async get(slot: RecoverySlot, scope: string): Promise<unknown | null> {
    const rows = this.db.exec(`SELECT payload FROM head WHERE slot=${quote(slot)} AND scope=${quote(scope)}`)
    const raw = rows[0]?.values[0]?.[0]
    return typeof raw === 'string' ? readPayload(raw) : null
  }

  async latest(slot: RecoverySlot): Promise<RecoveryHead | null> {
    const table = this.db.exec(`SELECT scope, payload, at FROM head WHERE slot=${quote(slot)} ORDER BY seq DESC`)[0]
    if (!table) return null
    for (const row of table.values) {
      const payload = readPayload(text(cell(row, table.columns, 'payload')))
      if (payload == null) continue
      return { scope: text(cell(row, table.columns, 'scope')), payload, at: text(cell(row, table.columns, 'at')) }
    }
    return null
  }

  async heads(slot: RecoverySlot): Promise<RecoveryHead[]> {
    const table = this.db.exec(`SELECT scope, payload, at FROM head WHERE slot=${quote(slot)} ORDER BY seq`)[0]
    if (!table) return []
    return table.values.flatMap(row => {
      const payload = readPayload(text(cell(row, table.columns, 'payload')))
      if (payload == null) return []
      return [{ scope: text(cell(row, table.columns, 'scope')), payload, at: text(cell(row, table.columns, 'at')) }]
    })
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  private async write(slot: RecoverySlot, scope: string, payload: unknown): Promise<void> {
    if (!scope || scope.length > 200) throw new Error('恢复账本的范围不对。')
    if (hasSecret(payload)) throw new Error('恢复账本不保存登录凭据。')
    const frame: StoredFrame = {
      seq: maxSeq(this.db) + 1,
      slot,
      scope,
      payload: JSON.stringify(payload),
      at: new Date().toISOString()
    }
    await this.store.appendFrame(frame)
    applyFrame(this.db, frame)
    await this.store.writeCheckpoint(this.db.export())
    await this.store.dropFramesThrough(frame.seq)
  }
}

async function replay(store: RecoveryStore, db: SqlDatabase): Promise<void> {
  const frames = (await store.readFrames()).sort((a, b) => a.seq - b.seq)
  let applied = 0
  for (const frame of frames) {
    if (!isSlot(frame.slot)) continue
    applyFrame(db, frame)
    applied = frame.seq
  }
  if (applied) {
    await store.writeCheckpoint(db.export())
    await store.dropFramesThrough(applied)
  }
}

export async function openRecoveryLedger(store: RecoveryStore): Promise<RecoveryLedger> {
  const SQL = await sqlEngine()
  const bytes = await store.readCheckpoint()
  const db = bytes && bytes.byteLength > 0 ? new SQL.Database(bytes) : new SQL.Database()
  const journal = schema(db)
  await replay(store, db)
  return new RecoveryLedger(store, db, journal)
}

let opening: Promise<RecoveryLedger | null> | null = null

export function recoveryLedger(): Promise<RecoveryLedger | null> {
  const store = indexedRecoveryStore()
  if (!store) return Promise.resolve(null)
  opening ??= openRecoveryLedger(store).catch(() => {
    opening = null
    return null
  })
  return opening
}

export async function rememberRecovery(slot: RecoverySlot, scope: string, payload: unknown): Promise<void> {
  const ledger = await recoveryLedger()
  if (!ledger) return
  await ledger.put(slot, scope, payload)
}

export async function forgetRecovery(slot: RecoverySlot, scope: string): Promise<void> {
  const ledger = await recoveryLedger()
  if (!ledger) return
  await ledger.forget(slot, scope)
}

export async function recallRecovery(slot: RecoverySlot, scope: string): Promise<unknown | null> {
  const ledger = await recoveryLedger()
  if (!ledger) return null
  return ledger.get(slot, scope)
}

export async function recallLatest(slot: RecoverySlot): Promise<RecoveryHead | null> {
  const ledger = await recoveryLedger()
  if (!ledger) return null
  return ledger.latest(slot)
}

interface Scheduled {
  slot: RecoverySlot
  scope: string
  read: () => unknown
  timer: number
}

const scheduled = new Map<string, Scheduled>()

async function commitScheduled(key: string, item: Scheduled): Promise<void> {
  scheduled.delete(key)
  try {
    const payload = item.read()
    if (payload == null) await forgetRecovery(item.slot, item.scope)
    else await rememberRecovery(item.slot, item.scope, payload)
  } catch {
    /* 这一笔没记上，页面上的工作还在。 */
  }
}

/** 连续改动合成一笔。read 返回 null 表示这一轮已经清空，账本里也抹掉。 */
export function scheduleRecovery(slot: RecoverySlot, scope: string, read: () => unknown, wait = 400): void {
  const key = `${slot}\n${scope}`
  const previous = scheduled.get(key)
  if (previous) window.clearTimeout(previous.timer)
  const timer = window.setTimeout(() => { void commitScheduled(key, scheduled.get(key) ?? { slot, scope, read, timer }) }, wait)
  scheduled.set(key, { slot, scope, read, timer })
}

export async function flushRecovery(slot: RecoverySlot, scope: string, read: () => unknown): Promise<void> {
  const key = `${slot}\n${scope}`
  const previous = scheduled.get(key)
  if (previous) window.clearTimeout(previous.timer)
  await commitScheduled(key, { slot, scope, read, timer: 0 })
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const [key, item] of scheduled) {
      window.clearTimeout(item.timer)
      void commitScheduled(key, item)
    }
  })
}
