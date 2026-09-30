import { describe, expect, it } from 'vitest'
import { buildIcSearchParams, icCasesFromBody } from '../src/api/ic-search'

describe('案件查询', () => {
  it('按我方文号组装 ICSearchList，结束事项也走这张表', () => {
    const built = buildIcSearchParams('PA2519405CND', () => 1)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.data.get('Call')).toBe('ICSearchList')
    expect(built.data.get('log_pagename')).toBe('ICSearch.aspx')
    expect(built.data.get('is_proc')).toBe('false')
    const element = built.data.get('Element') ?? ''
    expect(element).toContain('&lt;case_volume&gt;PA2519405CND&lt;/case_volume&gt;')
    expect(element).toContain('&lt;case_type&gt;31D1A147-2931-43B5-94AE-B72B1525BA8A&lt;/case_type&gt;')
    expect(element).toContain('&lt;tech_disclosure&gt;null&lt;/tech_disclosure&gt;')
    expect(built.data.get('cookie')).toBeNull()
  })

  it('从列表里取出文号和案件编号', () => {
    expect(icCasesFromBody({
      TableRows: [{ case_id: '06E2717F-6C2F-40E9-B675-34B8D947234E', case_volume: 'PA2519405CND' }]
    })).toEqual([{ caseId: '06E2717F-6C2F-40E9-B675-34B8D947234E', caseVolume: 'PA2519405CND' }])
    expect(icCasesFromBody({ TableRows: null })).toEqual([])
  })
})