import { describe, expect, it } from 'vitest'
import { filterProcessRows } from '../src/api/process-list-search'
import type { ProcessListRow } from '../src/api/mail-process'

function row(cells: Record<string, string>): ProcessListRow {
  return { id: '', cells, open: null }
}

describe('发文记录本地匹配', () => {
  const rows = [
    row({ customer_name: '鹏城国家实验室', mail_subject: '提醒申请PCT', mailtoname: '刘艳高,雷宇,林淑敏' }),
    row({ customer_name: '鹏城国家实验室', mail_subject: '提醒申请PCT', mailtoname: '王志,雷群剑,林淑敏' })
  ]

  it('在收件人里匹配名字，不要求整格相等', () => {
    const matched = filterProcessRows(rows, 'CO', '雷群剑')
    expect(matched).toHaveLength(1)
    expect(matched[0]?.cells.mailtoname).toContain('雷群剑')
  })

  it('主题和客户也能命中，空词保留全部', () => {
    expect(filterProcessRows(rows, 'CO', '提醒申请')).toHaveLength(2)
    expect(filterProcessRows(rows, 'CO', '鹏城')).toHaveLength(2)
    expect(filterProcessRows(rows, 'CO', '  ')).toHaveLength(2)
  })

  it('提案和递交只看各自提示里的列', () => {
    const proposal = [row({ apply_name: '玻璃幕墙', customer_name: '华东', tcase_volume: 'PA1' })]
    expect(filterProcessRows(proposal, 'AP', 'PA1')).toHaveLength(1)
    expect(filterProcessRows(proposal, 'AP', '幕墙')).toHaveLength(1)
    const filing = [row({ case_volume: 'EF1', customer_name: '华东', case_name: '一种连接器' })]
    expect(filterProcessRows(filing, 'EF', '连接器')).toHaveLength(1)
    expect(filterProcessRows(filing, 'EF', '不存在')).toHaveLength(0)
  })
})
