import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { isCustomerProfile, isPctTask } from '../src/customer/guards'
import { pctMailTypeFor } from '../src/customer/mail-flow'
import { buildPctTask, matchSheetCtrlProcs, pctRowsFromTable, summarizePctTask } from '../src/customer/pct-sheet'
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
    if (built.ok) expect(built.task.confirmedProcIds).toEqual(['71d067a3-d1a3-4d4b-87f9-38ea9d96bf71'])
  })
})

describe('xlsx', () => {
  it('读共享字符串和单元格', () => {
    const shared = sharedStringsFromXml('<sst><si><t>我方文号</t></si><si><t>PA1</t></si></sst>')
    const rows = rowsFromSheetXml('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData>', shared)
    expect(rows).toEqual([['我方文号'], ['PA1']])
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
