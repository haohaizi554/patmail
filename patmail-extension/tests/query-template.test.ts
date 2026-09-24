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
import { EasyTransport } from '../src/api/transport'
import { CustomerQueryService } from '../src/customer/service'
import { BundleCustomerRepository } from '../src/customer/repository'
import { resolveQueryTemplate } from '../src/query/merge'
import { parseQueryXml, MAX_QUERY_XML_CHARS, MAX_QUERY_XML_NODES } from '../src/query/xml-parser'
import { BundleTemplateRepository } from '../src/query/repository'
import { MemoryBundleRepository, readBundle } from '../src/storage/query-bundle'

const client = { ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null } }
const guid = '227BFA59-A8A7-4EC6-928D-50FB5C29F960'
const other = '122F1BAA-F03E-42EE-B297-D9E47C0823A4'

describe('历史模板响应', () => {
  it('reads options and treats null as an empty list', () => {
    expect(dataOf(normalizeHistoryOptions({ ...client, Options: [{ query_id: guid, title: '专利文件查询' }] })))
      .toEqual([{ id: guid, name: '专利文件查询', source: 'easy' }])
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
    expect(readBundle({ version: 1, templates: [{ id: 1 }], customers: [] }).warning).toContain('跳过')
    expect(readBundle({ version: 9, templates: [], customers: [] }).warning).toContain('版本')
  })
})

describe('历史模板传输', () => {
  it('caches the list, forces refresh, and times out', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls += 1
      return new Response(JSON.stringify({ ...client, Options: [{ query_id: other, title: '列表' }] }), { status: 200 })
    }
    const service = new HistoryQueryService(new EasyTransport('http://183.36.43.66:88', { fetcher }), () => 1_000)
    expect(dataOf(await service.list('user', false))).toHaveLength(1)
    expect(dataOf(await service.list('user', false))).toHaveLength(1)
    expect(calls).toBe(1)
    await service.list('user', true)
    expect(calls).toBe(2)
    service.invalidate()
    const hanging = new HistoryQueryService(new EasyTransport('http://183.36.43.66:88', {
      fetcher: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
      }),
      timeoutMs: 20
    }))
    expect(codeOf(await hanging.list('user', true))).toBe('REQUEST_TIMEOUT')
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
    await service.list('user', true)
    expect(dataOf(await service.detail('user', guid))).toMatchObject({ name: '缓存标题', queryXml: xml })
    expect(codeOf(await service.detail('user', 'not-a-guid'))).toBe('INVALID_QUERY')
  })
})
