import { describe, expect, it } from 'vitest'
import { lookupIcFlow } from '../src/customer/ic-flow-lookup'
import { NATIONAL_OUR_TYPE, pctRowsFromTable } from '../src/customer/pct-sheet'
import { arbitrateDetail, arbitrationBatchSize, detailLines, iprArbitrationBrief, iprArbitrationWaves, isPctWorkbookSheet, missedSourceSheets, noteForBlankIpr, pctRowsFromWorkbook } from '../src/customer/pct-workbook'
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
    expect(iprArbitrationBrief(parsed.rows)).toContain('review_case_fields')
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
    expect(short[0]).toContain('先查我方文号 A1')
    expect(short[0]).toContain('A1、A2')
    expect(short[0]).not.toContain('D1')
    expect(short[1]).toContain('荣耀')
    const longNote = '处理细节：'.padEnd(130, '甲')
    expect(arbitrationBatchSize([longNote, longNote])).toBe(1)
    expect(iprArbitrationWaves([gap('A1', '歌尔', longNote), gap('B1', '宁德', longNote)])).toHaveLength(2)
    expect(iprArbitrationBrief([gap('A1', '歌尔')])).toContain('review_case_fields')
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
