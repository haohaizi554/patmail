import { describe, expect, it } from 'vitest'
import { buildIcSearchParams, icCasesFromBody } from '../src/api/ic-search'

describe('案件查询', () => {
  it('客户文号补查写进客户文号栏，我方文号栏留空', () => {
    const built = buildIcSearchParams('HC20251191', () => 1, 'case_volume_customer')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const element = built.data.get('Element') ?? ''
    expect(element).toContain('&lt;case_volume&gt;&lt;/case_volume&gt;')
    expect(element).toContain('&lt;case_volume_customer&gt;HC20251191&lt;/case_volume_customer&gt;')
    expect(element).not.toContain('&lt;case_volume&gt;HC20251191&lt;/case_volume&gt;')
  })

  it('按我方文号组装 ICSearchList，结束事项也走这张表', () => {
    const built = buildIcSearchParams('PA2519405CND', () => 1)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.data.get('Call')).toBe('ICSearchList')
    expect(built.data.get('log_pagename')).toBe('ICSearch.aspx')
    expect(built.data.get('is_proc')).toBe('false')
    const element = built.data.get('Element') ?? ''
    expect(element).toContain('&lt;case_volume&gt;PA2519405CND&lt;/case_volume&gt;')
    expect(element).toContain('&lt;case_volume_customer&gt;&lt;/case_volume_customer&gt;')
    expect(element).toContain('&lt;case_type&gt;31D1A147-2931-43B5-94AE-B72B1525BA8A&lt;/case_type&gt;')
    expect(element).toContain('&lt;tech_disclosure&gt;null&lt;/tech_disclosure&gt;')
    expect(built.data.get('cookie')).toBeNull()
    expect(built.data.get('pageSize')).toBe('10')
  })

  it('最多 8 个文号并成一次查询', () => {
    const volumes = ['PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7', 'PA8']
    const built = buildIcSearchParams(volumes.join(';'), () => 1, 'case_volume', 50)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.data.get('pageSize')).toBe('50')
    const element = built.data.get('Element') ?? ''
    expect(element).toContain(`&lt;case_volume&gt;${volumes.join(';')}&lt;/case_volume&gt;`)
    expect(buildIcSearchParams([...volumes, 'PA9'].join(';'), () => 1).ok).toBe(false)
    expect(buildIcSearchParams('P'.repeat(81), () => 1).ok).toBe(false)
  })

  it('从列表里取出文号和案件编号', () => {
    expect(icCasesFromBody({
      TableRows: [{ case_id: '06E2717F-6C2F-40E9-B675-34B8D947234E', case_volume: 'PA2519405CND' }]
    })).toEqual([{ caseId: '06E2717F-6C2F-40E9-B675-34B8D947234E', caseVolume: 'PA2519405CND' }])
    expect(icCasesFromBody({
      TableRows: [{ case_id: '06E2717F-6C2F-40E9-B675-34B8D947234E', case_volume: 'PA25117182CND-米茅', case_volume_customer: 'HC20251191' }]
    })).toEqual([{ caseId: '06E2717F-6C2F-40E9-B675-34B8D947234E', caseVolume: 'PA25117182CND-米茅', customerVolume: 'HC20251191' }])
    expect(icCasesFromBody({ TableRows: null })).toEqual([])
  })
})