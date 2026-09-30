import { describe, expect, it } from 'vitest'
import { inventorCustomers } from '../src/customer/pct-recipients'
import { groupWorkflowRows } from '../src/customer/workflow-mail'
import type { PctTaskRow } from '../src/customer/types'

function row(partial: Partial<PctTaskRow> & Pick<PctTaskRow, 'ourVolume'>): PctTaskRow {
  return {
    customerVolume: '',
    customerName: '',
    contactName: '',
    iprName: '',
    procLabel: '提醒申请PCT',
    mailTypeLabel: '',
    ...partial
  }
}

describe('workflow mail groups', () => {
  const rows = [
    row({ ourVolume: 'A', customerName: '甲客户', contactName: '甲' }),
    row({ ourVolume: 'B', customerName: '甲客户', contactName: '甲' }),
    row({ ourVolume: 'C', customerName: '乙客户', contactName: '乙' }),
    row({ ourVolume: 'D', customerName: '乙客户', contactName: '甲' })
  ]

  it('keeps one row as one mail when the customer chose single send', () => {
    expect(groupWorkflowRows('2', rows).map(group => group.map(item => item.ourVolume))).toEqual([['A'], ['B'], ['C'], ['D']])
  })

  it('merges rows of the same customer when the customer chose one mail', () => {
    expect(groupWorkflowRows('1', rows).map(group => group.map(item => item.ourVolume))).toEqual([['A', 'B'], ['C', 'D']])
  })

  it('splits the same customer when the IPR differs', () => {
    const mixed = [
      row({ ourVolume: 'A', customerName: '甲客户', iprName: '雷' }),
      row({ ourVolume: 'B', customerName: '甲客户', iprName: '雷' }),
      row({ ourVolume: 'C', customerName: '甲客户', iprName: '王' })
    ]
    expect(groupWorkflowRows('1', mixed).map(group => group.map(item => item.ourVolume))).toEqual([['A', 'B'], ['C']])
  })

  it('splits a listed customer when the first inventor or IPR differs', () => {
    const mixed = [
      row({ ourVolume: 'A', customerName: '甲客户', contactName: '姜', iprName: '雷' }),
      row({ ourVolume: 'B', customerName: '甲客户', contactName: '姜', iprName: '雷' }),
      row({ ourVolume: 'C', customerName: '甲客户', contactName: '王', iprName: '雷' })
    ]
    expect(groupWorkflowRows('1', mixed, inventorCustomers('甲客户')).map(group => group.map(item => item.ourVolume))).toEqual([['A', 'B'], ['C']])
  })

  it('merges rows that share the customer and the first contact', () => {
    expect(groupWorkflowRows('3', rows).map(group => group.map(item => item.ourVolume))).toEqual([['A', 'B'], ['C'], ['D']])
  })
})
