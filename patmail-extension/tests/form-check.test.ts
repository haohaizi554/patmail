import { describe, expect, it } from 'vitest'
import { overlayFieldOptions } from '../src/query/form-page'
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
})
