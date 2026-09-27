import { describe, expect, it } from 'vitest'
import { buildLimitMailCustomerParams, buildLimitMonitorParams, LIMIT_MONITOR_FIELDS, LIMIT_MONITOR_TYPES } from '../src/api/limit-monitor-params'
import { normalizeLimitMonitor } from '../src/api/limit-monitor-normalizer'
import { isMessage, MessageType } from '../src/shared/message'

const query = { type: 'all' as const, caseVolume: 'PA2622582', pageIndex: 1, pageSize: 10 }

function paramsOf(result: ReturnType<typeof buildLimitMonitorParams>): URLSearchParams {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

describe('期限监控', () => {
  it('lets a customer-name search through the page channel', () => {
    const query = {
      type: 'all',
      caseVolume: '',
      applicationNo: '',
      customerName: '广汽丰田',
      fields: { customer_name: '广汽丰田' },
      pageIndex: 1,
      pageSize: 10
    }
    expect(isMessage({
      type: MessageType.Workspace,
      payload: { action: 'forward', message: { type: MessageType.SearchLimitMonitor, payload: { query } } }
    })).toBe(true)
    expect(isMessage({
      type: MessageType.Workspace,
      payload: { action: 'forward', message: { type: MessageType.LoadDictionary, payload: { kind: 'picker', force: true } } }
    })).toBe(true)
  })

  it('submits the 115 fields in order and keeps the other business tabs on the same call', () => {
    const params = paramsOf(buildLimitMonitorParams(query, () => 1000))
    expect([...params.keys()]).toEqual([...LIMIT_MONITOR_FIELDS])
    expect(params.get('Call')).toBe('GetLimitMonitorCaseList')
    expect(params.get('is_first')).toBe('false')
    expect(params.get('type')).toBe('all')
    expect(params.get('case_volume')).toBe('PA2622582')
    expect(params.get('log_pagename')).toBe('LimitMonitor.aspx')
    expect(params.get('applicant')).toBe('')
    for (const type of LIMIT_MONITOR_TYPES) {
      expect(paramsOf(buildLimitMonitorParams({ ...query, type }, () => 1000)).get('Call')).toBe('GetLimitMonitorCaseList')
    }
    expect(paramsOf(buildLimitMonitorParams({ ...query, caseVolume: '  ' }, () => 1000)).get('case_volume')).toBe('')
    const withFields = paramsOf(buildLimitMonitorParams({ ...query, caseVolume: '', fields: { applicant: '张三', is_fuzzy_query_app_no_other: 'true' } }, () => 1000))
    expect([...withFields.keys()]).toEqual([...LIMIT_MONITOR_FIELDS])
    expect(withFields.get('applicant')).toBe('张三')
    expect(withFields.get('business_type_other')).toBe('')
    const withBusiness = paramsOf(buildLimitMonitorParams({ ...query, fields: { business_type_other: '05E75F37-60F5-44E1-8B57-456AC8B4CFF7' } }, () => 1000))
    expect(withBusiness.get('business_type_other')).toBe('05E75F37-60F5-44E1-8B57-456AC8B4CFF7')
    const procs = '945c4477-80b5-4423-bdec-b2391351c681,31D1A147-2931-43B5-94AE-B72B1525BA8A'
    expect(paramsOf(buildLimitMonitorParams({ ...query, fields: { ctrl_proc: procs } }, () => 1000)).get('ctrl_proc')).toBe(procs)
    expect(buildLimitMonitorParams({ ...query, fields: { ctrl_proc: '新申请' } }).ok).toBe(false)
    expect(withFields.get('is_fuzzy_query_app_no_other')).toBe('true')
    expect(withFields.get('case_volume')).toBe('')
  })

  it('reads a list when Result is false but the rows are present', () => {
    const result = normalizeLimitMonitor({
      ClientInfo: { IsLogin: true, Status: true, Result: false, Message: '' },
      TableRows: [{ proc_id: '945c4477-80b5-4423-bdec-b2391351c681', case_volume: 'PA1', ctrl_proc: '新申请', legal_due_date: '2026-10-01' }],
      TableRowsCount: '1'
    }, query)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.total).toBe(1)
      expect(result.data.items[0]).toMatchObject({ caseVolume: 'PA1', ctrlProc: '新申请', legalDueDate: '2026-10-01' })
    }
  })

  it('does not treat the first empty page load as a finished search', () => {
    const result = normalizeLimitMonitor({
      ClientInfo: { IsLogin: true, Status: true, Result: false, Message: '' }
    }, query)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } })
  })

  it('builds one proc mail request and refuses to guess a multi-id separator', () => {
    const params = buildLimitMailCustomerParams({
      procId: '945c4477-80b5-4423-bdec-b2391351c681',
      mailTypeId: '8d67261c-a944-4ac4-9d0b-6f10d6e98e8b'
    })
    expect(params.ok).toBe(true)
    if (params.ok) {
      expect(params.data.get('Call')).toBe('LimitMailCustomer')
      expect(params.data.get('_file_ids')).toBe('945c4477-80b5-4423-bdec-b2391351c681')
      expect(params.data.has('_file_names')).toBe(false)
    }
    expect(buildLimitMailCustomerParams({ procId: 'not-a-guid', mailTypeId: '8d67261c-a944-4ac4-9d0b-6f10d6e98e8b' }).ok).toBe(false)
  })
})
