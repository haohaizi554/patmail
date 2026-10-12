import { describe, expect, it } from 'vitest'
import { formatCustomerInfo, formatRecordInfo, loadCaseRecord } from '../src/customer/case-record'
import { lookupIcFlow } from '../src/customer/ic-flow-lookup'
import type { ApiResult } from '../src/api/types'

const client = { ClientInfo: { IsLogin: true, Status: true, Result: false } }

describe('核对时带上的客户要求和著录项目', () => {
  it('客户要求、发明人和客户联系人收成两段文字', () => {
    expect(formatCustomerInfo({
      ...client,
      CustomerDemand: [{ demand_type: '发文', demand_name: '发给发明人', demand_desc: '不要发给商务' }]
    })).toContain('发给发明人')
    expect(formatRecordInfo(
      { ...client, TableRows: [{ inventor_name_cn: '艾桥' }] },
      { ...client, TableRows: [{ contact_name: '姜颖', contact_type: 'IPR', email: 'jiang@example.com' }] }
    )).toContain('发明人：艾桥')
    expect(formatRecordInfo(
      { ...client, TableRows: [{ inventor_name_cn: '艾桥' }] },
      { ...client, TableRows: [{ contact_name: '姜颖', contact_type: 'IPR', email: 'jiang@example.com' }] }
    )).toContain('姜颖｜IPR｜jiang@example.com')
    expect(formatCustomerInfo({ ...client, CustomerDemand: null })).toBe('')
  })

  it('IPR 空着的行在核对时读一次著录，已经填了 IPR 的不再读', async () => {
    const seen: string[] = []
    const post = async (operation: 'icSearch' | 'caseBusFlow'): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') return { ok: true, data: { ProcInfo: [], Eflow: [] } }
      return { ok: true, data: { TableRows: [{ case_id: 'aaaaaaaa-1111-4111-8111-111111111111', case_volume: 'PA1' }] } }
    }
    const readRecord = async (caseId: string) => {
      seen.push(caseId)
      return { customerInfo: '客户要求：\n1. 发文｜发给发明人｜不要发给商务', recordInfo: '发明人：艾桥' }
    }
    const found = await lookupIcFlow([
      { caseVolume: 'PA1', procLabel: '提醒申请PCT', withRecord: true },
      { caseVolume: 'PA1', procLabel: '提醒申请PCT' }
    ], post, readRecord)
    expect(seen).toEqual(['aaaaaaaa-1111-4111-8111-111111111111'])
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.data.items[0]?.customerInfo).toContain('发给发明人')
      expect(found.data.items[0]?.recordInfo).toBe('发明人：艾桥')
      expect(found.data.items[1]?.customerInfo).toBeUndefined()
    }
  })

  it('三个接口按案件编号读取，不重新查文号', async () => {
    const calls: string[] = []
    const loaded = await loadCaseRecord('aaaaaaaa-1111-4111-8111-111111111111', async (operation, params) => {
      calls.push(`${operation}:${params.get('case_id') || params.get('apply_id') || params.get('id')}`)
      if (operation === 'casePageDemand') {
        return { ok: true, data: { ...client, CustomerDemand: [{ demand_name: '发给发明人' }] } }
      }
      if (operation === 'caseInventor') {
        return { ok: true, data: { ...client, TableRows: [{ inventor_name_cn: '艾桥' }] } }
      }
      return { ok: true, data: { ...client, TableRows: [{ contact_name: '姜颖', contact_type: '技术联系人' }] } }
    })
    expect(calls).toEqual([
      'casePageDemand:aaaaaaaa-1111-4111-8111-111111111111',
      'caseInventor:aaaaaaaa-1111-4111-8111-111111111111',
      'caseRecordContact:aaaaaaaa-1111-4111-8111-111111111111'
    ])
    expect(loaded).toMatchObject({ customerInfo: expect.stringContaining('发给发明人'), recordInfo: expect.stringContaining('艾桥') })
  })
})
