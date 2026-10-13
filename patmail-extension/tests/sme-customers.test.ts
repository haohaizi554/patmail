import { describe, expect, it } from 'vitest'
import { isDictionaryResult } from '../src/api/message-guards'
import { parseSmeCustomerSnapshot } from '../src/customer/sme-customers'

const guid = '50ba5fd7-030b-4de6-9c3a-f7a39ecefc3c'

describe('中小客户名单快照', () => {
  it('解析紧凑数组，校验编号并去重', () => {
    const snapshot = parseSmeCustomerSnapshot({
      takenAt: '2026-10-13T14:38:36+08:00',
      customers: [
        [guid, '海目星激光科技集团股份有限公司'],
        ['not-a-guid', '无效编号'],
        [guid.toUpperCase(), '重复客户'],
        ['', '空编号']
      ]
    })
    expect(snapshot?.takenAt).toBe('2026-10-13T14:38:36+08:00')
    expect(snapshot?.customers).toEqual([{ id: guid, name: '海目星激光科技集团股份有限公司' }])
  })

  it('结构不对或全对不上编号时当没有快照', () => {
    expect(parseSmeCustomerSnapshot(null)).toBeNull()
    expect(parseSmeCustomerSnapshot({ takenAt: 'x' })).toBeNull()
    expect(parseSmeCustomerSnapshot({ takenAt: 'x', customers: 'oops' })).toBeNull()
    expect(parseSmeCustomerSnapshot({ takenAt: 'x', customers: [[guid, ''], ['bad', 'name']] })).toBeNull()
  })

  it('三万家名单能过消息桥的校验，快照时间跟着带过去', () => {
    const customers = Array.from({ length: 29449 }, (_, index) => ({
      id: `${guid.slice(0, 24)}${String(index).padStart(12, '0')}`, name: `客户${index}号`
    }))
    expect(isDictionaryResult({ ok: true, data: { kind: 'customerList', customers, takenAt: '2026-10-13T14:38:36+08:00' } })).toBe(true)
    expect(isDictionaryResult({ ok: true, data: { kind: 'customerList', customers: customers.slice(0, 3) } })).toBe(true)
  })
})