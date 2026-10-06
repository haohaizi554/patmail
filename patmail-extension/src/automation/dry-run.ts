import type { EasyTransport } from '../api/transport'
import { buildStagePlans } from './stage-plan'
import { buildTask, type TaskBuildInput } from './task-builder'
import type { AutomationLog, AutomationStagePlan, AutomationTask } from './types'

const WRITE_CALLS: Record<string, string> = {
  MAIL_CREATE: 'MailCustomer',
  MAIL_SAVE: 'SaveMailInfo',
  FILE_BIND: 'SaveMailRalteCaseFile',
  WORKFLOW_SUBMIT: 'FlowSubmit',
  REVIEW_EXECUTE: 'EndEmailFlowd'
}

export interface DryRunResult {
  task: AutomationTask
  logs: AutomationLog[]
  writeCalls: string[]
  plans: AutomationStagePlan[]
}

/** 只调用本地分组和草稿规划。传入的 transport 不会被使用。 */
export function runDryRun(input: TaskBuildInput, transport: EasyTransport | null = null): DryRunResult {
  void transport
  const started = Date.now()
  const task = buildTask(input)
  const plans = buildStagePlans(task, 'UNKNOWN', {
    now: input.now ?? new Date().toISOString(),
    currentAccount: { easyOrigin: input.origin, operatorId: input.operatorId }
  })
  const logs: AutomationLog[] = [{
    taskId: task.taskId, executionId: '', itemId: '', stage: 'DRAFT_VALIDATE', event: 'dry-run',
    status: task.status, durationMs: Date.now() - started, errorCode: task.status === 'DRY_RUN_COMPLETED' ? '' : 'BLOCKED',
    timestamp: task.updatedAt
  }]
  const writeCalls = [...new Set(plans.flatMap(item => item.sideEffect === 'write' && item.canExecute ? [WRITE_CALLS[item.stage] ?? ''] : []).filter(Boolean))]
  return { task, logs, writeCalls, plans }
}
