import { describe, expect, it } from 'vitest'
import { buildMailProcessParams, buildProcessListParams, mailPageUrl, normalizeMailProcess, normalizeProcessList } from '../src/api/mail-process'
import { EASY_ORIGIN } from '../src/api/config'
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

  it('打开发文时跳到原站邮件页，并带上邮件编号和页签编号', () => {
    const mailId = '899B9FFD-A4FF-40D2-8B7C-90EFDB8DA673'
    const guid = '0d3819b3-845a-d3ee-f732-59d93e9066a4'
    const href = mailPageUrl(EASY_ORIGIN, mailId, guid)
    expect(href).toBe(`${EASY_ORIGIN}/Forms/mail/mail.aspx?objid=${mailId}&guid=${guid}`)
    expect(mailPageUrl('http://127.0.0.1', mailId, guid)).toBeNull()
    expect(mailPageUrl(EASY_ORIGIN, '不是编号', guid)).toBeNull()
  })
})

describe('待办流程列表', () => {
  it('提案和递交使用原站页签的 Call 与列', () => {
    const proposal = buildProcessListParams({ kind: 'AP', ...query })
    const filing = buildProcessListParams({ kind: 'EF', ...query })
    expect(proposal.ok && filing.ok).toBe(true)
    if (!proposal.ok || !filing.ok) return
    expect(proposal.data.get('Call')).toBe('GetProcessByTypeAP')
    expect(proposal.data.get('colsel')).toContain('apply_name')
    expect(proposal.data.get('log_pagename')).toBe('ProcessNew.aspx')
    expect(filing.data.get('Call')).toBe('GetProcessByTypeEF')
    expect(filing.data.get('colsel')).toContain('case_volume')
  })

  it('提案行按表头取单元格，没有编号的行仍然保留', () => {
    const parsed = normalizeProcessList({
      ClientInfo: client,
      TableRowsCount: '1',
      TableRows: [{ obj_id: '不是编号', apply_name: '玻璃幕墙装饰', customer_name: '中国·华东大区', node_name_zh_cn: '程序审核' }]
    }, { kind: 'AP', ...query })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.kind).toBe('AP')
    expect(parsed.data.items[0]?.id).toBe('')
    expect(parsed.data.items[0]?.cells.apply_name).toBe('玻璃幕墙装饰')
    expect(parsed.data.items[0]?.cells.customer_name).toBe('中国·华东大区')
    expect(parsed.data.items[0]?.cells.tapp_no).toBe('')
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
