import { describe, expect, it } from 'vitest'
import { readReviewers } from '../src/api/dictionaries/reviewers'
import { emptyMailRules, readMailRules } from '../src/mail/repository'
import { readFlowSubmit } from '../src/workflow/contracts'

const self = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const dept = '33333333-3333-4333-8333-333333333333'

describe('审核人名单', () => {
  it('只保留人员节点，部门不进入名单', () => {
    const rows = readReviewers({
      TreeUser: [
        { id: dept, name: '流程部', pid: '', TreeType: 'Dept' },
        { id: self, name: '吴晨晨', pid: dept, TreeType: 'User' },
        { id: other, name: '同事', pid: dept, TreeType: 'User' }
      ]
    })
    expect(rows.map(item => item.name)).toEqual(['吴晨晨', '同事'])
  })

  it('没有 TreeType 时用叶子节点，避免把部门当成审核人', () => {
    const rows = readReviewers({
      TreeUser: [
        { id: dept, name: '流程部', pid: '' },
        { id: self, name: '吴晨晨', pid: dept }
      ]
    })
    expect(rows).toEqual([{ id: self, name: '吴晨晨' }])
  })

  it('GetFlowSubmit 的分号名单按 user_list_id 和姓名对齐', () => {
    const parsed = readFlowSubmit({
      ClientInfo: { IsLogin: true, Status: true, Result: false },
      Result: [{
        node_id: other,
        node_code: '',
        node_name_zh_cn: '审核',
        user_list: `${self};${other};${dept};`,
        user_list_id: `${self};${other}`,
        user_list_name: '吴晨晨;同事'
      }]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.nodes[0]?.reviewers).toEqual([
      { id: self, name: '吴晨晨' },
      { id: other, name: '同事' }
    ])
  })

  it('旧规则没有默认审核人时仍可读取', () => {
    const stored = emptyMailRules('op')
    const legacy = { ...stored }
    delete (legacy as { defaultReviewer?: unknown }).defaultReviewer
    const read = readMailRules(legacy, 'op')
    expect(read.writable).toBe(true)
    expect(read.bundle.defaultReviewer).toBeNull()
  })
})
