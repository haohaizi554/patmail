import { describe, expect, it } from 'vitest'
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
    row({ ourVolume: 'A', contactName: '甲' }),
    row({ ourVolume: 'B', contactName: '甲' }),
    row({ ourVolume: 'C', contactName: '乙' })
  ]

  it('keeps one row as one mail when the customer chose single send', () => {
    expect(groupWorkflowRows('2', rows).map(group => group.map(item => item.ourVolume))).toEqual([['A'], ['B'], ['C']])
  })

  it('merges the whole sheet when the customer chose one mail', () => {
    expect(groupWorkflowRows('1', rows)).toEqual([rows])
  })

  it('merges rows that share the first contact', () => {
    expect(groupWorkflowRows('3', rows).map(group => group.map(item => item.ourVolume))).toEqual([['A', 'B'], ['C']])
  })
})
