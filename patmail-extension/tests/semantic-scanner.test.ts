import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanPage } from '../src/content/scanner'

beforeEach(() => {
  document.title = '表单语义验收'
  document.body.innerHTML = ''
  // jsdom 没有排版；用正尺寸模拟真实浏览器已布局的普通控件。
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return this.isConnected
      ? { 0: { width: 60, height: 20 }, length: 1 } as unknown as DOMRectList
      : { length: 0 } as unknown as DOMRectList
  })
})
afterEach(() => vi.restoreAllMocks())

describe('PageSnapshot V2', () => {
  it('returns safe page metadata, iframe scope, counts and profiling', () => {
    history.replaceState({}, '', '/Forms/FileSearch.aspx?token=secret&tab=files#password=leak')
    document.body.innerHTML = `<input><textarea></textarea><select><option>甲</option></select><button>查询</button>
      <iframe src="/frame?authorization=abc"></iframe><iframe src="https://example.org/?token=abc"></iframe>`
    const snapshot = scanPage()
    expect(snapshot.version).toBe(2)
    expect(snapshot.page).toMatchObject({
      origin: 'https://example.test', hostname: 'example.test', pathname: '/Forms/FileSearch.aspx',
      search: '?token=%5BREDACTED%5D&tab=files', title: '表单语义验收', iframeDepth: 0,
      readyState: document.readyState
    })
    expect(snapshot.page.url).not.toContain('secret')
    expect(snapshot.page.url).not.toContain('password=leak')
    expect(snapshot.stats).toMatchObject({ totalControls: 4, inputs: 1, textareas: 1, selects: 1, buttons: 1 })
    expect(snapshot.iframes).toEqual([
      { src: '/frame?authorization=%5BREDACTED%5D', sameOrigin: true },
      { src: 'https://example.org/?token=%5BREDACTED%5D', sameOrigin: false }
    ])
    expect(Number.isFinite(snapshot.stats.durationMs)).toBe(true)
    expect(Number.isNaN(Date.parse(snapshot.scannedAt))).toBe(false)
  })

  it('resolves explicit for and nested labels before fallback attributes', () => {
    document.body.innerHTML = `<label for="case_volume">我方文号</label>
      <input id="case_volume" name="case_volume" aria-label="别名" title="标题" placeholder="占位">
      <label>客户名称 <input id="customer"></label>`
    const controls = scanPage().controls
    expect(controls[0]).toMatchObject({ label: '我方文号', semanticName: '我方文号', semanticConfidence: 1, semanticSource: 'label' })
    expect(controls[1]).toMatchObject({ label: '客户名称', semanticName: '客户名称', semanticConfidence: 1 })
  })

  it('uses aria, title, placeholder, nearby text, name and id in documented order', () => {
    document.body.innerHTML = `<input id="aria" aria-label="无障碍名称" title="标题" placeholder="占位">
      <input id="title" title="标题" placeholder="占位">
      <input id="placeholder" placeholder="占位">
      <div class="form-item"><span>我方文号</span><input id="nearby" name="legacy_name"></div>
      <input name="only_name"><input id="only_id">`
    const controls = scanPage().controls
    expect(controls.map(control => [control.semanticName, control.semanticConfidence, control.semanticSource])).toEqual([
      ['无障碍名称', 0.9, 'aria'],
      ['标题', 0.8, 'title'],
      ['占位', 0.7, 'placeholder'],
      ['我方文号', 0.6, 'nearby'],
      ['only_name', 0.4, 'name'],
      ['only_id', 0.3, 'id']
    ])
    expect(controls[3].label).toBe('我方文号')
  })

  it('resolves adjacent table cell text but does not traverse distant page text', () => {
    document.body.innerHTML = `<table><tr><td>客户名称</td><td><input id="customer"></td></tr></table>
      <div><span>${'长文本'.repeat(100)}</span><input id="plain"></div>`
    const controls = scanPage().controls
    expect(controls[0].label).toBe('客户名称')
    expect(controls[0].semanticName).toBe('客户名称')
    expect(controls[1].semanticName).toBe('plain')
  })

  it('preserves option state and native form flags without clicking', () => {
    document.body.innerHTML = `<select id="country" required multiple>
      <option value="CN" selected>中国</option><option value="US" disabled>美国</option></select>
      <input id="agree" type="checkbox" checked required>
      <input id="choice" type="radio" checked disabled>
      <input id="code" readonly value="ABC">`
    const controls = scanPage().controls
    expect(controls[0]).toMatchObject({ kind: 'select', required: true, multiple: true, selected: true, options: [
      { value: 'CN', text: '中国', selected: true, disabled: false },
      { value: 'US', text: '美国', selected: false, disabled: true }
    ] })
    expect(controls[1]).toMatchObject({ kind: 'input', inputType: 'checkbox', checked: true, required: true })
    expect(controls[2]).toMatchObject({ checked: true, disabled: true })
    expect(controls[3]).toMatchObject({ readonly: true, value: 'ABC' })
  })

  it('reports visible, hidden and disabled using ancestor CSS and geometry', () => {
    document.body.innerHTML = `<input id="shown"><input id="hidden-attr" hidden>
      <div style="display:none"><input id="hidden-parent"></div>
      <input id="hidden-opacity" style="opacity:0">
      <input id="hidden-visibility" style="visibility:hidden">
      <input id="disabled" disabled><input id="no-rect">`
    Object.defineProperty(document.querySelector('#no-rect')!, 'getClientRects', {
      configurable: true, value: () => ({ length: 0 }) as unknown as DOMRectList
    })
    const snapshot = scanPage()
    expect(snapshot.controls.map(control => control.visible)).toEqual([true, false, false, false, false, true, false])
    expect(snapshot.stats).toMatchObject({ visible: 2, hidden: 5, disabled: 1 })
  })

  it('redacts password, file, hidden token and sensitive aria/data attributes', () => {
    document.body.innerHTML = `<input type="password" id="pw" value="secret" data-password="one" aria-secret="two">
      <input type="file" id="file" data-token="three">
      <input type="hidden" id="csrf_token" value="four">
      <input id="normal" value="safe" data-customer-id="42" aria-label="客户" data-authorization="five">
      <button name="session_token" value="six">提交</button>`
    const controls = scanPage().controls
    for (const control of controls.slice(0, 3)) {
      expect(JSON.stringify(control)).not.toMatch(/"(secret|one|two|three|four)"/)
      expect(control.value).toBe('[REDACTED]')
    }
    expect(controls[0].attributes['data-password']).toBe('[REDACTED]')
    expect(controls[1].dataset.token).toBe('[REDACTED]')
    expect(controls[3].dataset.customerId).toBe('42')
    expect(controls[3].attributes['data-authorization']).toBe('[REDACTED]')
    expect(controls[3].value).toBe('safe')
    expect(controls[4].value).toBe('[REDACTED]')
    expect(controls[4].displayValue).toBe('[REDACTED]')
    expect(JSON.stringify(controls[4])).not.toContain('six')
  })

  it('excludes the plugin ShadowRoot and resamples changed controls', () => {
    document.body.innerHTML = '<input id="first"><patmail-root id="patmail-extension-root"></patmail-root>'
    document.querySelector('patmail-root')!.attachShadow({ mode: 'open' }).innerHTML = '<input id="plugin"><button>扫描</button>'
    expect(scanPage().stats.totalControls).toBe(1)
    document.body.insertAdjacentHTML('beforeend', '<button id="later">后来</button>')
    const snapshot = scanPage()
    expect(snapshot.stats.totalControls).toBe(2)
    expect(snapshot.controls.map(control => control.id)).toEqual(['first', 'later'])
    expect(new Set(snapshot.controls.map(control => control.key)).size).toBe(2)
  })
})
