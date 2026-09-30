import { describe, expect, it } from 'vitest'
import { classifyProcSendGate, gateForProcLabel } from '../src/customer/pct-flow-status'

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
})
