import { describe, expect, it } from 'vitest'
import { departmentIncludesRnd, insertInventorColumn, inventorNames } from '../src/customer/mail-inventor-column'

const table = [
  '<table>',
  '<tr><td>我方案号</td><td style="background:#C6E2F3">文件描述</td><td>代理人</td></tr>',
  '<tr><td>PA1</td><td style="text-align:center">通知书</td><td>甲</td></tr>',
  '<tr><td>PA2</td><td style="text-align:center">证书</td><td>乙</td></tr>',
  '</table>'
].join('')

describe('研发本部发明人列', () => {
  it('按序号用顿号拼全部姓名', () => {
    expect(inventorNames([
      { name: '吴峰', seq: 4 },
      { name: ' 陈翔 ', seq: 1 },
      { name: '', seq: 2 },
      { name: '陈翔', seq: 3 }
    ])).toBe('陈翔、吴峰')
    expect(departmentIncludesRnd('广州研发本部一组')).toBe(true)
    expect(departmentIncludesRnd('销售部')).toBe(false)
  })

  it('在文件描述右侧插入一列，并按我方案号填入', () => {
    const html = insertInventorColumn(table, new Map([['PA1', '陈翔、裴镭']]))
    expect(html).toContain('<td style="background:#C6E2F3">发明人</td><td>代理人</td>')
    expect(html).toContain('<td style="text-align:center">陈翔、裴镭</td><td>甲</td>')
    expect(html).toContain('<td style="text-align:center"></td><td>乙</td>')
    expect(html.match(/发明人/g)).toHaveLength(1)
  })

  it('已经有发明人列时只填内容，不另加一列', () => {
    const existing = table.replace('文件描述</td><td>代理人', '文件描述</td><td style="background:#C6E2F3">发明人</td><td>代理人')
      .replace('通知书</td><td>甲', '通知书</td><td></td><td>甲')
      .replace('证书</td><td>乙', '证书</td><td></td><td>乙')
    const html = insertInventorColumn(existing, new Map([['PA2', '艾桥']]))
    expect(html.match(/发明人/g)).toHaveLength(1)
    expect(html).toContain('<td>艾桥</td>')
    expect(html).not.toContain('陈翔')
  })

  it('没有我方案号时不改模板', () => {
    const bare = '<table><tr><td>文件描述</td></tr><tr><td>通知书</td></tr></table>'
    expect(insertInventorColumn(bare, new Map([['PA1', '陈翔']]))).toBe(bare)
  })
})
