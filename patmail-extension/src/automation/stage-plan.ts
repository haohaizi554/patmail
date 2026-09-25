import { STAGES } from './state'
import type { AutomationStagePlan, AutomationTask, EvidenceLevel } from './types'

const ISSUE_STAGE: Record<string, AutomationStagePlan['stage']> = {
  MISSING_CUSTOMER: 'CUSTOMER_RESOLVE',
  MISSING_POLICY: 'CUSTOMER_RESOLVE',
  MISSING_DESCRIPTION: 'DESCRIPTION_MAPPING',
  MISSING_MAPPING: 'DESCRIPTION_MAPPING',
  MISSING_RECIPIENT: 'RECIPIENT_RESOLVE'
}

/** 按阶段声明生成计划。写阶段在契约和写开关未满足时不可执行。 */
export function buildStagePlans(task: AutomationTask, contract: EvidenceLevel = 'UNKNOWN'): AutomationStagePlan[] {
  const plans: AutomationStagePlan[] = []
  for (const definition of Object.values(STAGES)) {
    for (const item of task.items.length > 0 ? task.items : [null]) {
      const issues = item ? [...item.issues, ...task.issues.filter(issue => issue.itemId === '' || issue.itemId === item.itemId)] : task.issues
      const blockers = issues.filter(issue => ISSUE_STAGE[issue.code] === definition.id).map(issue => issue.message)
      const write = definition.sideEffect === 'write'
      if (write) blockers.push('写操作默认关闭。', '接口还没有完成请求、响应和回读核验。')
      plans.push({
        stage: definition.id,
        itemId: item?.itemId ?? '',
        sideEffect: definition.sideEffect,
        precondition: definition.precondition,
        expectedInput: definition.input,
        expectedOutput: definition.output,
        canExecute: !write && blockers.length === 0,
        blockers,
        requiresConfirmation: definition.needsConfirmation || write,
        contractStatus: write ? 'UNKNOWN' : contract
      })
    }
  }
  return plans
}
