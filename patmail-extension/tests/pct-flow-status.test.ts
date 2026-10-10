import { describe, expect, it } from 'vitest'
import { classifyProcSendGate, finishedWithoutFlow, gateForProcLabel, mailedWithoutFinishDate, suffixVariant } from '../src/customer/pct-flow-status'

const procId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function node(partial: Record<string, unknown>): Record<string, unknown> {
  return { id: 'flow-1', proc_id: procId, eflow_name: '发文', order_by: 1, node_code: 'SUBMIT', node_name: '启动流程', ...partial }
}

describe('PCT 发文审核状态', () => {
  it('还没有发文流程时可以勾选', () => {
    expect(classifyProcSendGate({ Eflow: [], ProcInfo: [] }, procId)).toBe('open')
    expect(classifyProcSendGate({ Eflow: [node({ eflow_name: '递交', order_by: 2, node_code: 'END' })] }, procId)).toBe('open')
  })

  it('当前节点不是 END 时待审核，空代码也不是结束', () => {
    expect(classifyProcSendGate({
      Eflow: [node({ order_by: 1 }), node({ order_by: 2, node_code: '', node_name: '主管审核' })]
    }, procId)).toBe('pending')
  })

  it('当前节点是 END 时已经审核完成，另一条发文没结束则整件待审核', () => {
    expect(classifyProcSendGate({
      Eflow: [node({ order_by: 2, node_code: 'end' })]
    }, procId)).toBe('done')
    expect(classifyProcSendGate({
      Eflow: [
        node({ id: 'done', order_by: 2, node_code: 'END' }),
        node({ id: 'open', order_by: 2, node_code: 'AUDIT' })
      ]
    }, procId)).toBe('pending')
  })

  it('按处理事项名称对上流程，对不上名称不算待审核', () => {
    const body = {
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT' }],
      Eflow: [node({ order_by: 2, node_code: 'END' })]
    }
    expect(gateForProcLabel(body, '提醒申请PCT')).toBe('done')
    expect(gateForProcLabel(body, '开卷')).toBe('missing')
  })

  it('同名事项里已经提交或审完的，不被另一条没有发文的记录标成还没提交', () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const body = {
      ProcInfo: [
        { proc_id: procId, ctrl_proc: '提醒申请PCT' },
        { proc_id: other, ctrl_proc: '提醒申请PCT' }
      ],
      Eflow: [
        node({ order_by: 2, node_code: 'AUDIT', node_name: '主管审核' }),
        node({ id: 'empty', proc_id: other, eflow_name: '递交', order_by: 2, node_code: 'END' })
      ]
    }
    expect(gateForProcLabel(body, '提醒申请PCT')).toBe('pending')
    const finished = {
      ProcInfo: body.ProcInfo,
      Eflow: [
        node({ order_by: 2, node_code: 'END' }),
        node({ id: 'empty', proc_id: other, eflow_name: '递交', order_by: 2, node_code: 'END' })
      ]
    }
    expect(gateForProcLabel(finished, '提醒申请PCT')).toBe('done')
  })

  it('子流程都结束且没有完成日时，标成已发文但事项未管制', () => {
    const ended = {
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT', finish_date: '' }],
      Eflow: [node({ order_by: 2, node_code: 'END' })]
    }
    expect(mailedWithoutFinishDate(ended, '提醒申请PCT')).toBe(true)
    expect(mailedWithoutFinishDate({
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT', finish_date: '2026-09-01' }],
      Eflow: [node({ order_by: 2, node_code: 'END' })]
    }, '提醒申请PCT')).toBe(false)
    expect(mailedWithoutFinishDate({
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT', finish_date: '' }],
      Eflow: [node({ order_by: 2, node_code: 'AUDIT' })]
    }, '提醒申请PCT')).toBe(false)
    expect(mailedWithoutFinishDate({
      ProcInfo: [{ proc_id: procId, ctrl_proc: 'PCT进国家阶段官方绝限', finish_date: '' }],
      Eflow: [
        node({ id: 'mail', eflow_name: '发文', order_by: 2, node_code: 'END' }),
        node({ id: 'draft', eflow_name: '核稿', order_by: 2, node_code: 'END' })
      ]
    }, 'PCT进国家阶段官方绝限')).toBe(true)
  })

  it('没有子流程且事项已完成时不用发，还有子流程或没完成就不是', () => {
    expect(finishedWithoutFlow({
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT', finish_date: '2026-09-01', proc_status: '' }],
      Eflow: []
    }, '提醒申请PCT')).toBe(true)
    expect(finishedWithoutFlow({
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT', finish_date: '', proc_status: '完成' }],
      Eflow: []
    }, '提醒申请PCT')).toBe(true)
    expect(finishedWithoutFlow({
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT', finish_date: '', proc_status: '' }],
      Eflow: []
    }, '提醒申请PCT')).toBe(false)
    expect(finishedWithoutFlow({
      ProcInfo: [{ proc_id: procId, ctrl_proc: '提醒申请PCT', finish_date: '2026-09-01' }],
      Eflow: [node({ order_by: 2, node_code: 'END' })]
    }, '提醒申请PCT')).toBe(false)
  })

  it('只差一段减号后缀才算同一文号的两种写法', () => {
    expect(suffixVariant('PA2519196CND-YS-放弃复审', 'PA2519196CND-YS')).toBe(true)
    expect(suffixVariant('PA2519196CND-YS', 'pa2519196cnd-ys')).toBe(false)
    expect(suffixVariant('PA2519196CND', 'PA2519196CND-YS')).toBe(true)
    expect(suffixVariant('PA2519196CNDYS', 'PA2519196CND')).toBe(false)
  })
})
