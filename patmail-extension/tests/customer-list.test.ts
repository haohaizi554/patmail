import { describe, expect, it } from 'vitest'
import { customerListParams, readCustomerList } from '../src/customer/customer-list'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('客户列表', () => {
  it('按列表页一次取全量的参数组装请求', () => {
    const params = customerListParams()
    expect(params.get('Call')).toBe('GetCustomerlist')
    expect(params.get('log_pagename')).toBe('customerlist.aspx')
    expect(params.get('pageIndex')).toBe('1')
    expect(params.get('pageSize')).toBe('9000000')
    expect(params.get('pageIsFirstRequest')).toBe('false')
    expect(params.get('searchrole')).toBe('1')
    expect(params.get('customer_name_islike')).toBe('0')
    expect(params.get('is_conclude')).toBe('10')
    expect(params.get('is_vip')).toBe('10')
    expect(params.get('customer_name')).toBe('')
    expect(params.get('colsel')).toContain('customer_name')
  })

  it('只保留编号和名称，跳过缺字段和重复编号', () => {
    const read = readCustomerList({
      TableRows: [
        { customer_id: id, customer_name: ' 甲公司 ', tel: '13800000000', email: 'a@example.com' },
        { customer_id: id.toUpperCase(), customer_name: '重复' },
        { customer_id: other, customer_name: '乙公司' },
        { customer_id: '不是编号', customer_name: '丙公司' },
        { customer_id: other, customer_name: '' }
      ]
    })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data).toEqual([
      { id, name: '甲公司' },
      { id: other, name: '乙公司' }
    ])
  })

  it('没有行时给空名单，缺表格时不当成成功', () => {
    const empty = readCustomerList({ TableRows: null })
    expect(empty.ok && empty.data).toEqual([])
    const missing = readCustomerList({})
    expect(missing.ok).toBe(false)
  })
})
