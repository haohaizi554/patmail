import { describe, expect, it } from 'vitest'
import { appendRecipientField } from '../src/mail/easy/contracts'
import { planPctRecipients, currentMailId, sheetRowsOnMail, sheetRecipientNames, sheetDisplayName, inventorCustomers } from '../src/customer/pct-recipients'
import type { PctTaskRow } from '../src/customer/types'
import type { MailContactRow } from '../src/mail/easy/mail-contacts'

function row(partial: Partial<PctTaskRow>): PctTaskRow {
  return {
    ourVolume: 'P1', customerVolume: 'C1', customerName: '鹏城实验室',
    contactName: '姜颖', iprName: '雷群安', procLabel: '提醒申请PCT', mailTypeLabel: '提醒',
    ...partial
  }
}

function contact(partial: Partial<MailContactRow>): MailContactRow {
  return { group: 'customer', name: '姜颖', email: 'liy02@pcl.ac.cn', role: '第一发明人（技术联系人）', ...partial }
}

describe('PCT 联系人追加', () => {
  it('用户写下的客户：第一发明人进收件人，IPR 进抄送，业务人员不进', () => {
    const specials = inventorCustomers('特例客户')
    const plan = planPctRecipients(
      [row({ customerName: '特例客户' })],
      [
        contact({}),
        contact({ group: 'sales', name: '林淑敏', email: 'linsm@centips.com', role: '' }),
        contact({ group: 'pics', name: '雷群安', email: 'leiqa@pcl.ac.cn', role: 'IP联系人' })
      ],
      { to: '已有(old@example.com);', cc: '抄送已有(cc@example.com);' },
      specials
    )
    expect(plan.to).toBe('已有(old@example.com);姜颖(liy02@pcl.ac.cn);')
    expect(plan.cc).toBe('抄送已有(cc@example.com);雷群安(leiqa@pcl.ac.cn);')
    expect(plan.notes).toEqual([])
    expect(sheetRecipientNames(row({ customerName: '特例客户' }), specials)).toEqual({ to: '姜颖', cc: '雷群安' })
    expect(sheetRecipientNames(row({ customerName: '鹏城国家实验室' }), specials)).toEqual({ to: '雷群安', cc: '' })
  })

  it('其他客户：IPR 进收件人，业务人员进抄送', () => {
    const plan = planPctRecipients(
      [row({ customerName: '甲客户' })],
      [
        contact({}),
        contact({ group: 'sales', name: '林淑敏', email: 'linsm@centips.com', role: '' }),
        contact({ group: 'pics', name: '雷群安', email: 'leiqa@pcl.ac.cn', role: 'IP联系人' })
      ],
      { to: '', cc: '' }
    )
    expect(plan.to).toBe('雷群安(leiqa@pcl.ac.cn);')
    expect(plan.cc).toBe('林淑敏(linsm@centips.com);')
    expect(plan.to).not.toContain('姜颖')
    expect(sheetRecipientNames(row({ customerName: '甲客户' }))).toEqual({ to: '雷群安', cc: '' })
  })

  it('同一封里两套收件规则时不改地址', () => {
    const plan = planPctRecipients(
      [row({ customerName: '特例客户' }), row({ customerName: '甲客户', ourVolume: 'P2' })],
      [contact({})],
      { to: '已有(old@example.com);', cc: '' },
      inventorCustomers('特例客户')
    )
    expect(plan.to).toBe('已有(old@example.com);')
    expect(plan.cc).toBe('')
    expect(plan.notes[0]).toContain('不是同一套收件规则')
  })

  it('同一邮箱再追加一次不会重复，角色不对的同名人不进收件人', () => {
    const contacts = [
      contact({ role: '品川-IP联系人' }),
      contact({ group: 'sales', name: '林淑敏', email: 'linsm@centips.com', role: '' })
    ]
    const specials = inventorCustomers('特例客户')
    const first = planPctRecipients([row({ customerName: '特例客户' })], contacts, { to: '姜颖(liy02@pcl.ac.cn);', cc: '' }, specials)
    const second = planPctRecipients([row({ customerName: '特例客户' })], contacts, { to: first.to, cc: first.cc }, specials)
    expect(first.to).toBe('姜颖(liy02@pcl.ac.cn);')
    expect(first.notes.some(note => note.includes('没有追加到收件人'))).toBe(true)
    expect(second.to).toBe(first.to)
    expect(second.cc).toBe(first.cc)
  })

  it('当前发文页的编号，以及文号对上的那一行', () => {
    const mail = '11111111-1111-4111-8111-111111111111'
    expect(currentMailId(`http://183.36.43.66:88/Forms/mail/mail.aspx?objid=${mail}&guid=${mail}`)).toBe(mail)
    expect(currentMailId('http://183.36.43.66:88/index.aspx')).toBeNull()
    const rows = [row({ ourVolume: 'P1' }), row({ ourVolume: 'P2', contactName: '别人' })]
    expect(sheetRowsOnMail(rows, ['P1']).map(item => item.ourVolume)).toEqual(['P1'])
    expect(sheetRowsOnMail(rows, ['其他'])).toEqual([])
  })

  it('鹏城专案：技术负责人去掉拼音后进收件人，IPR 和商务进抄送', () => {
    expect(sheetDisplayName('洪仕瀚(hongshh)')).toBe('洪仕瀚')
    expect(sheetDisplayName('魏金龙（weijl01）')).toBe('魏金龙')
    const plan = planPctRecipients(
      [row({ leadName: '洪仕瀚', iprName: '高宇' })],
      [
        contact({ name: '洪仕瀚(hongshh)', email: 'lead@example.com', role: '技术负责人' }),
        contact({ group: 'pics', name: '高宇', email: 'gaoy@example.com', role: 'IP联系人' }),
        contact({ group: 'sales', name: '商务甲', email: 'sales@example.com', role: '' })
      ],
      { to: '', cc: '' },
      new Set(),
      'lead'
    )
    expect(plan.to).toBe('洪仕瀚(lead@example.com);')
    expect(plan.cc).toContain('高宇(gaoy@example.com);')
    expect(plan.cc).toContain('商务甲(sales@example.com);')
    expect(sheetRecipientNames(row({ leadName: '洪仕瀚(hongshh)', iprName: '高宇' }), new Set(), 'lead')).toEqual({ to: '洪仕瀚', cc: '高宇' })
  })

  it('尖括号和裸邮箱都能接在已有地址后面', () => {
    expect(appendRecipientField('已有 <old@example.com>', '张三(a@example.com);')).toBe('已有(old@example.com);张三(a@example.com);')
    expect(appendRecipientField('', 'a@example.com;')).toBe('a@example.com;')
  })
})
