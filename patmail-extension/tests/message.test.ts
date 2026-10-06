import { describe, expect, it } from 'vitest'
import { isContentRequest, isMessage } from '../src/shared/message'

describe('message validation', () => {
  it.each([null, 1, {}, { type: 'OTHER' }, { type: 'SCAN_RESULT' },
    { type: 'SCAN_RESULT', payload: { url: '', title: '', hostname: '', inputs: [null], selects: [], buttons: [] } },
    { type: 'PAGE_INFO', payload: { url: 42, title: '', hostname: '' } },
    { type: 'PONG', payload: { ok: false } }
  ])('rejects malformed messages: %j', value => expect(isMessage(value)).toBe(false))

  it('accepts the documented scan request and complete V2 snapshot', () => {
    expect(isMessage({ type: 'SCAN_PAGE' })).toBe(true)
    expect(isMessage({ type: 'SCAN_RESULT', payload: {
      version: 2,
      page: { url: 'https://example.test/', origin: 'https://example.test', hostname: 'example.test',
        pathname: '/', search: '', title: '', iframeDepth: 0, readyState: 'complete' },
      controls: [], stats: { totalControls: 0, inputs: 0, textareas: 0, selects: 0, buttons: 0,
        visible: 0, hidden: 0, disabled: 0, semanticResolved: 0, durationMs: 1 },
      iframes: [], scannedAt: '2026-09-24T00:00:00.000Z'
    } })).toBe(true)
  })

  it('does not treat response messages as requests to echo', () => {
    expect(isContentRequest({ type: 'PONG', payload: { ok: true } })).toBe(false)
    expect(isContentRequest({ type: 'PAGE_INFO', payload: { url: '', title: '', hostname: '' } })).toBe(false)
    expect(isContentRequest({ type: 'SHOW_PANEL' })).toBe(true)
  })

  it('rejects invalid controls and inconsistent statistics inside a V2 snapshot', () => {
    const base = {
      version: 2, page: { url: '', origin: '', hostname: '', pathname: '', search: '', title: '', iframeDepth: 0, readyState: 'complete' },
      controls: [], stats: { totalControls: 0, inputs: 0, textareas: 0, selects: 0, buttons: 0,
        visible: 0, hidden: 0, disabled: 0, semanticResolved: 0, durationMs: 1 },
      iframes: [], scannedAt: '2026-09-24T00:00:00.000Z'
    }
    expect(isMessage({ type: 'SCAN_RESULT', payload: {
      ...base, controls: [null]
    } })).toBe(false)
    expect(isMessage({ type: 'SCAN_RESULT', payload: {
      ...base, stats: { ...base.stats, totalControls: 1 }
    } })).toBe(false)
  })

  it('accepts only typed session and file-search requests', () => {
    expect(isContentRequest({ type: 'CHECK_SESSION' })).toBe(true)
    expect(isContentRequest({ type: 'CANCEL_SESSION_CHECK' })).toBe(true)
    expect(isContentRequest({ type: 'CANCEL_FILE_SEARCH' })).toBe(true)
    expect(isContentRequest({ type: 'SEARCH_FILES', payload: { query: {
      caseVolume: 'A-123', pageIndex: 1, pageSize: 20
    } } })).toBe(true)
    expect(isContentRequest({ type: 'SEARCH_FILES', payload: { query: {
      caseVolume: 'A-123', pageIndex: '1', pageSize: 20
    } } })).toBe(false)
    expect(isContentRequest({ type: 'SEARCH_FILES', payload: { query: {
      caseVolume: 'A-123', pageIndex: 1, pageSize: 20, rawUrl: 'https://evil.test/'
    } } })).toBe(false)
    expect(isContentRequest({ type: 'API_REQUEST', payload: { url: 'https://evil.test/' } })).toBe(false)
  })

  it('validates normalized API responses without accepting raw server records', () => {
    expect(isMessage({ type: 'SESSION_RESULT', payload: { ok: true, data: {
      status: 'authenticated', checkedAt: '2026-09-24T00:00:00.000Z'
    } } })).toBe(true)
    expect(isMessage({ type: 'SEARCH_FILES_RESULT', payload: { ok: true, data: {
      items: [{ fileId: 'f1', fileName: '通知书.pdf' }], total: 1,
      pageIndex: 1, pageSize: 20, totalPages: 1
    } } })).toBe(true)
    expect(isMessage({ type: 'SEARCH_FILES_RESULT', payload: { ok: false, error: {
      code: 'SESSION_EXPIRED', message: '登录失效'
    } } })).toBe(true)
    expect(isMessage({ type: 'SEARCH_FILES_RESULT', payload: { ok: true, data: {
      TableRows: [{ file_id: 'f1' }]
    } } })).toBe(false)
    expect(isMessage({ type: 'SESSION_RESULT', payload: { ok: false, error: {
      code: 'UNKNOWN_CODE', message: 'bad'
    } } })).toBe(false)
  })

  it('accepts a named new chat and a rename, and rejects a blank title', () => {
    expect(isMessage({ type: 'AGENT_CHAT', payload: { action: 'create', title: '周报核对' } })).toBe(true)
    expect(isMessage({ type: 'AGENT_CHAT', payload: { action: 'rename', id: 'session-1', title: '客户甲' } })).toBe(true)
    expect(isMessage({ type: 'AGENT_CHAT', payload: { action: 'create', title: '   ' } })).toBe(false)
    expect(isMessage({ type: 'AGENT_CHAT', payload: { action: 'rename', id: 'short', title: '客户甲' } })).toBe(false)
  })
})
