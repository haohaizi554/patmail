import { EASY_MAIL_WRITES_ENABLED } from '../mail/easy/gate'
import { WORKFLOW_WRITES_ENABLED } from '../workflow/gate'
import { allowsProductionWrite } from './coordinator'
import { STAGES } from './state'
import type { AutomationTask, StageId } from './types'

export type StageDecision = 'read' | 'blocked' | 'unknown-stop'

/** 写阶段在契约和跨标签页互斥未证明前直接阻塞，不会调用传输层。 */
export function prepareStage(task: AutomationTask, stage: StageId): { task: AutomationTask; decision: StageDecision; reason: string } {
  const definition = STAGES[stage]
  if (task.status === 'UNKNOWN') return { task, decision: 'unknown-stop', reason: '任务结果未知，不能自动重试写操作。' }
  if (definition.sideEffect !== 'write') return { task, decision: 'read', reason: definition.success }
  const reason = [
    !EASY_MAIL_WRITES_ENABLED ? '邮件写操作默认关闭。' : '',
    !WORKFLOW_WRITES_ENABLED ? '流程写操作默认关闭。' : '',
    !allowsProductionWrite() ? '跨标签页写互斥还没有被证明。' : ''
  ].filter(Boolean).join('')
  return { task: { ...task, status: 'BLOCKED' }, decision: 'blocked', reason }
}
