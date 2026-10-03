import { describe, expect, it } from 'vitest'
import type { ApiResult } from '../src/api/types'

function dataOf<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
function codeOf(result: ApiResult<unknown>): string {
  if (result.ok) throw new Error('expected an error')
  return result.error.code
}
import { buildGetSearchFilesFromFields } from '../src/api/file-search-params'
import { normalizeHistoryDetail, normalizeHistoryOptions } from '../src/api/query-history'
import { HistoryQueryService } from '../src/api/query-history/service'
import { historyRequest } from '../src/api/query-history/surfaces'
import { EasyTransport } from '../src/api/transport'
import { CustomerQueryService } from '../src/customer/service'
import { BundleCustomerRepository } from '../src/customer/repository'
import { resolveQueryTemplate } from '../src/query/merge'
import { parseQueryXml, MAX_QUERY_XML_CHARS, MAX_QUERY_XML_NODES } from '../src/query/xml-parser'
import { buildQueryXml } from '../src/query/query-xml'
import { cellsFromLiveFields } from '../src/query/live-fields'
import { historyDeleteRequest, historySaveRequest, normalizeHistorySave } from '../src/api/query-history'
import { historyLabels } from '../src/query/history-labels'
import { BundleTemplateRepository } from '../src/query/repository'
import { MemoryBundleRepository, readBundle } from '../src/storage/query-bundle'

const client = { ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null } }
const guid = '227BFA59-A8A7-4EC6-928D-50FB5C29F960'
const other = '122F1BAA-F03E-42EE-B297-D9E47C0823A4'

describe('历史模板响应', () => {
  it('reads options and treats null as an empty list', () => {
    expect(dataOf(normalizeHistoryOptions({ ...client, Options: [{ query_id: guid, title: '专利文件查询' }] })))
      .toEqual([{ id: guid, name: '专利文件查询', source: 'easy' }])
    const repeated = dataOf(normalizeHistoryOptions({
      ...client,
      Options: [
        { query_id: '3E8B3288-4A3B-4685-B540-2EC98166B5B2', title: '微众OA反馈' },
        { query_id: guid, title: '微众OA反馈' },
        { query_id: other, title: '宁德授权请款' }
      ]
    }))
    expect(repeated.map(item => item.id)).toEqual(['3E8B3288-4A3B-4685-B540-2EC98166B5B2', guid, other])
    expect(historyLabels(repeated).get('3E8B3288-4A3B-4685-B540-2EC98166B5B2')).toBe('微众OA反馈 · 3E8B3288')
    expect(historyLabels(repeated).get(guid)).toBe('微众OA反馈 · 227BFA59')
    expect(historyLabels(repeated).get(other)).toBe('宁德授权请款')
    expect(dataOf(normalizeHistoryOptions({ ...client, Options: null }))).toEqual([])
    expect(dataOf(normalizeHistoryOptions({ ...client, Options: [] }))).toEqual([])
  })

  it('rejects a malformed list and a logged-out payload', () => {
    expect(codeOf(normalizeHistoryOptions({ ...client, Options: { query_id: guid } }))).toBe('INVALID_RESPONSE')
    expect(codeOf(normalizeHistoryOptions({ ...client, Options: [{ query_id: guid }] }))).toBe('INVALID_RESPONSE')
    expect(codeOf(normalizeHistoryOptions({ ClientInfo: { IsLogin: false, Status: true }, Options: null }))).toBe('SESSION_EXPIRED')
  })

  it('loads one template and reports a missing id', () => {
    const xml = '<xmlRoot><case_volume>PA-1</case_volume></xmlRoot>'
    expect(dataOf(normalizeHistoryDetail({
      ...client, Options: [{ query_id: guid, title: '专利文件查询' }], QueryXml: [{ query_xml: xml }]
    }, guid))).toMatchObject({ id: guid, name: '专利文件查询', queryXml: xml })
    expect(codeOf(normalizeHistoryDetail({ ...client, Options: null, QueryXml: null }, guid))).toBe('INVALID_QUERY')
  })
})

describe('QueryXml', () => {
  it('separates values, empty strings, display text and unknown fields', () => {
    const parsed = parseQueryXml(`<xmlRoot>
      <customer_name_vague>客户A</customer_name_vague>
      <filetype>603ca943-a07a-4894-9461-29dff2d60c4b</filetype>
      <filetype_text>专利证书</filetype_text>
      <case_volume></case_volume>
      <selfileclass>general</selfileclass>
      <selfileclass_text>所有文件</selfileclass_text>
      <TreefiletypetxtSearch>意见陈述</TreefiletypetxtSearch>
      <case_volume>A&amp;B</case_volume>
    </xmlRoot>`, '样本')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.fields.customer_name_vague).toBe('客户A')
    expect(parsed.data.fields.filetype).toBe('603ca943-a07a-4894-9461-29dff2d60c4b')
    expect(parsed.data.fields.case_volume).toBe('A&B')
    expect(parsed.data.fields.fileclass).toBe('general')
    expect(parsed.data.displayValues.filetype).toBe('专利证书')
    expect(parsed.data.displayValues.fileclass).toBe('所有文件')
    expect(parsed.data.unknownFields.TreefiletypetxtSearch).toBe('意见陈述')
    expect(parsed.data.fields.filetype_text).toBeUndefined()
    expect(parsed.data.warnings.some(item => item.includes('case_volume'))).toBe(true)
  })

  it('rejects empty, illegal, doctype and oversized xml', () => {
    expect(codeOf(parseQueryXml(''))).toBe('INVALID_RESPONSE')
    expect(codeOf(parseQueryXml('<root></root>'))).toBe('INVALID_RESPONSE')
    expect(codeOf(parseQueryXml('<xmlRoot><case_volume>'))).toBe('INVALID_RESPONSE')
    expect(codeOf(parseQueryXml('<!DOCTYPE foo [<!ENTITY x "y">]><xmlRoot></xmlRoot>'))).toBe('INVALID_RESPONSE')
    expect(codeOf(parseQueryXml(`<xmlRoot>${'a'.repeat(MAX_QUERY_XML_CHARS)}</xmlRoot>`))).toBe('INVALID_RESPONSE')
    const nodes = Array.from({ length: MAX_QUERY_XML_NODES + 1 }, (_, index) => `<extra${index}></extra${index}>`).join('')
    expect(codeOf(parseQueryXml(`<xmlRoot>${nodes}</xmlRoot>`))).toBe('INVALID_RESPONSE')
  })
})

describe('模板合并', () => {
  const base = { case_type: 'PATENT', filetype: 'CERT', customer_name_vague: '' }

  it('applies three layers and keeps an explicit empty override', () => {
    const customer = { customer_name_vague: '客户A', filetype: '' }
    const temporary = { case_volume: 'PA-9' }
    const resolved = resolveQueryTemplate(base, customer, temporary)
    expect(resolved.fields).toEqual({
      case_type: 'PATENT', filetype: '', customer_name_vague: '客户A', case_volume: 'PA-9'
    })
    expect(resolved.sources).toMatchObject({
      case_type: 'base', filetype: 'customer', customer_name_vague: 'customer', case_volume: 'temporary'
    })
    expect(base.filetype).toBe('CERT')
  })

  it('does not override a missing key and ignores prototype keys', () => {
    const resolved = resolveQueryTemplate(base, { customer_name_vague: '客户A' }, {})
    expect(resolved.fields.filetype).toBe('CERT')
    const malicious = JSON.parse('{"__proto__":"x","constructor":"y","prototype":"z","case_volume":"A","not_a_field":"1"}') as Record<string, string>
    const safe = resolveQueryTemplate({}, malicious, {})
    expect(safe.fields).toEqual({ case_volume: 'A' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(safe.warnings.length).toBeGreaterThan(0)
  })

  it('builds GetSearchFiles from the merged fields and keeps them across pages', () => {
    const resolved = resolveQueryTemplate(
      { case_type: '31D1A147-2931-43B5-94AE-B72B1525BA8A', filetype: '603ca943-a07a-4894-9461-29dff2d60c4b' },
      { customer_name_vague: '客户A', filetype: '' },
      {}
    )
    const params = dataOf(buildGetSearchFilesFromFields(resolved.fields, { pageIndex: 2, pageSize: 20 }, undefined, () => 10))
    expect(params.get('Call')).toBe('GetSearchFiles')
    expect(params.get('pageIndex')).toBe('2')
    expect(params.get('filetype')).toBe('')
    expect(params.get('customer_name_vague')).toBe('客户A')
    expect(params.get('case_type')).toBe('31D1A147-2931-43B5-94AE-B72B1525BA8A')
    expect(codeOf(buildGetSearchFilesFromFields({}, { pageIndex: 1, pageSize: 20 }))).toBe('INVALID_QUERY')
    expect(codeOf(buildGetSearchFilesFromFields({ case_type: '31D1A147-2931-43B5-94AE-B72B1525BA8A', fileclass: 'general' }, { pageIndex: 1, pageSize: 20 }))).toBe('INVALID_QUERY')
    expect(codeOf(buildGetSearchFilesFromFields({ Call: 'MailCustomer' } as Record<string, string>, { pageIndex: 1, pageSize: 20 }))).toBe('INVALID_QUERY')
  })

  it('submits vip and specialty, and leaves download-name controls out of the request', () => {
    const resolved = resolveQueryTemplate({}, {}, {
      case_volume: 'PA-1',
      is_vip: '1',
      specialtyid: '机械',
      selfilePath: 'case_name',
      filetemp: 'd9896997-1e83-4c7d-9a49-da69ba56e7aa'
    })
    expect(resolved.fields.is_vip).toBe('1')
    expect(resolved.fields.specialtyid).toBe('机械')
    expect(resolved.fields.selfilePath).toBeUndefined()
    expect(resolved.warnings.some(item => item.includes('selfilePath'))).toBe(false)
    const params = dataOf(buildGetSearchFilesFromFields(resolved.fields, { pageIndex: 1, pageSize: 20 }, undefined, () => 1))
    expect(params.get('is_vip')).toBe('1')
    expect(params.get('specialtyid')).toBe('机械')
    expect(params.has('selfilePath')).toBe(false)
    expect(params.has('filetemp')).toBe(false)
  })
})

describe('本地模板和客户配置', () => {
  it('creates, edits, copies and deletes only local templates', async () => {
    const memory = new MemoryBundleRepository()
    const repository = new BundleTemplateRepository(memory)
    const now = '2026-09-24T00:00:00.000Z'
    await repository.save({
      id: 'local-1', name: '专利文件查询', source: 'local', queryType: 'FileSearch',
      fields: { case_volume: 'PA' }, version: 1, createdAt: now, updatedAt: now
    })
    await expect(repository.save({
      id: guid, name: '远程', source: 'easy', queryType: 'FileSearch',
      fields: {}, version: 1, createdAt: now, updatedAt: now
    })).rejects.toThrow('本地模板')
    const saved = await repository.get('local-1')
    expect(saved?.fields.case_volume).toBe('PA')
    await repository.save({ ...saved!, name: '已改', version: 2, updatedAt: now })
    expect((await repository.get('local-1'))?.name).toBe('已改')
    await repository.delete('local-1')
    expect(await repository.list()).toEqual([])
  })

  it('stores customers, rejects a fake guid, and skips a broken bundle', async () => {
    const memory = new MemoryBundleRepository()
    const service = new CustomerQueryService(new BundleCustomerRepository(memory), () => '2026-09-24T00:00:00.000Z')
    const saved = await service.save({
      name: '客户A', baseTemplateId: 'local-1', overrides: { filetype: '' }, enabled: true
    })
    expect(saved.id.startsWith('customer-')).toBe(true)
    expect(saved.overrides.filetype).toBe('')
    await expect(service.save({
      name: '客户B', easyCustomerId: '不是GUID', baseTemplateId: 'local-1', overrides: {}, enabled: true
    })).rejects.toThrow('GUID')
    await service.delete(saved.id)
    expect(await service.list()).toEqual([])
    expect(readBundle({ version: 1, templates: [{ id: 1 }], customers: [] }).writable).toBe(false)
    expect(readBundle({ version: 9, templates: [], customers: [] }).warning).toContain('版本')
  })
})

describe('历史模板传输', () => {
  it('caches the list, forces refresh, and times out', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      if (calls > 2) return new Response('down', { status: 500 })
      return new Response(JSON.stringify({ ...client, Options: [{ query_id: other, title: '列表' }] }), { status: 200 })
    }
    const service = new HistoryQueryService(new EasyTransport('http://183.36.43.66:88', { fetcher }), () => 1_000)
    expect(dataOf(await service.list('user', 'file', false))).toHaveLength(1)
    expect(dataOf(await service.list('user', 'file', false))).toHaveLength(1)
    expect(calls).toBe(1)
    await service.list('user', 'file', true)
    expect(calls).toBe(2)
    expect(dataOf(await service.list('user', 'file', true))).toHaveLength(1)
    expect(calls).toBe(3)
    service.invalidate()
    const hanging = new HistoryQueryService(new EasyTransport('http://183.36.43.66:88', {
      fetcher: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
      }),
      timeoutMs: 20
    }))
    expect(codeOf(await hanging.list('user', 'file', true))).toBe('REQUEST_TIMEOUT')
  })

  it('uses the cached title when the detail payload omits Options', async () => {
    const xml = '<xmlRoot><app_no>2026.1</app_no></xmlRoot>'
    const fetcher: typeof fetch = async (_url, init) => {
      const id = new URLSearchParams(String(init?.body)).get('query_id')
      const body = id
        ? { ...client, Options: null, QueryXml: [{ query_xml: xml }] }
        : { ...client, Options: [{ query_id: guid, title: '缓存标题' }] }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    const service = new HistoryQueryService(new EasyTransport('http://183.36.43.66:88', { fetcher }))
    await service.list('user', 'file', true)
    expect(dataOf(await service.detail('user', 'file', guid))).toMatchObject({ name: '缓存标题', queryXml: xml })
    expect(codeOf(await service.detail('user', 'file', 'not-a-guid'))).toBe('INVALID_QUERY')
  })

  it('saves a query template with SearchQueryHisSave and does not invent an id', async () => {
    const xml = buildQueryXml(
      { customer_name_vague: '宁德时代', fileclass: 'general', post_s: '2025-09-15' },
      { fileclass: '所有文件' }
    )
    expect(xml).toContain('<customer_name_vague>宁德时代</customer_name_vague>')
    expect(xml).toContain('<selfileclass>general</selfileclass>')
    expect(xml).toContain('<selfileclass_text>所有文件</selfileclass_text>')
    expect(xml).toContain('<txtpost_s>2025-09-15</txtpost_s>')
    const parsed = parseQueryXml(xml)
    expect(parsed.ok && parsed.data.fields.fileclass).toBe('general')
    expect(dataOf(normalizeHistorySave({ ClientInfo: { IsLogin: true, Status: true, Result: true } }))).toEqual({ saved: true })
    expect(dataOf(normalizeHistorySave({ ...client, Ret: true }))).toEqual({ saved: true })
    expect(dataOf(normalizeHistorySave(client))).toEqual({ saved: true })
    expect(codeOf(normalizeHistorySave({ ClientInfo: { IsLogin: true, Status: true, Result: false, Message: '没有保存' } }))).toBe('BUSINESS_ERROR')
    expect(codeOf(normalizeHistorySave({ ...client, Ret: false }))).toBe('BUSINESS_ERROR')
    let body = ''
    const service = new HistoryQueryService(new EasyTransport('http://183.36.43.66:88', {
      fetcher: async (_url, init) => {
        body = String(init?.body)
        return new Response(JSON.stringify({ ClientInfo: { IsLogin: true, Status: true, Result: true } }), { status: 200 })
      }
    }))
    expect(dataOf(await service.save('user', 'file', { title: '我的查询条件', queryId: '', queryXml: xml }))).toEqual({ saved: true })
    const sent = new URLSearchParams(body)
    expect(sent.get('Call')).toBe('SearchQueryHisSave')
    expect(sent.get('is_query_save')).toBe('true')
    expect(sent.get('is_out_save')).toBe('false')
    expect(sent.get('query_save_title')).toBe('我的查询条件')
    expect(sent.get('query_id')).toBe('')
    expect(sent.get('query_type')).toBe('FileSearch')
    expect(historySaveRequest('limit', '期限', '', '<xmlRoot></xmlRoot>').get('query_type')).toBe('LimitMonitor\u2014liall')
    const remove = historyDeleteRequest('file', guid)
    expect(remove.get('Call')).toBe('SearchQueryHisDelete')
    expect(remove.get('query_id')).toBe(guid)
    expect(remove.get('log_pagename')).toBe('FileSearch.aspx')
    let deletedBody = ''
    const deleting = new HistoryQueryService(new EasyTransport('http://183.36.43.66:88', {
      fetcher: async (_url, init) => {
        deletedBody = String(init?.body)
        return new Response(JSON.stringify({ ...client, Ret: true }), { status: 200 })
      }
    }))
    await deleting.list('user', 'file', true)
    expect(dataOf(await deleting.delete('user', 'file', guid))).toEqual({ deleted: true })
    expect(new URLSearchParams(deletedBody).get('Call')).toBe('SearchQueryHisDelete')
    expect(codeOf(await deleting.delete('user', 'file', 'not-a-guid'))).toBe('INVALID_QUERY')
  })

  it('loads only the fields that sit below the first screen', () => {
    const live = cellsFromLiveFields([
      { id: 'case_volume', label: '我方文号', section: 'case', advanced: false, control: 'text', visible: true, hiddenBy: [], options: [] },
      { id: 'applicant', label: '申请人', section: 'case', advanced: true, control: 'text', visible: true, hiddenBy: [], options: [] },
      { id: 'agency_id', label: '代理机构', section: 'case', advanced: true, control: 'picker', visible: true, hiddenBy: [], options: [] },
      { id: 'hidden_case', label: '藏起来', section: 'case', advanced: true, control: 'text', visible: false, hiddenBy: ['tr'], options: [] },
      { id: 'file_remark', label: '文件备注', section: 'file', advanced: true, control: 'text', visible: true, hiddenBy: [], options: [] }
    ])
    expect(live.case.map(item => item.kind === 'text' || item.kind === 'named' ? item.key : '')).toEqual(['applicant', 'agency_id'])
    expect(live.file.map(item => item.kind === 'text' ? item.key : '')).toEqual(['file_remark'])
  })

  it('asks the limit page for its own templates', () => {
    const params = historyRequest('limit', '')
    expect(params.get('query_type')).toBe('LimitMonitor\u2014liall')
    expect(params.get('query_type')).not.toContain('-')
    expect(params.get('log_pagename')).toBe('LimitMonitor.aspx')
    expect(historyRequest('file', '').get('query_type')).toBe('FileSearch')
  })
})
