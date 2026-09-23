import { describe, expect, it } from 'vitest'
import { isContentRequest, isMessage } from '../src/shared/message'

describe('message validation', () => {
  it.each([null, 1, {}, { type: 'OTHER' }, { type: 'SCAN_RESULT' },
    { type: 'SCAN_RESULT', payload: { url: '', title: '', hostname: '', inputs: [null], selects: [], buttons: [] } },
    { type: 'PAGE_INFO', payload: { url: 42, title: '', hostname: '' } },
    { type: 'PONG', payload: { ok: false } }
  ])('rejects malformed messages: %j', value => expect(isMessage(value)).toBe(false))

  it('accepts the documented scan request and complete empty snapshot', () => {
    expect(isMessage({ type: 'SCAN_PAGE' })).toBe(true)
    expect(isMessage({ type: 'SCAN_RESULT', payload: {
      url: 'https://example.test', title: '', hostname: 'example.test', inputs: [], selects: [], buttons: []
    } })).toBe(true)
  })

  it('does not treat response messages as requests to echo', () => {
    expect(isContentRequest({ type: 'PONG', payload: { ok: true } })).toBe(false)
    expect(isContentRequest({ type: 'PAGE_INFO', payload: { url: '', title: '', hostname: '' } })).toBe(false)
    expect(isContentRequest({ type: 'SHOW_PANEL' })).toBe(true)
  })

  it('rejects invalid select options and button records inside a snapshot', () => {
    const base = { url: '', title: '', hostname: '', inputs: [], selects: [], buttons: [] }
    expect(isMessage({ type: 'SCAN_RESULT', payload: {
      ...base, selects: [{ tag: 'select', name: '', id: '', value: '', options: [123] }]
    } })).toBe(false)
    expect(isMessage({ type: 'SCAN_RESULT', payload: {
      ...base, buttons: [{ tag: 'button', name: '', id: '', type: 'submit' }]
    } })).toBe(false)
  })
})
