import { describe, expect, it } from 'vitest'
import { lookupIcFlow } from '../src/customer/ic-flow-lookup'
import { NATIONAL_OUR_TYPE, pctRowsFromTable } from '../src/customer/pct-sheet'
import { applyArbitrationReply, arbitrateDetail, arbitrationBatchSize, checkedSourceSheets, detailLines, iprArbitrationBrief, iprArbitrationWaves, isPctWorkbookSheet, missedSourceSheets, noteForBlankIpr, pctRowsFromWorkbook } from '../src/customer/pct-workbook'
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
  it('进国家有我方文号就用我方案号，没有再用贵方，外观单独一种', () => {
    const parsed = pctRowsFromTable([
      header,
      ['PA1', 'CS-1', '歌尔股份有限公司', '李聪', '', 'PCT进国家阶段官方绝限'],
      ['', 'CS-2', '歌尔股份有限公司', '', '李薇', 'PCT进国家阶段官方绝限'],
      ['PA3', 'CS-3', '歌尔股份有限公司', '', '', '提醒涉外外观申请']
    ], nodes, undefined, 'national')
    expect(parsed.rows.map(row => row.mailTypeLabel)).toEqual([
      NATIONAL_OUR_TYPE,
      '提醒PCT申请进入国家案件（贵方案号）',
      '提醒涉外外观申请（贵方案号）'
    ])
    expect(parsed.rows[1]?.letterKind).toBe('national')
    expect(parsed.rows[2]?.letterKind).toBe('design')
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
    expect(parsed.rows[2]?.mailTypeId).toBe('aaaaaaaa-1111-4111-8111-111111111111')
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
    expect(applied.rows[1]?.mailCc).toBe('王五')
    expect(applied.decisions[1]?.role).toBe('IPR、IPR')
    expect(applied.decisions[1]?.ccRole).toBe('商务')
    expect(applied.rows[2]?.iprName).toBe('')
    expect(applied.decisions[2]?.unsure).toBe(true)
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
