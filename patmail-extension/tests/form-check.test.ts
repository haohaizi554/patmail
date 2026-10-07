import { describe, expect, it } from 'vitest'
import { mergeFormFields, overlayFieldOptions, pageSelectOptions } from '../src/query/form-page'
import type { FileSearchFormField } from '../src/shared/message'

function field(partial: Partial<FileSearchFormField> & Pick<FileSearchFormField, 'id' | 'control'>): FileSearchFormField {
  return {
    label: partial.id,
    section: 'case',
    advanced: false,
    visible: true,
    hiddenBy: [],
    options: [],
    ...partial
  }
}

describe('file form check', () => {
  it('keeps every scanned field and fills tree options from the live lists', () => {
    const scanned = [
      field({ id: 'case_volume', control: 'text' }),
      field({ id: 'dept_id', control: 'picker' }),
      field({ id: 'is_close', control: 'select', options: [{ value: '1', label: '是' }] })
    ]
    const checked = overlayFieldOptions(scanned, key => key === 'dept_id'
      ? [{ value: 'd1', label: '一部', parent: 'root' }, { value: 'd2', label: '二部', parent: 'd1' }]
      : null)
    expect(checked.map(item => item.id)).toEqual(['case_volume', 'dept_id', 'is_close'])
    expect(checked[0].options).toEqual([])
    expect(checked[1].options).toEqual([
      { value: 'd1', label: '一部', parent: 'root' },
      { value: 'd2', label: '二部', parent: 'd1' }
    ])
    expect(checked[2].options).toEqual([{ value: '1', label: '是' }])
  })

  it('keeps the previous template list when the new scan only has a placeholder', () => {
    const previous = [
      field({
        id: 'filetemp',
        control: 'select',
        options: [
          { value: '', label: '请选择文件名称模板' },
          { value: 'temp-1', label: '微众新申请文档' }
        ]
      })
    ]
    const live = [
      field({
        id: 'filetemp',
        control: 'select',
        options: [{ value: '', label: '请选择文件名称模板' }]
      })
    ]
    const merged = mergeFormFields(live, previous)
    expect(merged[0].options.map(item => item.label)).toEqual(['请选择文件名称模板', '微众新申请文档'])
    expect(pageSelectOptions('filetemp', merged)).toEqual([{ value: 'temp-1', label: '微众新申请文档' }])
  })

  it('keeps a scan that already has real options', () => {
    const previous = [field({ id: 'filetemp', control: 'select', options: [{ value: 'old', label: '旧模板' }] })]
    const live = [field({
      id: 'filetemp',
      control: 'select',
      options: [{ value: '', label: '请选择文件名称模板' }, { value: 'new', label: '新模板' }]
    })]
    expect(mergeFormFields(live, previous)[0].options.map(item => item.value)).toEqual(['', 'new'])
  })
})
