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
      url: 'https://example.test/forms?stage=1', title: '扫描验收页', hostname: 'example.test',
      inputs: [
        { tag: 'input', type: 'text', name: 'q', id: 'query', placeholder: '关键词', value: '当前值' },
        { tag: 'textarea', type: 'textarea', name: 'notes', id: '', placeholder: '', value: '说明' }
      ],
      selects: [{ tag: 'select', id: 'kind', value: 'b', options: ['类型 A', '类型 B'] }],
      buttons: [{ tag: 'button', type: 'submit', text: '查询 文件' }, { tag: 'input', type: 'reset', text: '清空' }]
    })
    expect(document.body.innerHTML).toBe(before)
    expect(document.querySelector('input')!.value).toBe('当前值')
  })

  it('includes image submit buttons and does not double count input buttons', () => {
    document.body.innerHTML = '<input type="image" alt="图片查询"><input type="button" value="操作">'
    const snapshot = scanPage()
    expect(snapshot.inputs).toHaveLength(0)
    expect(snapshot.buttons).toMatchObject([{ type: 'image', text: '图片查询' }, { type: 'button', text: '操作' }])
  })

  it('excludes the plugin UI and does not traverse nested shadow roots', () => {
    document.body.innerHTML = '<input name="page"><patmail-root></patmail-root><div id="widget"></div>'
    document.querySelector('patmail-root')!.attachShadow({ mode: 'open' }).innerHTML = '<button>扫描页面</button>'
    document.querySelector('#widget')!.attachShadow({ mode: 'open' }).innerHTML = '<input name="private">'
    expect(scanPage().inputs).toHaveLength(1)
    expect(scanPage().buttons).toHaveLength(0)
  })

  it('reads later DOM changes and keeps password values empty', () => {
    document.body.innerHTML = '<input type="password" value="secret"><input type="file">'
    expect(scanPage().inputs.map(input => input.value)).toEqual(['', ''])
    document.body.insertAdjacentHTML('beforeend', '<textarea>新内容</textarea>')
    expect(scanPage().inputs).toHaveLength(3)
  })

  it('does not silently omit options after the first 30', () => {
    const select = document.createElement('select')
    for (let i = 0; i < 35; i++) select.add(new Option(`选项 ${i}`, String(i)))
    document.body.append(select)
    expect(scanPage().selects[0].options).toHaveLength(35)
  })
})
