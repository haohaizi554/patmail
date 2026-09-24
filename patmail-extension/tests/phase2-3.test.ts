import { describe, expect, it } from 'vitest'
import { adaptCaseType, adaptCountry, adaptFieldColumns, adaptListColumns } from '../src/api/dictionaries/adapters'
import { DictionaryCache } from '../src/api/dictionaries/cache'
import { DictionaryService } from '../src/api/dictionaries/service'
import { assessQueryScope } from '../src/api/file-search-params'
import { EasyTransport } from '../src/api/transport'
import type { ApiResult } from '../src/api/types'
import { TemplateLoadCoordinator } from '../src/query/load-coordinator'
import { optionsForCaseType } from '../src/schema/dependencies'
import { buildFileTypeTree, searchFileTypeNodes } from '../src/schema/file-type-tree'
import { resolveInternalIdDisplay } from '../src/schema/resolver'
import { formValuesToFields } from '../src/schema/validators'
import { BundleTemplateRepository } from '../src/query/repository'
import { MemoryBundleRepository, updateBundle } from '../src/storage/query-bundle'

const guid = (suffix: string) => `${suffix}-1111-4111-8111-111111111111`
const client = { ClientInfo: { IsLogin: true, Status: true, Result: false, Message: null } }

function dataOf<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

describe('查询范围', () => {
  it('rejects status flags and accepts a real business filter or date', () => {
    expect(assessQueryScope({ case_type: guid('31d1a147'), fileclass: 'general', is_close: '0' }).sufficient).toBe(false)
    expect(assessQueryScope({ customer_name_vague: '客户A', filetype: '' }).sufficient).toBe(true)
    expect(assessQueryScope({ post_s: '2025-09-15', file_status: '已完成' }).sufficient).toBe(true)
    expect(assessQueryScope({ case_volume: 'PA-1' }).classes.case_volume).toBe('precise')
  })
})

describe('基础字典', () => {
  it('keeps each array shape and treats null as empty', () => {
    const caseType = guid('aaaaaaaa')
    expect(adaptCaseType([{ case_type_id: caseType, case_type: '专利', case_type_code: 'P' }]).options[0]).toMatchObject({
      value: caseType, label: '专利'
    })
    expect(adaptCountry(null).status).toBe('empty')
    expect(adaptCountry([{ value: 'CN', text_zh_cn: '中国', country_code: 'CN' }]).options[0]?.label).toBe('中国')
    expect(adaptCaseType([{ case_type: '专利' }]).status).toBe('invalid')
  })

  it('reads Result false with data, rejects a logged-out payload, and deduplicates cache', async () => {
    let calls = 0
    const fetcher: typeof fetch = async (_url, init) => {
      calls += 1
      const call = new URLSearchParams(String(init?.body)).get('Call')
      const body = call === 'IPGetBasicData'
        ? { ...client, CaseType: [{ case_type_id: guid('bbbbbbbb'), case_type: '专利', case_type_code: 'P' }], Country: null }
        : { ...client, FileStatus: [{ value: 'UN', text_zh_cn: '未处理' }], ProcStatus: null, Case_direction: null, CaseBranchDept: null, DownLoadFileName: null }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    const service = new DictionaryService(new EasyTransport('http://183.36.43.66:88', { fetcher }), new DictionaryCache(1000, () => 1))
    const first = dataOf(await service.loadBasic('user', false))
    const second = dataOf(await service.loadBasic('user', false))
    expect(first.dictionaries.caseType.options[0]?.label).toBe('专利')
    expect(second.dictionaries.country.status).toBe('empty')
    expect(calls).toBe(1)
    await Promise.all([service.loadFlow('user', true), service.loadFlow('user', true)])
    expect(calls).toBe(2)
    const loggedOut = new DictionaryService(new EasyTransport('http://183.36.43.66:88', {
      fetcher: async () => new Response(JSON.stringify({ ClientInfo: { IsLogin: false, Status: true } }), { status: 200 })
    }))
    expect((await loggedOut.loadBasic('user', true)).ok).toBe(false)
  })

  it('parses custom columns and list columns without inventing a colsel', () => {
    const columns = adaptFieldColumns([
      { column_id: 'column_1', column_name: '自定义1', is_enabled: true, control_name: 'text' },
      { column_id: 'column_2', column_name: '自定义2', is_enabled: false }
    ])
    expect(columns.columns.map(item => [item.field, item.enabled])).toEqual([['column1', true], ['column2', false]])
    expect(adaptListColumns(null).colsel).toBeNull()
    expect(adaptListColumns([{ item_value: 'case_volume' }, { item_value: 'file_name' }]).colsel).toBe(';case_volume;file_name;')
  })
})

describe('文件描述树和 Schema', () => {
  const parent = guid('10000000')
  const child = guid('20000000')
  const orphan = guid('30000000')
  const missingParent = guid('40000000')

  it('builds, sorts, searches and reports bad links', () => {
    const tree = buildFileTypeTree([
      { id: child, name: '专利证书(CERT)', pid: parent, seq: 2, tree_level: 2 },
      { id: parent, name: '官方来文', pid: '', seq: 1, tree_level: 1 },
      { id: child, name: '重复', pid: parent, seq: 3, tree_level: 2 },
      { id: orphan, name: '悬空', pid: missingParent, seq: 0, tree_level: 1 },
      { id: parent, name: '环', pid: child, seq: 4, tree_level: 1 }
    ])
    expect(tree.rootIds[0]).toBe(orphan)
    expect(tree.nodes.find(node => node.id === parent)?.childIds).toEqual([child])
    expect(tree.diagnostics.some(item => item.includes('重复'))).toBe(true)
    expect(tree.diagnostics.some(item => item.includes('无效父节点'))).toBe(true)
    expect(searchFileTypeNodes(tree.nodes, '证书')).toEqual([child])
    const cycle = buildFileTypeTree([
      { id: parent, name: '甲', pid: child, seq: 1, tree_level: 1 },
      { id: child, name: '乙', pid: parent, seq: 1, tree_level: 2 }
    ])
    expect(cycle.diagnostics.some(item => item.includes('环形'))).toBe(true)
  })

  it('filters options by case type and does not rewrite unknown ids', () => {
    const caseType = guid('aaaaaaaa')
    const other = guid('bbbbbbbb')
    const options = [
      { value: guid('cccccccc'), label: '发明', metadata: { caseTypeId: caseType, statusClass: 'CASE' } },
      { value: guid('dddddddd'), label: '商标', metadata: { caseTypeId: other, statusClass: 'CASE' } }
    ]
    expect(optionsForCaseType('caseStatus', options, caseType).map(item => item.label)).toEqual(['发明'])
    expect(optionsForCaseType('applyType', options, '')).toEqual([])
    expect(resolveInternalIdDisplay(guid('eeeeeeee'), options).text).toBe('未识别的历史 ID')
    const fields = formValuesToFields({ case_volume: 'PA', __proto__: 'x' } as Record<string, string>)
    expect(fields.case_volume).toBe('PA')
    expect(Object.keys(fields)).toEqual(['case_volume'])
  })
})

describe('模板加载竞态和本地配置', () => {
  it('commits only the latest template load and ignores work after dispose', async () => {
    const coordinator = new TemplateLoadCoordinator()
    const seen: string[] = []
    async function load(name: string, delay: number): Promise<void> {
      const ticket = coordinator.begin()
      await new Promise(resolve => setTimeout(resolve, delay))
      if (coordinator.isCurrent(ticket.id)) seen.push(name)
    }
    const first = load('A', 30)
    const second = load('B', 5)
    await Promise.all([first, second])
    expect(seen).toEqual(['B'])
    const late = load('C', 20)
    coordinator.dispose()
    await late
    expect(seen).toEqual(['B'])
  })

  it('does not overwrite an incompatible bundle and keeps concurrent edits', async () => {
    const locked = new MemoryBundleRepository({ version: 9, templates: [{ id: 'keep' }], customers: [] })
    await expect(updateBundle(locked, bundle => { bundle.templates = [] })).rejects.toThrow(/版本/)
    expect((await locked.load()).writable).toBe(false)
    const open = new MemoryBundleRepository()
    const repository = new BundleTemplateRepository(open)
    const now = '2026-09-24T00:00:00.000Z'
    await Promise.all([1, 2].map(index => repository.save({
      id: `local-${index}`, name: `模板${index}`, source: 'local', queryType: 'FileSearch',
      fields: { case_volume: String(index) }, version: 1, createdAt: now, updatedAt: now
    })))
    expect(await repository.list()).toHaveLength(2)
  })
})
