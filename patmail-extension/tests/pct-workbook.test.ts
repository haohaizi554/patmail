import { describe, expect, it } from 'vitest'
import { lookupIcFlow } from '../src/customer/ic-flow-lookup'
import { NATIONAL_CUSTOMER_TYPE, NATIONAL_OUR_TYPE, NATIONAL_PROC_LABEL, pctRowsFromTable } from '../src/customer/pct-sheet'
import { applyArbitrationReply, arbitrateDetail, arbitrationAllowed, arbitrationBatchSize, checkedSourceSheets, detailLines, iprArbitrationBrief, iprArbitrationWaves, isPctWorkbookSheet, missedSourceSheets, noteForBlankIpr, pctRowsFromWorkbook, pickArbitrationText, readArbitrationDecisions, shouldAutoArbitrate } from '../src/customer/pct-workbook'
import { matchListedCustomer } from '../src/customer/customer-list'
import { caseTextUsable } from '../src/customer/case-arbitration'
import { readXlsxSheets, xlsxBookBytes } from '../src/customer/xlsx-table'
import { DEFAULT_PCT_RUNTIME } from '../src/workflow/pct-config'
import type { ApiResult } from '../src/api/types'

const nodes = [
  { id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方案号）-深圳市' },
  { id: '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092', name: '提醒申请PCT（我方案号）-深圳市' },
  { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: NATIONAL_OUR_TYPE },
  { id: 'bbbbbbbb-1111-4111-8111-111111111111', name: '提醒PCT申请进入国家案件（贵方案号）' },
  { id: 'cccccccc-1111-4111-8111-111111111111', name: '提醒涉外外观申请（贵方案号）' }
]

const header = ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项']

function elementTag(element: string, name: string): string {
  const matched = element.match(new RegExp(`&lt;${name}&gt;([\\s\\S]*?)&lt;/${name}&gt;`))
  return matched?.[1] ?? ''
}

describe('两张表一起读', () => {
  it('进国家有客户文号就用贵方案号，没有客户文号就用我方案号，外观单独一种', () => {
    const parsed = pctRowsFromTable([
      header,
      ['PA1', 'CS-1', '歌尔股份有限公司', '李聪', '', 'PCT进国家阶段官方绝限'],
      ['', 'CS-2', '歌尔股份有限公司', '', '李薇', 'PCT进国家阶段官方绝限'],
      ['PA0', '', '歌尔股份有限公司', '', '', 'PCT进国家阶段官方绝限'],
      ['PA3', 'CS-3', '歌尔股份有限公司', '', '', '提醒涉外外观申请']
    ], nodes, undefined, 'national')
    expect(parsed.rows.map(row => row.mailTypeLabel)).toEqual([
      NATIONAL_CUSTOMER_TYPE,
      NATIONAL_CUSTOMER_TYPE,
      NATIONAL_OUR_TYPE,
      '提醒涉外外观申请（贵方案号）'
    ])
    expect(parsed.rows[2]?.letterKind).toBe('national')
    expect(parsed.rows[3]?.letterKind).toBe('design')
  })

  it('提醒表仍是有客户文号走贵方，连续空 IPR 沿用上一行', () => {
    const parsed = pctRowsFromWorkbook([
      {
        name: '提醒申请PCT',
        rows: [
          header,
          ['PA1', 'CS-1', '宁德时代', '邹学军', '邹学军', '提醒申请PCT'],
          ['PA2', 'CS-2', '宁德时代', '', '', '提醒申请PCT']
        ]
      },
      {
        name: 'PCT进国家阶段官方绝限',
        rows: [
          header,
          ['WO1', 'W-1', '歌尔股份有限公司', '', '', 'PCT进国家阶段官方绝限']
        ]
      },
      {
        name: '提醒处理细节',
        rows: [['歌尔：看案件客户联系人，联系人带微电子的发给李聪']]
      },
      { name: '期限监控', rows: [header, ['SKIP', 'X', '不要读', '', '', '提醒申请PCT']] }
    ], nodes)
    expect(parsed.rows.map(row => row.ourVolume)).toEqual(['PA1', 'PA2', 'WO1'])
    expect(parsed.rows[1]?.iprName).toBe('邹学军')
    expect(parsed.rows[1]?.iprCarried).toBe(true)
    expect(parsed.rows[0]?.mailTypeLabel).toContain('贵方案号')
    expect(parsed.rows[2]?.mailTypeId).toBe('bbbbbbbb-1111-4111-8111-111111111111')
    expect(parsed.rows[2]?.iprNote).toContain('处理细节')
    expect(parsed.notice).toContain('进国家 1 行')
    expect(noteForBlankIpr('季华实验室', detailLines([['季华实验室，发给发明人']]))).toContain('发明人')
    const rules = [
      '处理细节：吉利（每个月单独发），中兴、宁德、荣耀、惠科、中石油-中石油深圳新能源研究院有限公司、中国移动、北京大学不用发',
      '吉利提醒收件人：孙丽敏(橙柚) <limin@example.com>'
    ]
    expect(arbitrateDetail('吉利汽车', rules)).toBe('孙丽敏')
    expect(arbitrateDetail('中兴通讯股份有限公司', rules)).toBe('不用发')
    expect(arbitrateDetail('季华实验室', ['季华实验室，发给发明人'])).toBe('发明人')
    expect(iprArbitrationBrief(parsed.rows)).toContain('仲裁收件人')
    expect(iprArbitrationBrief(parsed.rows)).toContain('客户要求')
    expect(iprArbitrationBrief(parsed.rows)).not.toContain('review_case_fields')
  })

  it('筛选藏起来的行不导入，导出也只有可见行', () => {
    const parsed = pctRowsFromWorkbook([{
      name: '提醒申请PCT',
      hiddenRows: 2,
      rows: [header, ['PA1', 'CS-1', '宁德时代', '', '邹学军', '提醒申请PCT']]
    }], nodes)
    expect(parsed.rows.map(row => row.ourVolume)).toEqual(['PA1'])
    expect(parsed.notice).toContain('隐藏的 2 行没有导入')
    const sheets = checkedSourceSheets(parsed.rows, () => '已核对', DEFAULT_PCT_RUNTIME.columns)
    expect(sheets.flatMap(sheet => sheet.rows.map(row => row[0]))).toEqual([DEFAULT_PCT_RUNTIME.columns.ourVolume, 'PA1'])
  })
})

describe('一件没查成不停下其余', () => {
  it('单件失败记成没读到，登录失败才整批停下', async () => {
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') return { ok: true, data: { ProcInfo: [], Eflow: [] } }
      const element = params.get('Element') ?? ''
      if (element.includes('BAD')) return { ok: false, error: { code: 'HTTP_ERROR', message: '暂时没有返回。' } }
      return {
        ok: true,
        data: { TableRows: [{ case_id: 'aaaaaaaa-1111-4111-8111-111111111111', case_volume: 'PA1' }] }
      }
    }
    const mixed = await lookupIcFlow(
      [{ caseVolume: 'PA1', procLabel: '提醒申请PCT' }, { caseVolume: 'BAD', procLabel: '提醒申请PCT' }],
      post
    )
    expect(mixed.ok).toBe(true)
    if (mixed.ok) {
      expect(mixed.data.items.map(item => item.unread ?? false)).toEqual([false, true])
    }
    const login = await lookupIcFlow(
      [{ caseVolume: 'PA1', procLabel: '提醒申请PCT' }],
      async () => ({ ok: false, error: { code: 'SESSION_EXPIRED', message: '登录已失效。' } })
    )
    expect(login.ok).toBe(false)
  })

  it('网关失败再查一次能对上，流程没读到不算没查成', async () => {
    let searches = 0
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') return { ok: false, error: { code: 'HTTP_ERROR', message: 'EASY 网关异常。', status: 502 } }
      searches += 1
      const element = params.get('Element') ?? ''
      if (element.includes('FLAKY') && searches === 1) return { ok: false, error: { code: 'HTTP_ERROR', message: 'EASY 网关异常。', status: 502 } }
      return {
        ok: true,
        data: { TableRows: [{ case_id: 'aaaaaaaa-1111-4111-8111-111111111111', case_volume: 'FLAKY' }] }
      }
    }
    const mixed = await lookupIcFlow([{ caseVolume: 'FLAKY', procLabel: '提醒申请PCT' }], post)
    expect(mixed.ok).toBe(true)
    if (mixed.ok) {
      expect(mixed.data.items[0]?.unread).toBeUndefined()
      expect(mixed.data.items[0]?.found).toBe(true)
      expect(mixed.data.items[0]?.statusUnread).toBe(true)
    }
  })

  it('我方文号没有时改查客户文号，只差后缀就改成库里的文号', async () => {
    const library = 'aaaaaaaa-1111-4111-8111-111111111111'
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') {
        return {
          ok: true,
          data: {
            ProcInfo: [{ proc_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ctrl_proc: '提醒申请PCT', finish_date: '', proc_status: '' }],
            Eflow: [{ id: 'flow-1', proc_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', eflow_name: '发文', order_by: 2, node_code: 'END' }]
          }
        }
      }
      const element = params.get('Element') ?? ''
      const our = elementTag(element, 'case_volume')
      const customer = elementTag(element, 'case_volume_customer')
      if (our === 'PA2519196CND-YS-放弃复审' && customer === '') return { ok: true, data: { TableRows: [] } }
      if (our === '' && customer === 'PA2519196CND-YS') {
        return { ok: true, data: { TableRows: [{ case_id: library, case_volume: 'PA2519196CND-YS', case_volume_customer: 'PA2519196CND-YS' }] } }
      }
      return { ok: true, data: { TableRows: [] } }
    }
    const found = await lookupIcFlow([{
      caseVolume: 'PA2519196CND-YS-放弃复审',
      customerVolume: 'PA2519196CND-YS',
      procLabel: '提醒申请PCT'
    }], post)
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.data.items[0]?.found).toBe(true)
      expect(found.data.items[0]?.gate).toBe('done')
      expect(found.data.items[0]?.correctedOur).toBe('PA2519196CND-YS')
      expect(found.data.items[0]?.correctedCustomer).toBeUndefined()
    }
  })

  it('客户文号补查对上库里带后缀的我方文号', async () => {
    const library = 'aaaaaaaa-1111-4111-8111-111111111111'
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') {
        return {
          ok: true,
          data: {
            ProcInfo: [{ proc_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ctrl_proc: '提醒申请PCT', finish_date: '2026-09-01', proc_status: '完成' }],
            Eflow: []
          }
        }
      }
      const element = params.get('Element') ?? ''
      const our = elementTag(element, 'case_volume')
      const customer = elementTag(element, 'case_volume_customer')
      if (our === 'PA25117182CND' && customer === '') return { ok: true, data: { TableRows: [] } }
      if (our === '' && customer === 'HC20251191') {
        return {
          ok: true,
          data: { TableRows: [{ case_id: library, case_volume: 'PA25117182CND-米茅', case_volume_customer: 'HC20251191' }] }
        }
      }
      return { ok: true, data: { TableRows: [] } }
    }
    const found = await lookupIcFlow([{
      caseVolume: 'PA25117182CND',
      customerVolume: 'HC20251191',
      procLabel: '提醒申请PCT'
    }], post)
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.data.items[0]?.found).toBe(true)
      expect(found.data.items[0]?.correctedOur).toBe('PA25117182CND-米茅')
      expect(found.data.items[0]?.correctedCustomer).toBeUndefined()
      expect(found.data.items[0]?.skipSend).toBe(true)
    }
    const onlyCustomer = await lookupIcFlow([{
      caseVolume: 'HC20251191',
      customerVolume: 'HC20251191',
      procLabel: '提醒申请PCT'
    }], post)
    expect(onlyCustomer.ok).toBe(true)
    if (onlyCustomer.ok) {
      expect(onlyCustomer.data.items[0]?.found).toBe(true)
      expect(onlyCustomer.data.items[0]?.correctedOur).toBeUndefined()
    }
  })

  it('8 个文号并成一次查询，我方文号结果里已经带上客户文号就不再补查', async () => {
    const calls: string[] = []
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') return { ok: true, data: { ProcInfo: [], Eflow: [] } }
      calls.push(`${params.get('pageSize')}:${elementTag(params.get('Element') ?? '', 'case_volume')}`)
      const volumes = elementTag(params.get('Element') ?? '', 'case_volume').split(';')
      return {
        ok: true,
        data: {
          TableRows: volumes.map((volume, index) => ({
            case_id: `aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
            case_volume: volume,
            case_volume_customer: `CS-${index + 1}`
          }))
        }
      }
    }
    const found = await lookupIcFlow(Array.from({ length: 8 }, (_, index) => ({
      caseVolume: `PA${index + 1}`,
      customerVolume: `CS-${index + 1}`,
      procLabel: '提醒申请PCT'
    })), post)
    expect(found.ok).toBe(true)
    expect(calls).toEqual(['50:PA1;PA2;PA3;PA4;PA5;PA6;PA7;PA8'])
    if (found.ok) expect(found.data.items.every(item => item.found)).toBe(true)
  })

  it('我方文号查回来的行已经对上客户文号时，不再发第二次查询', async () => {
    let searches = 0
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') return { ok: true, data: { ProcInfo: [], Eflow: [] } }
      searches += 1
      const our = elementTag(params.get('Element') ?? '', 'case_volume')
      expect(our).toBe('PA25111975CN')
      return {
        ok: true,
        data: {
          TableRows: [{
            case_id: 'aaaaaaaa-1111-4111-8111-111111111111',
            case_volume: 'PA25111975CND-YS-撤销驳回',
            case_volume_customer: 'HC20251191'
          }]
        }
      }
    }
    const found = await lookupIcFlow([{
      caseVolume: 'PA25111975CN',
      customerVolume: 'HC20251191',
      procLabel: '提醒申请PCT'
    }], post)
    expect(searches).toBe(1)
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.data.items[0]?.found).toBe(true)
      expect(found.data.items[0]?.correctedOur).toBeUndefined()
    }
  })

  it('没有客户文号时，模糊查询对上带后缀的库内文号并修正', async () => {
    const library = 'aaaaaaaa-1111-4111-8111-111111111111'
    const calls: string[] = []
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') return { ok: true, data: { ProcInfo: [], Eflow: [] } }
      const fuzzy = params.get('is_fuzzy_query_case_volume') ?? ''
      const our = elementTag(params.get('Element') ?? '', 'case_volume')
      calls.push(`${fuzzy}:${our}`)
      if (fuzzy === 'true' && our === 'CPA25113388CN') {
        return { ok: true, data: { TableRows: [{ case_id: library, case_volume: 'CPA25113388CN（结案）' }] } }
      }
      if (fuzzy === 'true' && our === 'QWPA25110732CN') {
        return { ok: true, data: { TableRows: [{ case_id: library, case_volume: 'QWPA25110732CN-TB-YS' }] } }
      }
      return { ok: true, data: { TableRows: [] } }
    }
    const found = await lookupIcFlow([
      { caseVolume: 'CPA25113388CN', procLabel: '提醒申请PCT' },
      { caseVolume: 'QWPA25110732CN', procLabel: '提醒申请PCT' }
    ], post)
    expect(found.ok).toBe(true)
    expect(calls[0]).toBe('false:CPA25113388CN;QWPA25110732CN')
    expect(calls.slice(1).sort()).toEqual(['true:CPA25113388CN', 'true:QWPA25110732CN'])
    if (found.ok) {
      expect(found.data.items[0]?.found).toBe(true)
      expect(found.data.items[0]?.correctedOur).toBe('CPA25113388CN（结案）')
      expect(found.data.items[1]?.correctedOur).toBe('QWPA25110732CN-TB-YS')
    }
  })

  it('模糊结果不是唯一后缀，或已经有客户文号时，不再模糊对上', async () => {
    const calls: string[] = []
    const post = async (operation: 'icSearch' | 'caseBusFlow', params: URLSearchParams): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') return { ok: true, data: { ProcInfo: [], Eflow: [] } }
      const fuzzy = params.get('is_fuzzy_query_case_volume') ?? ''
      const our = elementTag(params.get('Element') ?? '', 'case_volume')
      const customer = elementTag(params.get('Element') ?? '', 'case_volume_customer')
      calls.push(`${fuzzy}:${our}:${customer}`)
      if (fuzzy === 'true' && our === 'CW1PA25113297CN') {
        return {
          ok: true,
          data: {
            TableRows: [
              { case_id: 'aaaaaaaa-1111-4111-8111-111111111111', case_volume: 'CW1PA25113297CN-A' },
              { case_id: 'bbbbbbbb-1111-4111-8111-111111111111', case_volume: 'CW1PA25113297CN-优' }
            ]
          }
        }
      }
      if (fuzzy === 'true' && our === 'PA25111791CN') {
        return { ok: true, data: { TableRows: [{ case_id: 'cccccccc-1111-4111-8111-111111111111', case_volume: 'PA25111791CNX' }] } }
      }
      return { ok: true, data: { TableRows: [] } }
    }
    const found = await lookupIcFlow([
      { caseVolume: 'CW1PA25113297CN', procLabel: '提醒申请PCT' },
      { caseVolume: 'PA25111791CN', procLabel: '提醒申请PCT' },
      { caseVolume: 'CPA25111897CN', customerVolume: 'HC1', procLabel: '提醒申请PCT' }
    ], post)
    expect(found.ok).toBe(true)
    expect(calls.some(call => call.startsWith('true:CPA25111897CN'))).toBe(false)
    expect(calls.filter(call => call.startsWith('true:')).sort()).toEqual([
      'true:CW1PA25113297CN:',
      'true:PA25111791CN:'
    ])
    if (found.ok) {
      expect(found.data.items[0]?.found).toBe(false)
      expect(found.data.items[0]?.correctedOur).toBeUndefined()
      expect(found.data.items[1]?.found).toBe(false)
      expect(found.data.items[2]?.found).toBe(false)
    }
  })

  it('没有子流程且事项已完成时标不用发', async () => {
    const post = async (operation: 'icSearch' | 'caseBusFlow'): Promise<ApiResult<unknown>> => {
      if (operation === 'caseBusFlow') {
        return {
          ok: true,
          data: {
            ProcInfo: [{ proc_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ctrl_proc: '提醒申请PCT', finish_date: '2026-09-01', proc_status: '完成' }],
            Eflow: []
          }
        }
      }
      return { ok: true, data: { TableRows: [{ case_id: 'aaaaaaaa-1111-4111-8111-111111111111', case_volume: 'PA1' }] } }
    }
    const found = await lookupIcFlow([{ caseVolume: 'PA1', procLabel: '提醒申请PCT' }], post)
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.data.items[0]?.skipSend).toBe(true)
      expect(found.data.items[0]?.gate).toBe('open')
      expect(found.data.items[0]?.uncontrolled).toBeUndefined()
    }
  })
})

function gap(ourVolume: string, customerName: string, note = ''): import('../src/customer/types').PctTaskRow {
  return {
    ourVolume,
    customerVolume: '',
    customerName,
    contactName: '',
    iprName: '',
    procLabel: '提醒申请PCT',
    mailTypeLabel: '提醒申请PCT（贵方案号）',
    ...(note ? { iprNote: note } : {})
  }
}

describe('仲裁交给本地模型时分批', () => {
  it('同一客户并成一条，短说明一次三家，长说明一次一家', () => {
    const short = iprArbitrationWaves([
      gap('A1', '歌尔'),
      gap('A2', '歌尔'),
      gap('B1', '宁德'),
      gap('C1', '中兴'),
      gap('D1', '荣耀')
    ])
    expect(short).toHaveLength(2)
    expect(short[0]).toContain('第 1/2 批')
    expect(short[0]).toContain('我方文号 A1')
    expect(short[0]).toContain('我方文号 A2')
    expect(short[0]).toContain('客户要求')
    expect(short[0]).toContain('每一行单独裁')
    expect(short[0]).toContain('身份')
    expect(short[0]).toContain('抄送身份')
    expect(short[0]).toContain('技术联系人')
    expect(short[0]).not.toContain('技术负责人、商务')
    expect(short[0]).not.toContain('结论覆盖')
    expect(short[0]).not.toContain('D1')
    expect(short[0]).not.toContain('review_case_fields')
    expect(short[1]).toContain('荣耀')
    const longNote = '处理细节：'.padEnd(130, '甲')
    expect(arbitrationBatchSize([longNote, longNote])).toBe(1)
    expect(iprArbitrationWaves([gap('A1', '歌尔', longNote), gap('B1', '宁德', longNote)])).toHaveLength(2)
    expect(iprArbitrationBrief([gap('A1', '歌尔')], { 歌尔: '每月单独发给孙丽敏' })).toContain('每月单独发给孙丽敏')
    const withCase = iprArbitrationBrief([gap('A1', '歌尔')], { 歌尔: '客户要求：发给李聪' }, { A1: '案件字段：文号 A1\n案件页：\n案件名称：样例' })
    expect(withCase).toContain('著录项目')
    expect(withCase).toContain('案件名称：样例')
    expect(withCase).not.toContain('还有')
  })

  it('默认没要求时拿不准交给全选，开了才允许写技术联系人', () => {
    const byDefault = iprArbitrationWaves([gap('A1', '歌尔')])
    expect(byDefault[0]).toContain('全选联系人')
    expect(byDefault[0]).toContain('不要因为本批的兜底规则而漏写')
    expect(byDefault[0]).toContain('客户要求点名了技术联系人也照样写')
    expect(byDefault[0]).toContain('依据只写「客户要求没有指定发给谁」')
    expect(byDefault[0]).toContain('不要写「按著录项目主送技术联系人」')
    expect(byDefault[0]).toContain('只发业务')
    expect(byDefault[0]).toContain('不用发')
    expect(byDefault[0]).toContain('不用发涉外提醒')
    expect(byDefault[0]).toContain('单独写了 PCT 提醒')
    expect(byDefault[0]).toContain('提醒 PCT')
    expect(byDefault[0]).not.toContain('收件人只写著录项目或表格里的技术联系人')
    const iprOnly = iprArbitrationWaves([gap('A1', '歌尔')], {}, {}, { iprOnly: true })
    expect(iprOnly[0]).toContain('收件人只写著录项目或表格里的技术联系人')
    expect(iprOnly[0]).not.toContain('全选联系人')
  })

  it('按文号写回，拿不准的不填', () => {
    const rows = [gap('PA2519006CND', '华润怡宝'), gap('PA2518902CND', '唯品会'), gap('PA2518903CND', '唯品会')]
    const applied = applyArbitrationReply(rows, [
      '文号 PA2519006CND｜收件人 李英｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 第一客户联系人',
      '文号 PA2518902CND｜收件人 李聪、郭旭｜身份 IPR、IPR｜抄送 王五｜抄送身份 商务｜依据 微电子联系人',
      '文号 PA2518903CND｜拿不准｜依据 第一客户联系人和客户要求对不上'
    ].join('\n'))
    expect(applied.written).toBe(2)
    expect(applied.unsure).toBe(1)
    expect(applied.rows[0]?.iprName).toBe('李英')
    expect(applied.rows[0]?.iprArbitrated).toBe(true)
    expect(applied.rows[0]?.mailCc).toBeUndefined()
    expect(applied.decisions[0]?.role).toBe('客户联系人')
    expect(applied.rows[1]?.iprName).toBe('李聪、郭旭')
    expect(applied.rows[1]?.mailCc).toBeUndefined()
    expect(applied.decisions[1]?.role).toBe('IPR、IPR')
    expect(applied.decisions[1]?.cc).toBe('')
    expect(applied.decisions[1]?.ccRole).toBe('')
    expect(applied.rows[2]?.iprName).toBe('')
    expect(applied.decisions[2]?.unsure).toBe(true)
    const bracketed = applyArbitrationReply(rows, [
      '文号 <PA2519006CND>｜收件人 <李英>｜身份 <客户联系人>｜抄送 <无>｜抄送身份 <无>｜依据 <第一客户联系人>'
    ].join('\n'))
    expect(bracketed.written).toBe(1)
    expect(bracketed.rows[0]?.iprName).toBe('李英')
    expect(bracketed.rows[1]?.iprName).toBe('')
  })

  it('同文号两种事项靠事项列分开写回，没有事项列又不唯一就不写', () => {
    const remind = { ...gap('PA1', '甲客户'), procLabel: '提醒申请PCT' }
    const national = { ...gap('PA1', '甲客户'), procLabel: NATIONAL_PROC_LABEL, mailTypeLabel: NATIONAL_CUSTOMER_TYPE }
    const low = [
      '空 PA1｜事项 提醒申请PCT｜收件人 李英｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 客户要求主送李英',
      '空 PA1｜事项 ' + NATIONAL_PROC_LABEL + '｜不用发｜依据 客户要求不发进国家提醒'
    ].join('\n')
    const split = applyArbitrationReply([remind, national], low)
    expect(split.rows[0]?.iprName).toBe('李英')
    expect(split.rows[0]?.procLabel).toBe('提醒申请PCT')
    expect(split.rows[1]?.iprName).toBe('不用发')
    expect(split.rows[1]?.iprArbitrated).toBe(true)

    const bare = applyArbitrationReply([remind, national], [
      '空 PA1｜收件人 李英｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 客户要求主送李英',
      '空 PA1｜收件人 王强｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 客户要求主送王强'
    ].join('\n'))
    // 没有事项列，同文号对上两条结论分不出是哪一行，宁可不写也不串行。
    expect(bare.rows.every(row => !row.iprName)).toBe(true)

    const single = applyArbitrationReply([remind], '空 PA1｜收件人 李英｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 客户要求主送李英')
    expect(single.rows[0]?.iprName).toBe('李英')
  })

  it('核对没结束不能仲裁，整表结束后才按开关自动开始', () => {
    expect(arbitrationAllowed('idle')).toBe(false)
    expect(arbitrationAllowed('run')).toBe(false)
    expect(arbitrationAllowed('fail')).toBe(false)
    expect(arbitrationAllowed('done')).toBe(true)
    expect(shouldAutoArbitrate({ fullCheck: true, phase: 'done', enabled: true, gaps: 2, asking: false })).toBe(true)
    expect(shouldAutoArbitrate({ fullCheck: true, phase: 'run', enabled: true, gaps: 2, asking: false })).toBe(false)
    expect(shouldAutoArbitrate({ fullCheck: false, phase: 'done', enabled: true, gaps: 2, asking: false })).toBe(false)
    expect(shouldAutoArbitrate({ fullCheck: true, phase: 'done', enabled: false, gaps: 2, asking: false })).toBe(false)
    expect(shouldAutoArbitrate({ fullCheck: true, phase: 'done', enabled: true, gaps: 0, asking: false })).toBe(false)
    expect(shouldAutoArbitrate({ fullCheck: true, phase: 'done', enabled: true, gaps: 2, asking: true })).toBe(false)
  })

  it('商务和登录人不写回收件人，没有技术联系人就留空', () => {
    const rows = [gap('PA1', '海目星'), gap('PA2', '北理'), gap('PA3', '澳大'), gap('PA4', '安易')]
    const applied = applyArbitrationReply(rows, [
      '文号 PA1｜收件人 杨智银、李小艳｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 客户要求主送这两位客户联系人',
      '文号 PA2｜收件人 郑建波｜身份 技术负责人｜抄送 无｜抄送身份 无｜依据 著录项目指定郑建波为技术联系人',
      '文号 PA3｜收件人 陈冠宇｜身份 商务｜抄送 无｜抄送身份 无｜依据 客户要求邮件只发业务',
      '文号 PA4｜收件人 余祖｜身份 客户联系人｜抄送 黄萱燕、登录人｜抄送身份 客户联系人、登录人｜依据 客户要求主送余祖并抄送黄萱燕'
    ].join('\n'))
    expect(applied.rows[0]?.iprName).toBe('杨智银、李小艳')
    expect(applied.rows[0]?.iprArbitrated).toBe(true)
    expect(applied.rows[0]?.mailCc).toBeUndefined()
    expect(applied.rows[1]?.iprName).toBe('郑建波')
    expect(applied.decisions.find(item => item.volume === 'PA2')?.role).toBe('IPR')
    expect(applied.rows[2]?.iprName).toBe('')
    expect(applied.rows[2]?.iprArbitrated).toBeUndefined()
    expect(applied.decisions.find(item => item.volume === 'PA3')?.unsure).toBe(true)
    expect(applied.rows[3]?.iprName).toBe('余祖')
    expect(applied.rows[3]?.mailCc).toBe('黄萱燕')
    expect(applied.decisions.find(item => item.volume === 'PA4')?.ccRole).toBe('客户联系人')
  })

  it('不发提醒和只发业务写回表格，不当成拿不准', () => {
    const rows = [gap('PA1', '三一重能'), gap('PA2', '城市公共安全')]
    const applied = applyArbitrationReply(rows, [
      '空 PA1｜只发业务｜依据 客户要求所有邮件只发业务，不要发给客户',
      '空 PA2｜不用发｜依据 客户要求不发PCT提醒'
    ].join('\n'))
    expect(applied.written).toBe(2)
    expect(applied.unsure).toBe(0)
    expect(applied.rows[0]?.iprName).toBe('只发业务')
    expect(applied.rows[0]?.iprArbitrated).toBe(true)
    expect(applied.rows[1]?.iprName).toBe('不用发')
    expect(applied.rows[1]?.iprArbitrated).toBe(true)
    const labeled = applyArbitrationReply(rows, '文号 PA1｜收件人 只发业务｜身份 无｜抄送 无｜抄送身份 无｜依据 只发业务蔡健中')
    expect(labeled.rows[0]?.iprName).toBe('只发业务')
    expect(labeled.decisions[0]?.unsure).toBe(false)
  })

  it('没开只写技术联系人时，未指定却按著录项目写人的行改成拿不准', () => {
    const reply = [
      '空 PA25113244CN｜收件人 王金宝｜身份 IPR｜抄送 无｜抄送身份 无｜依据 客户要求未指定此案PCT提醒收件人，按著录项目主送技术联系人',
      '空 QPA25114402CN｜只发业务｜依据 著录项目仅含业务人员且客户要求未指定PCT提醒收件人'
    ].join('\n')
    const held = applyArbitrationReply([gap('PA25113244CN', '深大'), gap('QPA25114402CN', '余昊')], reply)
    expect(held.written).toBe(0)
    expect(held.unsure).toBe(2)
    expect(held.rows.every(row => !row.iprName)).toBe(true)
    const allowed = applyArbitrationReply([gap('PA25113244CN', '深大')], reply, { iprOnly: true })
    expect(allowed.written).toBe(1)
    expect(allowed.rows[0]?.iprName).toBe('王金宝')
  })

  it('短总结里的「文号」不盖过真正的裁决行', () => {
    const lines = [
      '文号为PA2519006CND｜收件人 李英｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 第一客户联系人',
      '文号是PA2518902CND｜收件人 李聪｜身份 IPR｜抄送 无｜抄送身份 无｜依据 微电子联系人'
    ].join('\n')
    const summary = '已按文号裁完这一批。'
    const picked = pickArbitrationText([summary, `${lines}\n\n${summary}`, lines])
    expect(readArbitrationDecisions(picked).map(item => item.volume)).toEqual(['PA2519006CND', 'PA2518902CND'])
    const packed = applyArbitrationReply(
      [gap('PA1', '华润怡宝'), gap('PA2', '唯品会')],
      '文号为PA1｜收件人 杨智银｜身份 客户联系人｜抄送 无｜抄送身份 无｜依据 客户要求 文号是PA2｜收件人 郑建波｜身份 IPR｜抄送 无｜抄送身份 无｜依据 著录项目指定技术联系人'
    )
    expect(packed.written).toBe(2)
    expect(packed.rows[0]?.iprName).toBe('杨智银')
    expect(packed.rows[1]?.iprName).toBe('郑建波')
  })

  it('客户文号加我方文号的回复整批读回，英文词不算文号', () => {
    const reply = [
      '文号 being 还没定。',
      'HYMI0089 PA25213828CN｜拿不准｜依据 客户要求没有指定发给谁',
      'HYMI0090 PZ25213909CN｜拿不准｜依据 客户要求没有指定发给谁',
      '空 CW1PZ2528270CN｜收件人 金超、陈垣静｜身份 发明人、发明人｜抄送 黄慧燕｜抄送身份 客户联系人｜依据 客户要求明确主送金超、陈垣静，抄送黄慧燕',
      '空 PA25113213CN-优｜拿不准｜依据 客户要求没有指定发给谁',
      '空 QPA25114402CN｜拿不准｜依据 客户要求没有指定发给谁'
    ].join('\n')
    const picked = pickArbitrationText(['已按文号裁完，being 只是说明。', reply])
    const applied = applyArbitrationReply(
      [gap('PA25213828CN', '海目'), gap('PZ25213909CN', '海目'), gap('CW1PZ2528270CN', '海目'), gap('PA25113213CN-优', '海目'), gap('QPA25114402CN', '海目')],
      picked
    )
    expect(applied.decisions.map(item => item.volume)).toEqual([
      'PA25213828CN', 'PZ25213909CN', 'CW1PZ2528270CN', 'PA25113213CN-优', 'QPA25114402CN'
    ])
    expect(applied.decisions.filter(item => item.unsure)).toHaveLength(4)
    expect(applied.decisions[0]?.reason).toBe('客户要求没有指定发给谁')
    const leaked = "HYMI0089 PA25213828CN｜拿不准｜依据 客户要求没有指定发给谁` to be precise, but the prompt says `文号 我方文号`. I'll just output exactly as formatted in the successful previous batch."
    expect(readArbitrationDecisions(leaked)[0]?.reason).toBe('客户要求没有指定发给谁')
    expect(applied.written).toBe(1)
    expect(applied.rows[2]?.iprName).toBe('金超、陈垣静')
    expect(applied.rows[2]?.mailCc).toBe('黄慧燕')
    expect(applied.decisions[2]?.role).toBe('发明人、发明人')
    expect(applied.decisions[2]?.ccRole).toBe('客户联系人')
    expect(applied.decisions.some(item => item.volume === 'being')).toBe(false)
  })

  it('客户名单对不上多家时不猜，著录项目空文不拿去仲裁', () => {
    const listed = matchListedCustomer('华润怡宝', [{ id: '11111111-1111-4111-8111-111111111111', name: '华润怡宝' }])
    expect(listed && listed !== 'many' ? listed.name : '').toBe('华润怡宝')
    expect(matchListedCustomer('招商银行', [
      { id: '11111111-1111-4111-8111-111111111111', name: '招商银行-信息技术部' },
      { id: '22222222-2222-4222-8222-222222222222', name: '招银理财有限责任公司（招商银行）' }
    ])).toBe('many')
    expect(caseTextUsable('案件字段：文号 PA1\n案件要求：没有读到要求。\n发明人：没有读到发明人。\n案件页：没有读到基本信息。')).toBe(false)
    expect(caseTextUsable('案件字段：文号 PA1\n案件要求：没有读到要求。\n发明人：张三\n案件页：没有读到基本信息。')).toBe(true)
  })
})

describe('查不到的行按源表导出', () => {
  it('提醒和进国家分开，沿用的称呼不写回源列', () => {
    const found = gap('PA1', '歌尔')
    found.customerVolume = 'HC1'
    const missing = gap('PA2', '歌尔')
    missing.customerVolume = 'HC2'
    missing.iprName = '刘彤彤'
    missing.iprCarried = true
    const unread = gap('WO1', '歌尔')
    unread.letterKind = 'national'
    unread.procLabel = 'PCT进国家阶段官方绝限'
    const sheets = missedSourceSheets(
      [found, missing, unread],
      row => row.ourVolume === 'PA1' ? '有' : row.ourVolume === 'WO1' ? '没查成' : '库里没有',
      DEFAULT_PCT_RUNTIME.columns
    )
    expect(sheets.map(sheet => sheet.name)).toEqual(['提醒申请PCT', 'PCT进国家阶段官方绝限'])
    expect(sheets[0]?.rows[0]).toEqual(['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项', '查询结果'])
    expect(sheets[0]?.rows[1]).toEqual(['PA2', 'HC2', '歌尔', '', '', '提醒申请PCT', '库里没有'])
    expect(sheets[1]?.rows[1]?.[0]).toBe('WO1')
    expect(sheets[1]?.rows[1]?.at(-1)).toBe('没查成')
  })

  it('核对完的表在原列后面加审核状态', () => {
    const national = gap('WO1', '歌尔')
    national.letterKind = 'national'
    const sheets = checkedSourceSheets(
      [gap('PA1', '歌尔'), national],
      row => row.ourVolume === 'WO1' ? '还没提交审核' : '已经审核通过',
      DEFAULT_PCT_RUNTIME.columns
    )
    expect(sheets[0]?.rows[0]?.at(-1)).toBe('审核状态')
    expect(sheets[0]?.rows[1]).toEqual(['PA1', '', '歌尔', '', '', '提醒申请PCT', '已经审核通过'])
    expect(sheets[1]?.rows[1]?.at(-1)).toBe('还没提交审核')
  })
})

describe('大表导入', () => {
  it('只解开提醒、进国家和处理细节，对不上名字时仍读第一张', async () => {
    const picked = await readXlsxSheets(xlsxBookBytes([
      { name: '提醒申请PCT', rows: [header, ['PA1', 'C1', '歌尔', '', '李', '提醒申请PCT']] },
      { name: '期限监控', rows: [header, ['SKIP', '', '', '', '', '']] },
      { name: '提醒处理细节', rows: [['客户', '说明'], ['歌尔', '主送：王五']] }
    ]), isPctWorkbookSheet)
    expect(picked.map(item => item.name)).toEqual(['提醒申请PCT', '提醒处理细节'])
    const first = await readXlsxSheets(xlsxBookBytes([
      { name: '鹏城', rows: [header, ['PA9', '', '鹏城', '', '', '提醒申请PCT']] }
    ]), isPctWorkbookSheet)
    expect(first.map(item => item.name)).toEqual(['鹏城'])
  })
})
