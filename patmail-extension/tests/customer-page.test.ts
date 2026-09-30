import { describe, expect, it } from 'vitest'
import { customerDemandParams, customerDirectoryParams, fillSheetEmails, formatCustomerDemandText, loadCustomerDemands, readCustomerDemandPage, readCustomerDirectoryPage } from '../src/customer/customer-page'
import { inventorCustomers } from '../src/customer/pct-recipients'
import type { PctTaskRow } from '../src/customer/types'
import type { ApiResult } from '../src/api/types'

const customerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function client(rows: unknown, count = '1'): Record<string, unknown> {
  return { ClientInfo: { IsLogin: true, Status: true, Result: true }, TableRows: rows, TableRowsCount: count }
}

function row(): PctTaskRow {
  return {
    ourVolume: 'PA2518728CND',
    customerVolume: 'CS-1',
    customerName: '鹏城国家实验室',
    contactName: '姜颖',
    iprName: '雷群安',
    procLabel: '提醒申请PCT',
    mailTypeLabel: '提醒申请PCT（贵方案号）-深圳市',
    mailTypeId: customerId,
    mailTypeRadioIndex: 1
  }
}

describe('客户资料页', () => {
  it('按客户页抓包组装要求表和联系人请求', () => {
    const demand = customerDemandParams(customerId, 1)
    expect(demand?.get('Call')).toBe('GetCustomerDemand')
    expect(demand?.get('customer_id')).toBe(customerId)
    expect(demand?.get('_PK')).toBe('demand_id')
    expect(demand?.get('log_pagename')).toBe('Addcustomer.aspx')
    expect(demand?.get('colsel')).toContain('demand_desc')
    const contacts = customerDirectoryParams(customerId, 2)
    expect(contacts?.get('Call')).toBe('GetCustomerContact')
    expect(contacts?.get('pageIndex')).toBe('2')
    expect(contacts?.get('order_by')).toBe('')
    expect(contacts?.get('colsel')).toContain('email')
    expect(customerDemandParams('不是编号', 1)).toBeNull()
  })

  it('解码描述里的 HTML，列表对不上时不当成没有要求', () => {
    const parsed = readCustomerDemandPage(client([{
      demand_id: customerId,
      case_type: '专利',
      demand_type: '答复要求',
      demand_name: '尽量不要超过5页',
      demand_desc: '先联系客户。&lt;br&gt;不要直接提交。',
      file_name: '说明.docx',
      is_disabled: '1'
    }]))
    expect(parsed.state).toBe('known')
    if (parsed.state !== 'known') return
    expect(parsed.rows[0]?.description).toBe('先联系客户。<br>不要直接提交。')
    expect(parsed.rows[0]?.disabled).toBe(true)
    expect(formatCustomerDemandText(parsed.rows)).toContain('附件：说明.docx')
    expect(formatCustomerDemandText(parsed.rows)).toContain('状态：已停用')
    expect(readCustomerDemandPage({ ClientInfo: { IsLogin: true }, TableRows: null }).state).toBe('unknown')
  })

  it('联系人只留姓名和邮箱，多个邮箱不替表格选一个', () => {
    const parsed = readCustomerDirectoryPage(client([
      { contact_id: customerId, contact_name: '姜颖', email: 'jiang@example.com', contact_type: '技术联系人', tel: '13800000000', contact_address_cn: '深圳' },
      { contact_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', contact_name: '雷群安', email: 'lei-a@example.com', contact_type: 'IPR' },
      { contact_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', contact_name: '雷群安', email: 'lei-b@example.com', contact_type: 'IPR' }
    ]))
    expect(parsed.state).toBe('known')
    if (parsed.state !== 'known') return
    expect(parsed.rows[0]).toEqual({ contactId: customerId, name: '姜颖', email: 'jiang@example.com', contactType: '技术联系人' })
    expect(JSON.stringify(parsed.rows)).not.toContain('13800000000')
    const filled = fillSheetEmails([row()], parsed.rows, inventorCustomers(row().customerName))
    expect(filled.rows[0]?.mailTo).toBe('姜颖(jiang@example.com);')
    expect(filled.rows[0]?.mailCc).toBeUndefined()
    expect(filled.notes.join('')).toContain('多个邮箱')
  })

  it('第一页对不上时不返回空文本', async () => {
    const missing = await loadCustomerDemands(customerId, async () => ({ ok: true, data: { ClientInfo: { IsLogin: true } } }))
    expect(missing.ok).toBe(false)
    let page = 0
    const partial = await loadCustomerDemands(customerId, async (): Promise<ApiResult<unknown>> => {
      page += 1
      if (page === 1) {
        return { ok: true, data: client(Array.from({ length: 10 }, () => ({ demand_type: '其它要求', demand_name: '标题', demand_desc: '原文。' })), '12') }
      }
      return { ok: false, error: { code: 'HTTP_ERROR', message: '后面没有返回。' } }
    })
    expect(partial.ok).toBe(true)
    if (!partial.ok) return
    expect(partial.data.complete).toBe(false)
    expect(partial.data.rows).toHaveLength(10)
    expect(partial.data.text).toContain('原文。')
  })
})
