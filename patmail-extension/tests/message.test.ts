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
})
