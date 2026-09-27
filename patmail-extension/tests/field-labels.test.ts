import { describe, expect, it } from 'vitest'
import { FILE_SEARCH_REQUEST_FIELDS, FILE_SEARCH_SYSTEM_FIELDS } from '../src/api/file-search-params'
import { fieldGroup, fieldLabel } from '../src/query/field-registry'

const groups = ['客户', '案件', '文件', '处理事项', '人员', '日期', '其它', '自定义']

describe('查询字段显示名', () => {
  it('每个业务字段都用页面上的中文，不露出参数名', () => {
    const business = FILE_SEARCH_REQUEST_FIELDS.filter(field => !FILE_SEARCH_SYSTEM_FIELDS.has(field))
    expect(business.length).toBeGreaterThan(100)
    for (const field of business) {
      const label = fieldLabel(field)
      expect(label, field).not.toBe(field)
      expect(label, field).not.toBe('其他条件')
      expect(label, field).not.toContain('_')
      expect(label, field).not.toMatch(/[a-z]{4,}/i)
      expect(groups, field).toContain(fieldGroup(field))
    }
  })
})
