import { describe, expect, it } from 'vitest'
import { buildMailProcessParams, normalizeMailProcess } from '../src/api/mail-process'
import { assembleMail, fillFromRules } from '../src/mail/assemble'
import { emptyMailRules } from '../src/mail/repository'
import type { CustomerQueryProfile } from '../src/customer/types'
import type { SelectedPatentFile } from '../src/mail/types'

const query = { searchKey: '', pageIndex: 1, pageSize: 10 }
const client = { IsLogin: true, Status: true, Result: false, Message: '' }

describe('发文流程列表', () => {
  it('空搜索也按原站参数提交', () => {
    const params = buildMailProcessParams(query)
    expect(params.ok).toBe(true)
    if (!params.ok) return
    expect(params.data.get('Call')).toBe('GetProcessByTypeCO')
    expect(params.data.get('searchKey')).toBe('')
    expect(params.data.get('log_pagename')).toBe('ProcessNew.aspx')
    expect(params.data.get('colsel')).toContain('mail_subject')
  })

  it('Result 为 false 时仍读取列表，并只接受 GUID 邮件编号', () => {
    const parsed = normalizeMailProcess({
      ClientInfo: client,
      TableRowsCount: '2',
      TableRows: [
        { obj_id: '083aa041-008c-4114-8b7f-26df4c612a7f', mail_subject: '电子证书', customer_name: '广汽丰田', mail_type_zh_cn: '专利电子证书', mailtoname: '收件人', node_name_zh_cn: '审核', update_time: '2026-09-23' },
        { obj_id: '不是编号', mail_subject: '没有编号' }
      ]
    }, query)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.total).toBe(2)
    expect(parsed.data.items[0]?.mailId).toBe('083aa041-008c-4114-8b7f-26df4c612a7f')
    expect(parsed.data.items[1]?.mailId).toBe('')
    expect(parsed.data.items[1]?.subject).toBe('没有编号')
  })

  it('没有 TableRows 时不把响应当成空列表', () => {
    const parsed = normalizeMailProcess({ ClientInfo: client }, query)
    expect(parsed.ok).toBe(false)
  })
})

describe('拼一封发文', () => {
  const customer: CustomerQueryProfile = {
    id: 'customer-1', name: '广汽丰田', easyCustomerId: 'b0f4c252-5936-4ffd-996a-6a02ea1f0eee',
    baseTemplateId: '', overrides: {}, enabled: true, createdAt: '', updatedAt: ''
  }
  const file: SelectedPatentFile = {
    fileId: 'file-1', fileName: '专利电子证书.pdf', fileDescription: '专利电子证书', customerName: '广汽丰田', caseVolume: 'ZL2025'
  }

  it('带入规则后仍由用户确认的字段决定预览', () => {
    const rules = emptyMailRules('op')
    rules.recipients = [{
      id: 'r1', customerProfileId: customer.id, name: '默认', to: ['a@example.com'], cc: [], enabled: true, isDefault: true, version: 1, updatedAt: ''
    }]
    rules.mappings = [{
      id: 'm1', fileDescriptionText: '专利电子证书', mailTypeId: '6f35e455-2d30-488a-97fc-6d937e92a2a1', mailTypeName: '专利电子证书',
      enabled: true, version: 1, updatedAt: ''
    }]
    const filled = fillFromRules(customer, [file], rules, 'op')
    expect(filled.to).toBe('a@example.com')
    expect(filled.subject).toContain('专利电子证书.pdf')
    expect(filled.mailTypeName).toBe('专利电子证书')
    const reviewer = { userId: '11111111-1111-4111-8111-111111111111', name: '吴晨晨' }
    const preview = assembleMail({
      customer, mailTypeId: filled.mailTypeId, mailTypeName: filled.mailTypeName, files: [file],
      to: filled.to, cc: '', subject: filled.subject, body: filled.body, reviewer
    })
    expect(preview.gaps).toEqual([])
    expect(preview.reviewerName).toBe('吴晨晨')
    expect(preview.customerId).toBe(customer.easyCustomerId)
  })

  it('缺资源时只列出缺口，不假装已经创建', () => {
    const preview = assembleMail({ customer: null, mailTypeId: '', mailTypeName: '', files: [], to: '', cc: '', subject: '', body: '' })
    expect(preview.gaps.length).toBeGreaterThan(0)
  })
})
