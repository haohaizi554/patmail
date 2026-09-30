import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { isCustomerProfile, isPctTask } from '../src/customer/guards'
import { pctMailTypeFor } from '../src/customer/mail-flow'
import { resolvePctRuntime } from '../src/workflow/pct-config'
import { applyPctMailTypes, buildPctTask, matchSheetCtrlProcs, pctRowsFromTable, summarizePctTask } from '../src/customer/pct-sheet'
import type { CustomerQueryProfile, PctTaskDraft } from '../src/customer/types'
import { joinCaseVolumes, splitCaseVolumes } from '../src/customer/volume-list'
import { readXlsxRows, rowsFromSheetXml, sharedStringsFromXml } from '../src/customer/xlsx-table'

const sample = 'C:\\Users\\Administrator\\Documents\\WXWork\\1688855905806482\\Cache\\File\\2026-09\\鹏城实验室.xlsx'

function profile(extra: Partial<CustomerQueryProfile> = {}): CustomerQueryProfile {
  return {
    id: 'profile-a',
    name: '鹏城实验室',
    baseTemplateId: 'manual',
    overrides: {},
    enabled: true,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...extra
  }
}

function task(extra: Partial<PctTaskDraft> = {}): PctTaskDraft {
  return {
    workflowId: 'pct-reminder',
    ctrlProcId: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70',
    rows: [{
      ourVolume: 'PA2518728CND',
      customerVolume: 'CS-1',
      customerName: '鹏城实验室',
      contactName: '姜颖',
      iprName: '雷群安',
      procLabel: '提醒申请PCT',
      mailTypeLabel: '提醒申请PCT（贵方案号）-深圳市',
      mailTypeId: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70',
      mailTypeRadioIndex: 1
    }],
    confirmedProcIds: [],
    createdAt: '2026-09-28T00:00:00.000Z',
    ...extra
  }
}

describe('文号分隔', () => {
  it('分号、空格和换行都拆开，提交时用半角分号', () => {
    expect(splitCaseVolumes('PA1；PA2\nPA3 PA1')).toEqual(['PA1', 'PA2', 'PA3'])
    expect(joinCaseVolumes(['PA1', 'PA2'])).toBe('PA1;PA2')
  })
})

describe('PCT 表格', () => {
  it('按表头取出文号，并用热加载的发文类型命名', () => {
    const nodes = [
      { id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方案号）-深圳市' },
      { id: '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092', name: '提醒申请PCT（我方案号）-深圳市' }
    ]
    const parsed = pctRowsFromTable([
      ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项'],
      ['PA1', 'CS-1', '鹏城实验室', '姜颖', '雷群安', '提醒申请PCT'],
      ['PA2', '', '鹏城实验室', '姜颖', '雷群安', '提醒申请PCT']
    ], nodes)
    expect(parsed.rows.map(row => row.mailTypeId)).toEqual([
      pctMailTypeFor({ customerVolume: 'CS-1', ourVolume: 'PA1' }, nodes)?.id,
      pctMailTypeFor({ ourVolume: 'PA2' }, nodes)?.id
    ])
    expect(parsed.rows[1]?.mailTypeRadioIndex).toBe(3)
  })

  it('鹏城专案读技术负责人，去掉括号里的拼音，空行沿用上一行', () => {
    const runtime = resolvePctRuntime({ columns: { leadName: '技术负责人' } })
    const parsed = pctRowsFromTable([
      ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '技术负责人', '邮箱', '处理事项'],
      ['PA1', 'CS-1', '鹏城国家实验室', '高宇', '高宇', '洪仕瀚(hongshh)', 'skip@example.com', '提醒申请PCT'],
      ['PA2', 'CS-2', '鹏城国家实验室', '', '', '', '', '提醒申请PCT']
    ], [], runtime)
    expect(parsed.rows[0]?.leadName).toBe('洪仕瀚')
    expect(parsed.rows[0]?.iprName).toBe('高宇')
    expect(parsed.rows[1]?.leadName).toBe('洪仕瀚')
    expect(parsed.rows[1]?.leadCarried).toBe(true)
    expect(parsed.notice).not.toContain('邮箱')
  })

  it('同一客户后面空着的联系人沿用最近一行', () => {
    const parsed = pctRowsFromTable([
      ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项'],
      ['PA1', 'WT-1', '鹏城国家实验室', '姜颖', '牛乐宏', '提醒申请PCT'],
      ['PA2', 'WT-2', '鹏城国家实验室', '', '', '提醒申请PCT'],
      ['PA3', 'WT-3', '鹏城国家实验室', '', '', '提醒申请PCT'],
      ['PB1', 'WA-1', '另一客户', '王一', '李二', '提醒申请PCT'],
      ['PA4', 'WT-4', '鹏城国家实验室', '', '赵三', '提醒申请PCT'],
      ['PA5', 'WT-5', '鹏城国家实验室', '', '', '提醒申请PCT']
    ])
    expect(parsed.rows.map(row => [row.ourVolume, row.contactName, row.iprName, row.contactCarried ?? '', row.iprCarried ?? ''])).toEqual([
      ['PA1', '姜颖', '牛乐宏', '', ''],
      ['PA2', '姜颖', '牛乐宏', true, true],
      ['PA3', '姜颖', '牛乐宏', true, true],
      ['PB1', '王一', '李二', '', ''],
      ['PA4', '姜颖', '赵三', true, ''],
      ['PA5', '姜颖', '赵三', true, true]
    ])
    expect(parsed.notice).toContain('沿用了该客户最近一行')
  })

  it('套上发文类型后，补出来的联系人仍带着备注', () => {
    const nodes = [
      { id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方案号）-深圳市' },
      { id: '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092', name: '提醒申请PCT（我方案号）-深圳市' }
    ]
    const parsed = pctRowsFromTable([
      ['我方文号', '客户文号', '客户名称', '第一客户联系人', '客户联系人(IPR)', '处理事项'],
      ['PA1', 'WT-1', '鹏城国家实验室', '姜颖', '牛乐宏', '提醒申请PCT'],
      ['PA2', 'WT-2', '鹏城国家实验室', '', '', '提醒申请PCT']
    ], nodes)
    const again = applyPctMailTypes(parsed.rows, nodes)
    expect(again[1]?.contactName).toBe('姜颖')
    expect(again[1]?.iprName).toBe('牛乐宏')
    expect(again[1]?.contactCarried).toBe(true)
    expect(again[1]?.iprCarried).toBe(true)
    expect(again[0]?.contactCarried).toBeUndefined()
    expect(again[0]?.iprCarried).toBeUndefined()
  })

  it('套上发文类型后，技术负责人还在', () => {
    const nodes = [{ id: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70', name: '提醒申请PCT（贵方案号）-深圳市' }]
    const runtime = resolvePctRuntime({ columns: { leadName: '技术负责人' } })
    const parsed = pctRowsFromTable([
      ['我方文号', '客户文号', '客户名称', '客户联系人(IPR)', '技术负责人', '处理事项'],
      ['PA2610008CND', 'WA-1', '鹏城国家实验室', '', '肖锋(xiaof)', '提醒申请PCT'],
      ['PA2610050CND', 'WA-2', '鹏城国家实验室', '雷群安', '', '提醒申请PCT']
    ], nodes, runtime)
    const again = applyPctMailTypes(parsed.rows, nodes, runtime)
    expect(again.map(row => [row.leadName, row.leadCarried ?? '', row.iprName, row.iprCarried ?? ''])).toEqual([
      ['肖锋', '', '', ''],
      ['肖锋', true, '雷群安', '']
    ])
  })

  it('处理事项按名称对上具体项，分类和重名都不选用', () => {
    const leaf = '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70'
    const other = '93f289c5-f3c5-4f6d-a90b-50ac1fb8d092'
    const options = [
      { id: 'folder', label: '提醒申请PCT' },
      { id: leaf, label: '提醒申请PCT', parentId: 'folder' },
      { id: other, label: '补正' }
    ]
    expect(matchSheetCtrlProcs(['提醒申请PCT'], options)).toEqual({ ok: true, ids: leaf, names: ['提醒申请PCT'] })
    expect(matchSheetCtrlProcs(['没有这项'], options).ok).toBe(false)
    expect(matchSheetCtrlProcs(['补正'], [
      { id: leaf, label: '补正' },
      { id: other, label: '补正' }
    ]).ok).toBe(false)
  })

  it('没有我方文号和处理事项列时不组任务', () => {
    expect(pctRowsFromTable([['案件名称'], ['一个案子']]).rows).toEqual([])
  })

  it('任务可以随客户保存，错误的发文类型顺序会被拒绝', () => {
    expect(isCustomerProfile(profile({ querySurface: 'limit', workflowId: 'pct-reminder', limitMailStyle: '1', pctTask: task() }))).toBe(true)
    expect(isPctTask(task({ rows: [{ ...task().rows[0], mailTypeRadioIndex: 2 as 1 }] }))).toBe(false)
    expect(summarizePctTask(task())).toContain('提醒申请PCT（贵方案号）-深圳市')
  })

  it('多种处理事项不能收成一次任务', () => {
    const built = buildPctTask({
      rows: task().rows,
      ctrlProcId: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70,71d067a3-d1a3-4d4b-87f9-38ea9d96bf71',
      confirmedProcIds: [],
      createdAt: '2026-09-29T00:00:00.000Z'
    })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.message).toContain('多种处理事项')
  })

  it('对上一个事项后可以记下任务', () => {
    const built = buildPctTask({
      rows: task().rows,
      ctrlProcId: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70',
      confirmedProcIds: ['not-a-guid', '71d067a3-d1a3-4d4b-87f9-38ea9d96bf71'],
      createdAt: '2026-09-29T00:00:00.000Z'
    })
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.task.confirmedProcIds).toEqual(['71d067a3-d1a3-4d4b-87f9-38ea9d96bf71'])
      expect(built.task.workflowId).toBe('pct-reminder')
    }
    const named = buildPctTask({
      rows: task().rows,
      ctrlProcId: '71d067a3-d1a3-4d4b-87f9-38ea9d96bf70',
      confirmedProcIds: [],
      createdAt: '2026-09-29T00:00:00.000Z',
      workflowId: 'flow-2',
      recipientMode: 'lead'
    })
    expect(named.ok && named.task.workflowId).toBe('flow-2')
    expect(named.ok && named.task.recipientMode).toBe('lead')
  })
})

describe('xlsx', () => {
  it('读共享字符串和单元格', () => {
    const shared = sharedStringsFromXml('<sst><si><t>我方文号</t></si><si><t>PA1</t></si></sst>')
    const rows = rowsFromSheetXml('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData>', shared)
    expect(rows).toEqual([['我方文号'], ['PA1']])
  })

  it('空单元格写成自闭合时，不会把下一格的共享字符串下标当成文字', () => {
    const shared = sharedStringsFromXml([
      '<sst>',
      '<si><t>我方文号</t></si><si><t>客户文号</t></si><si><t>客户名称</t></si>',
      '<si><t>客户联系人(IPR)</t></si><si><t>技术负责人</t></si><si><t>处理事项</t></si>',
      '<si><t>PA2610008CND</t></si><si><t>WA-1</t></si><si><t>鹏城国家实验室</t></si>',
      '<si><t>肖锋(xiaof)</t></si><si><t>提醒申请PCT</t></si>',
      '<si><t>PA2610050CND</t></si><si><t>雷群安</t></si>',
      '</sst>'
    ].join(''))
    const xml = [
      '<sheetData>',
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c><c r="J1" t="s"><v>3</v></c><c r="K1" t="s"><v>4</v></c><c r="N1" t="s"><v>5</v></c></row>',
      '<row r="2"><c r="A2" t="s"><v>6</v></c><c r="B2" t="s"><v>7</v></c><c r="D2" t="s"><v>8</v></c><c r="J2" s="5"/><c r="K2" t="s"><v>9</v></c><c r="N2" t="s"><v>10</v></c></row>',
      '<row r="3"><c r="A3" t="s"><v>11</v></c><c r="B3" t="s"><v>7</v></c><c r="D3" t="s"><v>8</v></c><c r="J3" t="s"><v>12</v></c><c r="K3" s="5"/><c r="N3" t="s"><v>10</v></c></row>',
      '</sheetData>'
    ].join('')
    const parsed = pctRowsFromTable(rowsFromSheetXml(xml, shared), [], resolvePctRuntime({ columns: { leadName: '技术负责人' } }))
    expect(parsed.rows[0]).toMatchObject({ ourVolume: 'PA2610008CND', iprName: '', leadName: '肖锋' })
    expect(parsed.rows[1]).toMatchObject({ ourVolume: 'PA2610050CND', iprName: '雷群安', leadName: '肖锋', leadCarried: true })
    expect(parsed.rows.some(row => row.leadName === '9' || row.iprName === '9')).toBe(false)
  })

  it('能读鹏城实验室这份表', async () => {
    if (!existsSync(sample)) return
    const bytes = await readFile(sample)
    const copy = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(copy).set(bytes)
    const parsed = pctRowsFromTable(await readXlsxRows(copy))
    expect(parsed.rows.length).toBe(81)
    expect(parsed.rows.every(row => row.procLabel === '提醒申请PCT')).toBe(true)
    expect(parsed.rows.some(row => row.mailTypeRadioIndex === 1)).toBe(true)
  })
})
