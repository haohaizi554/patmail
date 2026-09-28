import { describe, expect, it } from 'vitest'
import { contactSpec, formatMailContactText, loadMailContactText, mailContactParams, readMailContactGroup } from '../src/mail/easy/mail-contacts'
import type { ApiResult } from '../src/api/types'
import type { MailContactOperation } from '../src/mail/easy/mail-contacts'

const mailId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function ok(data: unknown): ApiResult<unknown> {
  return { ok: true, data }
}

describe('发文页联系人', () => {
  it('最近联系人没有业务条件，其余分组带发文编号', () => {
    const recent = mailContactParams(contactSpec('recent'), { mailId: '', customerId: '' })
    expect(recent?.get('Call')).toBe('GetRecentContact')
    expect(recent?.get('mail_id')).toBeNull()
    expect(recent?.get('log_pagename')).toBe('mail.aspx')
    const pics = mailContactParams(contactSpec('pics'), { mailId, customerId })
    expect(pics?.get('Call')).toBe('GetPicsContact')
    expect(pics?.get('mail_id')).toBe(mailId)
    expect(pics?.has('customer_id')).toBe(false)
    const customer = mailContactParams(contactSpec('customer'), { mailId, customerId })
    expect(customer?.get('customer_id')).toBe(customerId)
    expect(mailContactParams(contactSpec('case'), { mailId: '', customerId })).toBeNull()
  })

  it('按分组保留姓名、角色和邮箱，空数组才是没有人', () => {
    const customer = readMailContactGroup({
      ClientInfo: { IsLogin: true },
      CustomerContact: [{ contact_name: '姜颖', email: 'liy02@pcl.ac.cn', contact_type_zh_cn: '第一发明人（技术联系人）' }],
      Introducer: { introducer: '外部介绍', introducer_email: 'out@example.com', inside_introducer: '', inside_introducer_email: '' }
    }, contactSpec('customer'))
    expect(customer.state).toBe('known')
    if (customer.state !== 'known') return
    expect(customer.rows[0]).toMatchObject({ name: '姜颖', email: 'liy02@pcl.ac.cn', role: '第一发明人（技术联系人）' })
    expect(customer.introducer?.name).toBe('外部介绍')
    expect(formatMailContactText(customer.rows, customer.introducer)).toContain('姜颖 <liy02@pcl.ac.cn>（第一发明人（技术联系人））')
    expect(readMailContactGroup({ ClientInfo: { IsLogin: true }, CaseAgentContact: null }, contactSpec('agent')).state).toBe('known')
    expect(readMailContactGroup({ ClientInfo: { IsLogin: true } }, contactSpec('pics')).state).toBe('unknown')
  })

  it('没有发文编号时只读最近联系人，缺一组时保留已经读到的邮箱', async () => {
    const calls: MailContactOperation[] = []
    const recentOnly = await loadMailContactText({ mailId: '', customerId: '' }, async operation => {
      calls.push(operation)
      return ok({ ClientInfo: { IsLogin: true }, RecentContact: [{ cn_name: '王金山', email: 'wang@example.com' }] })
    })
    expect(calls).toEqual(['getRecentContact'])
    expect(recentOnly.ok && recentOnly.data.complete).toBe(false)
    expect(recentOnly.ok && recentOnly.data.text).toContain('王金山 <wang@example.com>')

    const partial = await loadMailContactText({ mailId, customerId }, async operation => {
      if (operation === 'getPicsContact') return ok({ ClientInfo: { IsLogin: true } })
      if (operation === 'getCustomerContact') {
        return ok({ ClientInfo: { IsLogin: true }, CustomerContact: [{ contact_name: '张三', email: 'a@example.com', contact_type_zh_cn: 'IP联系人' }] })
      }
      if (operation === 'getCaseAgentContact') return ok({ ClientInfo: { IsLogin: true }, CaseAgentContact: null })
      const key = operation === 'getRecentContact' ? 'RecentContact' : operation === 'getCaseContact' ? 'CaseContact' : 'SalesContact'
      return ok({ ClientInfo: { IsLogin: true }, [key]: [] })
    })
    expect(partial.ok).toBe(true)
    if (!partial.ok) return
    expect(partial.data.complete).toBe(false)
    expect(partial.data.text).toContain('张三 <a@example.com>（IP联系人）')
    expect(partial.data.message).toContain('IP联系人')
  })
})
