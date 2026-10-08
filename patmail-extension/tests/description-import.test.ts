import { describe, expect, it } from 'vitest'
import { readXlsxRows, xlsxBytes } from '../src/customer/xlsx-table'
import { mappingExportRows, mergeImportedMappings } from '../src/mail/rules/description-import'
import type { DescriptionMailTypeMapping } from '../src/mail/types'

const certificate = 'cccccccc-1111-4111-8111-111111111111'
const notice = 'dddddddd-1111-4111-8111-111111111111'
const parent = 'eeeeeeee-1111-4111-8111-111111111111'
const other = 'ffffffff-1111-4111-8111-111111111111'
const descriptionId = 'abababab-1111-4111-8111-111111111111'

const types = [
  { id: parent, name: '通知书', parentId: '' },
  { id: certificate, name: '专利电子证书', parentId: parent },
  { id: notice, name: '办理登记手续通知书', parentId: parent },
  { id: other, name: '证书', parentId: '' }
]

function saved(text: string, mailTypeId = certificate, extra: Partial<DescriptionMailTypeMapping> = {}): DescriptionMailTypeMapping {
  return {
    id: `keep-${text}`,
    fileDescriptionText: text,
    mailTypeId,
    mailTypeName: '专利电子证书',
    enabled: true,
    version: 3,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra
  }
}

function merge(rows: string[][], mappings: DescriptionMailTypeMapping[] = [], mailTypes = types) {
  let serial = 0
  return mergeImportedMappings(mappings, rows, mailTypes, {
    now: '2026-10-03T00:00:00.000Z',
    createId: () => `new-${serial += 1}`
  })
}

describe('文件描述映射导入', () => {
  it('认表头别名、路径和树里的名称，并跳过对不上的行', () => {
    const result = merge([
      ['对照表'],
      ['来文描述', '备注', '发文类型名称'],
      ['专利证书', '', '通知书 / 专利电子证书'],
      ['登记手续', '', '办理登记手续通知书'],
      ['未知文件', '', '没有这种类型'],
      ['', '', '']
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.added).toBe(2)
    expect(result.mappings.map(item => [item.fileDescriptionText, item.mailTypeId])).toEqual([
      ['专利证书', certificate],
      ['登记手续', notice]
    ])
    expect(result.mappings[0]).toMatchObject({ id: 'new-1', enabled: true, version: 1, updatedAt: '2026-10-03T00:00:00.000Z' })
    expect(result.notice).toContain('新增 2 条。')
    expect(result.notice).toContain('没有对上')
  })

  it('同一份表格再导入一次不会新增，也不会改已有映射', () => {
    const current = [saved('专利证书')]
    const table = [
      ['文件描述', '发文类型'],
      ['专利证书', '专利电子证书'],
      ['专利证书', '专利电子证书'],
      ['  专利证书  ', '专利电子证书']
    ]
    const once = merge(table, current)
    expect(once.ok && once.added).toBe(0)
    if (!once.ok) return
    expect(once.mappings).toBe(current)
    expect(once.notice).toContain('已有 1 条')
    expect(once.notice).toContain('相同的 2 条已去掉')
    const again = merge(table, once.mappings)
    expect(again.ok && again.added).toBe(0)
    if (!again.ok) return
    expect(again.mappings).toBe(current)
    expect(current[0]).toMatchObject({ version: 3, mailTypeId: certificate })
  })

  it('同一描述已经对应另一个类型时不覆盖，表格里的后一种也不写入', () => {
    const current = [saved('专利证书', certificate)]
    const result = merge([
      ['文件描述', '发文类型'],
      ['专利证书', '办理登记手续通知书'],
      ['专利证书', '专利电子证书'],
      ['新文件', '办理登记手续通知书'],
      ['新文件', '专利电子证书']
    ], current)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.added).toBe(1)
    expect(result.mappings).toHaveLength(2)
    expect(result.mappings[0]).toBe(current[0])
    expect(result.mappings[1]).toMatchObject({ fileDescriptionText: '新文件', mailTypeId: notice })
    expect(result.notice).toContain('已经对应另一个发文类型')
    expect(result.notice).toContain('后出现的没有写入')
  })

  it('重名时用具体项，对上多项或名称和编号不一致时不写入', () => {
    const duplicated = [
      { id: parent, name: '证书', parentId: '' },
      { id: certificate, name: '证书', parentId: parent },
      { id: notice, name: '证书', parentId: '' }
    ]
    const preferred = merge([
      ['描述', '类型'],
      ['专利证书', '证书']
    ], [], [duplicated[0], duplicated[1]])
    expect(preferred.ok && preferred.mappings[0]?.mailTypeId).toBe(certificate)

    const ambiguous = merge([
      ['文件描述', '发文类型'],
      ['专利证书', '证书']
    ], [], duplicated)
    expect(ambiguous.ok && ambiguous.added).toBe(0)
    if (!ambiguous.ok) return
    expect(ambiguous.notice).toContain('对上了多项')

    const mismatched = merge([
      ['文件描述', '发文类型', '发文类型ID'],
      ['专利证书', '办理登记手续通知书', certificate]
    ])
    expect(mismatched.ok && mismatched.added).toBe(0)
    if (!mismatched.ok) return
    expect(mismatched.notice).toContain('名称和编号不一致')
  })

  it('没有表头时按内容认出类型列，编号列按原站编号去重', () => {
    const positional = merge([
      ['专利证书', '专利电子证书'],
      ['登记手续', '办理登记手续通知书']
    ])
    expect(positional.ok && positional.added).toBe(2)

    const upper = descriptionId.toUpperCase()
    const current = [saved('忽略文本', certificate, { fileDescriptionId: upper, fileDescriptionText: '旧说法' })]
    const byId = merge([
      ['文件描述ID', '文件描述', '发文类型ID'],
      [descriptionId, '新说法', certificate]
    ], current)
    expect(byId.ok && byId.added).toBe(0)
    if (!byId.ok) return
    expect(byId.mappings).toBe(current)
    expect(byId.notice).toContain('已有 1 条')
  })

  it('缺列或空表会说明原因，停用的相同映射不会被重复添加', () => {
    expect(merge([['文件描述', '备注'], ['专利证书', '随便']])).toEqual({ ok: false, message: '认出了文件描述，还缺「发文类型」这一列。' })
    expect(merge([['随便', '发文类型'], ['专利证书', '专利电子证书']])).toEqual({ ok: false, message: '认出了发文类型，还缺「文件描述」这一列。' })
    expect(merge([['文件描述', '发文类型']])).toEqual({ ok: false, message: '表格里没有数据行。' })
    expect(merge([['甲', '乙']], [], [])).toEqual({ ok: false, message: '发文类型还没读到。先重新读取发文类型，再导入。' })

    const disabled = [saved('专利证书', certificate, { enabled: false })]
    const again = merge([['文件描述', '发文类型'], ['专利证书', '专利电子证书']], disabled)
    expect(again.ok && again.added).toBe(0)
    if (!again.ok) return
    expect(again.mappings).toBe(disabled)

    const replaced = merge([['文件描述', '发文类型'], ['专利证书', '办理登记手续通知书']], disabled)
    expect(replaced.ok && replaced.added).toBe(1)
    if (!replaced.ok) return
    expect(replaced.mappings).toHaveLength(2)
    expect(replaced.mappings[1]).toMatchObject({ fileDescriptionText: '专利证书', mailTypeId: notice, enabled: true })
  })

  it('导出的两列能被导入认出来', async () => {
    const rows = mappingExportRows([
      saved('专利证书', certificate),
      saved('登记手续', notice, { fileDescriptionText: '登记手续', mailTypeName: '办理登记手续通知书' })
    ], types)
    expect(rows[0]).toEqual(['文件描述', '发文类型'])
    expect(rows[1]).toEqual(['专利证书', '通知书/专利电子证书'])
    const read = await readXlsxRows(xlsxBytes(rows, '发文映射'))
    const imported = merge(read)
    expect(imported.ok && imported.added).toBe(2)
    if (!imported.ok) return
    expect(imported.mappings.map(item => [item.fileDescriptionText, item.mailTypeId])).toEqual([
      ['专利证书', certificate],
      ['登记手续', notice]
    ])
  })
})
