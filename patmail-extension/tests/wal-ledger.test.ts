import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { memoryRecoveryStore, openRecoveryLedger, useRecoveryWasm, type StoredFrame } from '../src/recovery/wal-ledger'

const wasmFile = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
useRecoveryWasm(wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength))

describe('SQLite WAL 恢复账本', () => {
  it('以 WAL 记下工作面，重新打开还能读到', async () => {
    const store = memoryRecoveryStore()
    const ledger = await openRecoveryLedger(store)
    expect(ledger.journalMode).toBe('wal')
    await ledger.put('workflow-desk', 'user-1', { rows: ['PA1'], phase: 'run' })
    await ledger.put('limit-query', 'page', { total: 2 })
    const again = await openRecoveryLedger(store)
    expect(await again.get('workflow-desk', 'user-1')).toEqual({ rows: ['PA1'], phase: 'run' })
    expect(await again.get('limit-query', 'page')).toEqual({ total: 2 })
    expect(await again.get('workflow-desk', 'user-2')).toBeNull()
  })

  it('库文件还没写完时，下一回按 WAL 里的那一笔补上', async () => {
    const store = memoryRecoveryStore()
    const ledger = await openRecoveryLedger(store)
    await ledger.put('limit-mail', 'local', [{ procId: 'a', state: 'created' }])
    const checkpoint = await store.readCheckpoint()
    const crashed = memoryRecoveryStore()
    if (checkpoint) await crashed.writeCheckpoint(checkpoint)
    const frame: StoredFrame = {
      seq: 2,
      slot: 'limit-mail',
      scope: 'local',
      payload: JSON.stringify([{ procId: 'a', state: 'unknown' }]),
      at: '2026-10-13T10:00:00.000Z'
    }
    await crashed.appendFrame(frame)
    const restored = await openRecoveryLedger(crashed)
    expect(await restored.get('limit-mail', 'local')).toEqual([{ procId: 'a', state: 'unknown' }])
    expect(await crashed.readFrames()).toEqual([])
  })

  it('抹掉的槽位不会被更早的一笔补回来，也不收登录凭据', async () => {
    const store = memoryRecoveryStore()
    const ledger = await openRecoveryLedger(store)
    await ledger.put('file-desk', 'local', { letters: 1 })
    await ledger.forget('file-desk', 'local')
    expect(await ledger.get('file-desk', 'local')).toBeNull()
    expect(await ledger.latest('file-desk')).toBeNull()
    await expect(ledger.put('workflow-desk', 'local', { cookie: 'secret' })).rejects.toThrow('登录凭据')
  })
})
