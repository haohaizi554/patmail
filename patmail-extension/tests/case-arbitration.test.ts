import { describe, expect, it } from 'vitest'
import type { ApiResult } from '../src/api/types'
import { formatCaseFields, loadCaseFields } from '../src/customer/case-arbitration'

describe('案件字段仲裁包', () => {
  it('只交出固定栏，并要求在这些栏里选', () => {
    const text = formatCaseFields({
      caseVolume: 'PA1',
      demands: [{ demandId: '1', demandType: '其它要求', title: '发给发明人', description: '主送全部发明人' }],
      inventors: '艾桥、陈翔',
      page: [{ label: '案件名称', value: '摄像机' }],
      unread: []
    })
    expect(text.startsWith('案件字段：')).toBe(true)
    expect(text).toContain('艾桥、陈翔')
    expect(text).toContain('发给发明人')
    expect(text).toContain('不要自己拼接口')
  })

  it('按文号依次读要求、发明人和案件页', async () => {
    const calls: string[] = []
    const post = async (operation: 'icSearch' | 'caseDemand' | 'caseInventor' | 'caseManageInfo'): Promise<ApiResult<unknown>> => {
      calls.push(operation)
      if (operation === 'icSearch') {
        return { ok: true, data: { TableRows: [{ case_id: 'aaaaaaaa-1111-4111-8111-111111111111', case_volume: 'PA1' }] } }
      }
      if (operation === 'caseDemand') {
        return { ok: true, data: { ClientInfo: { IsLogin: true }, TableRows: [{ demand_id: '1', demand_type: '其它要求', demand_name: '发给发明人', demand_desc: '主送发明人' }], TableRowsCount: '1' } }
      }
      if (operation === 'caseInventor') {
        return { ok: true, data: { ClientInfo: { IsLogin: true }, TableRows: [{ inventor_id: 'i1', inventor_name_cn: '艾桥', seq: '1' }] } }
      }
      return { ok: true, data: { CaseInfo: [{ case_name: '摄像机', app_no: 'CN1' }] } }
    }
    const text = await loadCaseFields('PA1', post)
    expect(calls).toEqual(['icSearch', 'caseDemand', 'caseInventor', 'caseManageInfo'])
    expect(text).toContain('艾桥')
    expect(text).toContain('摄像机')
    expect(text).not.toContain('aaaaaaaa-1111-4111-8111-111111111111')
  })
})
