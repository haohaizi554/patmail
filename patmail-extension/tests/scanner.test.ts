import { beforeEach, describe, expect, it } from 'vitest'
import { scanPage } from '../src/content/scanner'

beforeEach(() => {
  document.title = '扫描验收页'
  document.body.innerHTML = ''
})

describe('DOM scanner', () => {
  it('reads live controls without changing or submitting the page', () => {
    document.body.innerHTML = `<form>
      <input id="query" name="q" placeholder="关键词" value="旧值">
      <textarea name="notes">说明</textarea>
      <select id="kind"><option value="a">类型 A</option><option value="b" selected>类型 B</option></select>
      <button type="submit">查询 <span>文件</span></button>
      <input type="reset" value="清空">
    </form>`
    document.querySelector('input')!.value = '当前值'
    const before = document.body.innerHTML
    const snapshot = scanPage()
    expect(snapshot).toMatchObject({
      version: 2,
      page: { url: 'https://example.test/forms?stage=1', title: '扫描验收页', hostname: 'example.test' },
      controls: [
        { tagName: 'input', kind: 'input', inputType: 'text', name: 'q', id: 'query', placeholder: '关键词', value: '当前值' },
        { tagName: 'textarea', kind: 'textarea', name: 'notes', value: '说明' },
        { tagName: 'select', kind: 'select', id: 'kind', value: 'b', options: [
          { value: 'a', text: '类型 A', selected: false },
          { value: 'b', text: '类型 B', selected: true }
        ] },
        { tagName: 'button', kind: 'button', displayValue: '查询 文件' },
        { tagName: 'input', kind: 'input', inputType: 'reset', displayValue: '清空' }
      ],
      stats: { totalControls: 5, inputs: 1, textareas: 1, selects: 1, buttons: 2 }
    })
    expect(document.body.innerHTML).toBe(before)
    expect(document.querySelector('input')!.value).toBe('当前值')
  })

  it('includes image submit buttons and does not double count input buttons', () => {
    document.body.innerHTML = '<input type="image" alt="图片查询"><input type="button" value="操作">'
    const snapshot = scanPage()
    expect(snapshot.stats).toMatchObject({ inputs: 0, buttons: 2 })
    expect(snapshot.controls).toMatchObject([
      { inputType: 'image', displayValue: '图片查询' },
      { inputType: 'button', displayValue: '操作' }
    ])
  })

  it('excludes the plugin UI and does not traverse nested shadow roots', () => {
    document.body.innerHTML = '<input name="page"><patmail-root></patmail-root><div id="widget"></div>'
    document.querySelector('patmail-root')!.attachShadow({ mode: 'open' }).innerHTML = '<button>扫描页面</button>'
    document.querySelector('#widget')!.attachShadow({ mode: 'open' }).innerHTML = '<input name="private">'
    expect(scanPage().stats).toMatchObject({ totalControls: 1, inputs: 1, buttons: 0 })
  })

  it('reads later DOM changes and redacts password and file values', () => {
    document.body.innerHTML = '<input type="password" value="secret"><input type="file">'
    expect(scanPage().controls.map(input => input.value)).toEqual(['[REDACTED]', '[REDACTED]'])
    document.body.insertAdjacentHTML('beforeend', '<textarea>新内容</textarea>')
    expect(scanPage().stats.totalControls).toBe(3)
  })

  it('does not silently omit options after the first 30', () => {
    const select = document.createElement('select')
    for (let i = 0; i < 35; i++) select.add(new Option(`选项 ${i}`, String(i)))
    document.body.append(select)
    expect(scanPage().controls[0].options).toHaveLength(35)
  })
})
