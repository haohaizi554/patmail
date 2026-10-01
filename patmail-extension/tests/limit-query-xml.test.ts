import { describe, expect, it } from 'vitest'
import { buildLimitQueryXml, readLimitQueryXml } from '../src/api/limit-form'

describe('期限查询模板', () => {
  it('writes the site control names and reads them back as query fields', () => {
    const xml = buildLimitQueryXml({
      case_volume: 'PA1',
      customer_name: '甲客户',
      case_type: '31D1A147-2931-43B5-94AE-B72B1525BA8A',
      pageIndex: '1'
    })
    expect(xml).toContain('<case_volume_other>PA1</case_volume_other>')
    expect(xml).toContain('<customer_name>甲客户</customer_name>')
    expect(xml).not.toContain('pageIndex')
    const read = readLimitQueryXml(xml)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.case_volume).toBe('PA1')
    expect(read.data.customer_name).toBe('甲客户')
    expect(read.data.case_type).toBe('31D1A147-2931-43B5-94AE-B72B1525BA8A')
  })
})
