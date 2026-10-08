import { describe, expect, it } from 'vitest'
import { normalizeFileSearch } from '../src/api/file-search-normalizer'

const clientInfo = { IsLogin: true, Status: true, Result: true, Message: null, Url: null }
const query = { caseVolume: 'A', pageIndex: 2, pageSize: 20 }

describe('GetSearchFiles 响应标准化', () => {
  it('maps documented fields, trims date text without timezone conversion, and derives total pages from total', () => {
    const response = {
      TableRows: [{
        file_id: 'F-1', file_no: 'N-1', file_name: '专利证书.pdf', file_desc: '证书',
        file_status: '已完成', file_type: '官方来文', case_id: 'C-1',
        case_name: '测试案件', case_volume: 'A', case_volume_customer: 'ZL20250306002', app_no: '2026.0001',
        apply_type: '发明', customer_name: '测试客户', ctrl_proc_name: '终止', upload_time: '2026-07-10 ',
        post_date: '2026-07-11 ', extra_field: '不进入 UI'
      }],
      TableRowsCount: '24', ClientInfo: clientInfo
    }
    const result = normalizeFileSearch(response, query)
    expect(result).toMatchObject({ ok: true, data: {
      total: 24, pageIndex: 2, pageSize: 20, totalPages: 2,
      items: [{ fileId: 'F-1', fileNo: 'N-1', fileName: '专利证书.pdf',
        fileDescription: '证书', caseVolume: 'A', customerVolume: 'ZL20250306002', applicationNo: '2026.0001',
        customerName: '测试客户', ctrlProc: '终止', uploadTime: '2026-07-10', officialPostDate: '2026-07-11' }]
    } })
    expect(JSON.stringify(result)).not.toContain('extra_field')
  })

  it('accepts null rows and absent optional fields as an actual empty result', () => {
    expect(normalizeFileSearch({ TableRows: null, TableRowsCount: '0', ClientInfo: clientInfo }, query))
      .toMatchObject({ ok: true, data: { items: [], total: 0, totalPages: 0 } })
    expect(normalizeFileSearch({
      TableRows: [{ file_id: 'F-2', file_name: '通知书' }], TableRowsCount: '1', ClientInfo: clientInfo
    }, { ...query, pageIndex: 1 })).toMatchObject({
      ok: true, data: { items: [{ fileId: 'F-2', fileName: '通知书' }], total: 1 }
    })
  })

  it.each(['', '-1', 'abc', '1.2', 'NaN'])('rejects invalid total %s instead of silently using zero', total => {
    const result = normalizeFileSearch({ TableRows: [], TableRowsCount: total, ClientInfo: clientInfo }, query)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } })
  })

  it('rejects false ClientInfo booleans and malformed rows before showing a false empty state', () => {
    expect(normalizeFileSearch({ TableRows: [], TableRowsCount: '0', ClientInfo: { ...clientInfo, IsLogin: false } }, query))
      .toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } })
    expect(normalizeFileSearch({ TableRows: [], TableRowsCount: '0', ClientInfo: { ...clientInfo, Result: false } }, query))
      .toMatchObject({ ok: false, error: { code: 'BUSINESS_ERROR' } })
    expect(normalizeFileSearch({ TableRows: [{ file_name: '无 ID' }], TableRowsCount: '1', ClientInfo: clientInfo }, query))
      .toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } })
  })
})
