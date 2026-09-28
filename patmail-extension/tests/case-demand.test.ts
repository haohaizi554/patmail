import { describe, expect, it } from 'vitest'
import { caseDemandParams, formatCaseDemandText, loadCaseDemandText, readCaseDemandPage } from '../src/mail/easy/case-demand'
import type { ApiResult } from '../src/api/types'

const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function client(rows: unknown, count = '1'): Record<string, unknown> {
  return { ClientInfo: { IsLogin: true, Status: true, Result: true }, TableRows: rows, TableRowsCount: count }
}

describe('案件要求表文本', () => {
  it('按发文页抓包组装请求，认的是案件编号', () => {
    const params = caseDemandParams(caseId, 2)
    expect(params?.get('Call')).toBe('GetDemandBuCaseid')
    expect(params?.get('case_id')).toBe(caseId)
    expect(params?.get('pageIndex')).toBe('2')
    expect(params?.get('pageSize')).toBe('10')
    expect(params?.get('_PK')).toBe('demand_id')
    expect(params?.get('colsel')).toBe(';demand_type;demand_name;demand_desc;')
    expect(params?.get('searchKey')).toBe('')
    expect(params?.get('log_pagename')).toBe('mail.aspx')
    expect(caseDemandParams('不是编号', 1)).toBeNull()
  })

  it('保留三列原文，不把空列表结构当成没有要求', () => {
    const parsed = readCaseDemandPage(client([
      { demand_id: caseId, demand_type: '答复要求', demand_name: '尽量不要超过5页', demand_desc: '转给案件流程时先联系客户。' }
    ]))
    expect(parsed.state).toBe('known')
    if (parsed.state !== 'known') return
    expect(parsed.rows[0]).toMatchObject({ demandType: '答复要求', title: '尽量不要超过5页', description: '转给案件流程时先联系客户。' })
    expect(formatCaseDemandText(parsed.rows)).toContain('要求类型：答复要求')
    expect(formatCaseDemandText(parsed.rows)).toContain('描述：转给案件流程时先联系客户。')
    expect(readCaseDemandPage({ ClientInfo: { IsLogin: true }, TableRows: null }).state).toBe('unknown')
    expect(readCaseDemandPage({ ClientInfo: { IsLogin: true } }).state).toBe('unknown')
  })

  it('第一页对不上时不返回空文本，第二页中断时保留已读原文', async () => {
    const missing = await loadCaseDemandText(caseId, async () => ({ ok: true, data: { ClientInfo: { IsLogin: true } } }))
    expect(missing.ok).toBe(false)

    let page = 0
    const partial = await loadCaseDemandText(caseId, async (): Promise<ApiResult<unknown>> => {
      page += 1
      if (page === 1) {
        const rows = Array.from({ length: 10 }, (_, index) => ({
          demand_type: '其它要求',
          demand_name: index === 0 ? '品川作成' : `标题${index}`,
          demand_desc: '标准答复之外另附说明。'
        }))
        return { ok: true, data: client(rows, '12') }
      }
      return { ok: false, error: { code: 'HTTP_ERROR', message: '后面没有返回。' } }
    })
    expect(partial.ok).toBe(true)
    if (!partial.ok) return
    expect(partial.data.complete).toBe(false)
    expect(partial.data.text).toContain('品川作成')
    expect(partial.data.rows).toHaveLength(10)
  })
})
