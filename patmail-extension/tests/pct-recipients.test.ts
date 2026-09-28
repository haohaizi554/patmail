import { describe, expect, it } from 'vitest'
import { appendRecipientField } from '../src/mail/easy/contracts'
import { planPctRecipients, currentMailId, sheetRowsOnMail } from '../src/customer/pct-recipients'
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
  it('预填留在前面，第一发明人进收件人，商务和 IPR 进抄送', () => {
    const plan = planPctRecipients(
      [row({})],
      [
        contact({}),
        contact({ group: 'sales', name: '林淑敏', email: 'linsm@centips.com', role: '' }),
        contact({ group: 'pics', name: '雷群安', email: 'leiqa@pcl.ac.cn', role: 'IP联系人' })
      ],
      { to: '已有(old@example.com);', cc: '抄送已有(cc@example.com);' }
    )
    expect(plan.to).toBe('已有(old@example.com);姜颖(liy02@pcl.ac.cn);')
    expect(plan.cc).toBe('抄送已有(cc@example.com);林淑敏(linsm@centips.com);雷群安(leiqa@pcl.ac.cn);')
    expect(plan.notes).toEqual([])
  })

  it('同一邮箱再追加一次不会重复，角色不对的同名人不进收件人', () => {
    const contacts = [
      contact({ role: '品川-IP联系人' }),
      contact({ group: 'sales', name: '林淑敏', email: 'linsm@centips.com', role: '' })
    ]
    const first = planPctRecipients([row({})], contacts, { to: '姜颖(liy02@pcl.ac.cn);', cc: '' })
    const second = planPctRecipients([row({})], contacts, { to: first.to, cc: first.cc })
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

  it('尖括号和裸邮箱都能接在已有地址后面', () => {
    expect(appendRecipientField('已有 <old@example.com>', '张三(a@example.com);')).toBe('已有(old@example.com);张三(a@example.com);')
    expect(appendRecipientField('', 'a@example.com;')).toBe('a@example.com;')
  })
})
