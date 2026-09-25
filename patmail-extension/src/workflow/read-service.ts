import type { EasyTransport } from '../api/transport'
import type { ApiResult } from '../api/types'
import {
  flowHistoryParams, flowInfoParams, flowSubmitQuery, lastStatusParams, readFlowHistory, readFlowInfo,
  readFlowSubmit, readLastStatus, readUrgency, urgencyParams, type FlowInfoFields
} from './contracts'
import type { EasyWorkflowSnapshot, WorkflowNode } from './types'

export interface WorkflowRead {
  snapshot: EasyWorkflowSnapshot
  info: FlowInfoFields
  nodeMessage: string
}

function transportMessage(result: ApiResult<unknown>): string {
  return result.ok ? '流程响应无效。' : result.error.message
}

function snapshotOf(mailId: string, info: FlowInfoFields, history: EasyWorkflowSnapshot['history'], activity: EasyWorkflowSnapshot['activity'], urgencies: EasyWorkflowSnapshot['urgencies'], nodes: WorkflowNode[]): EasyWorkflowSnapshot {
  return {
    mailId, flowId: info.flowId, flowType: info.flowType, flowSubType: info.flowSubType,
    currentNodeId: info.curNodeId, currentNodeCode: info.nodeCode, currentNodeName: info.nodeName,
    status: info.status, currentUserId: info.curUserId, currentUserName: info.cnName,
    urgencyId: info.urgencyId, versionToken: info.updateTimeSs && info.updateTimeSs.trim() ? info.updateTimeSs : null,
    deptId: info.deptId, allowEdit: activity?.allowEdit ?? null, availableNodes: nodes,
    submitContract: 'unverified', history, activity, urgencies
  }
}

export class WorkflowReadService {
  constructor(private readonly transport: EasyTransport) {}

  async load(mailId: string, flowType: string, signal?: AbortSignal): Promise<{ ok: true; data: WorkflowRead } | { ok: false; message: string }> {
    const infoParams = flowInfoParams(mailId, flowType)
    const historyParams = flowHistoryParams(mailId)
    if (!infoParams || !historyParams) return { ok: false, message: '流程查询参数无效。' }
    const [infoResult, historyResult, urgencyResult] = await Promise.all([
      this.transport.post('getFlowInfo', infoParams, signal),
      this.transport.post('getFlowHistory', historyParams, signal),
      this.transport.post('getUrgencyList', urgencyParams(), signal)
    ])
    if (!infoResult.ok) return { ok: false, message: transportMessage(infoResult) }
    const info = readFlowInfo(infoResult.data, mailId)
    if (!info.ok) return info
    if (!historyResult.ok) return { ok: false, message: transportMessage(historyResult) }
    const history = readFlowHistory(historyResult.data)
    if (!history.ok) return history
    if (!urgencyResult.ok) return { ok: false, message: transportMessage(urgencyResult) }
    const urgency = readUrgency(urgencyResult.data)
    if (!urgency.ok) return urgency
    const nodes = await this.nodes(info.info, signal)
    return {
      ok: true,
      data: {
        info: info.info,
        nodeMessage: nodes.message,
        snapshot: snapshotOf(mailId, info.info, history.history, history.activity, urgency.items, nodes.nodes)
      }
    }
  }

  async nodes(info: FlowInfoFields, signal?: AbortSignal): Promise<{ nodes: WorkflowNode[]; message: string }> {
    const params = flowSubmitQuery(info)
    if (!params) return { nodes: [], message: '当前流程字段不足以读取下一节点。' }
    const result = await this.transport.post('getFlowSubmit', params, signal)
    if (!result.ok) return { nodes: [], message: transportMessage(result) }
    const parsed = readFlowSubmit(result.data)
    if (!parsed.ok) return { nodes: [], message: parsed.message }
    return { nodes: parsed.nodes, message: parsed.nodes.length === 0 ? '没有可选的下一节点。' : '' }
  }

  async lastStatus(mailId: string, flowType: string, signal?: AbortSignal): Promise<{ ok: true; present: boolean; token: string | null } | { ok: false; message: string }> {
    const params = lastStatusParams(mailId, flowType)
    if (!params) return { ok: false, message: '流程版本查询参数无效。' }
    const result = await this.transport.post('getFlowLastStatus', params, signal)
    if (!result.ok) return { ok: false, message: transportMessage(result) }
    return readLastStatus(result.data)
  }

  async reloadInfo(mailId: string, flowType: string, signal?: AbortSignal): Promise<{ ok: true; info: FlowInfoFields } | { ok: false; message: string }> {
    const params = flowInfoParams(mailId, flowType)
    if (!params) return { ok: false, message: '流程查询参数无效。' }
    const result = await this.transport.post('getFlowInfo', params, signal)
    if (!result.ok) return { ok: false, message: transportMessage(result) }
    return readFlowInfo(result.data, mailId)
  }
}
