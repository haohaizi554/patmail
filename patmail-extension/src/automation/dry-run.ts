import type { EasyTransport } from '../api/transport'
import { buildTask, type TaskBuildInput } from './task-builder'
import type { AutomationLog, AutomationTask } from './types'

const WRITE_CALLS = ['MailCustomer', 'SaveMailInfo', 'SaveMailRalteCaseFile', 'FlowSubmit', 'EndEmailFlowd']

export interface DryRunResult {
  task: AutomationTask
  logs: AutomationLog[]
  writeCalls: string[]
}

/** 只调用本地分组和草稿规划。传入的 transport 不会被使用。 */
export function runDryRun(input: TaskBuildInput, transport: EasyTransport | null = null): DryRunResult {
  void transport
  const started = Date.now()
  const task = buildTask(input)
  const logs: AutomationLog[] = [{
    taskId: task.taskId, executionId: '', itemId: '', stage: 'DRAFT_VALIDATE', event: 'dry-run',
    status: task.status, durationMs: Date.now() - started, errorCode: task.status === 'DRY_RUN_COMPLETED' ? '' : 'BLOCKED',
    timestamp: task.updatedAt
  }]
  const writeCalls = WRITE_CALLS.filter(call => logs.some(item => item.event === call))
  return { task, logs, writeCalls }
}
